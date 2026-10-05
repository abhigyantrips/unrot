/** Only serve assets belonging to visible posts, including previews. */
export async function serveMedia(request: Request, db: D1Database, bucket: R2Bucket, key: string) {
  if (!/^objects\/[a-f0-9]{64}\.(jpg|jpeg|png|webp|avif|mp4|mov|webm)$/.test(key)) return new Response('Not found', { status: 404 });
  const publicAsset = await db.prepare('SELECT 1 FROM live_assets a JOIN live_posts p ON p.id=a.post_id WHERE p.visible=1 AND (a.key=? OR a.preview_key=?) LIMIT 1').bind(key, key).first();
  if (!publicAsset) return new Response('Not found', { status: 404 });
  return objectResponse(request, bucket, key);
}
export async function objectResponse(request: Request, bucket: R2Bucket, key: string) {
  const meta = await bucket.head(key);
  if (!meta) return new Response('Not found', { status: 404 });
  const headers = new Headers();
  if (meta.httpMetadata?.contentDisposition) headers.set('Content-Disposition',meta.httpMetadata.contentDisposition);
  if (meta.httpMetadata?.contentEncoding) headers.set('Content-Encoding',meta.httpMetadata.contentEncoding);
  headers.set('Content-Type', meta.httpMetadata?.contentType ?? 'application/octet-stream');
  headers.set('ETag', meta.httpEtag);
  headers.set('Last-Modified', meta.uploaded.toUTCString());
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
  headers.set('X-Content-Type-Options', 'nosniff');
  const match = request.headers.get('If-None-Match');
  if (match && (match === '*' || match.split(',').some(t => t.trim().replace(/^W\//, '') === meta.httpEtag))) return new Response(null, { status: 304, headers });
  const since = request.headers.get('If-Modified-Since');
  if (!match && since && Math.floor(meta.uploaded.getTime() / 1000) <= Math.floor(Date.parse(since) / 1000)) return new Response(null, { status: 304, headers });
  let range: { offset: number; length: number } | undefined;
  const rawRange = request.headers.get('Range');
  const ifRange = request.headers.get('If-Range');
  const useRange = request.method !== 'HEAD' && rawRange && (!ifRange || ifRange === meta.httpEtag || Date.parse(ifRange) >= Math.floor(meta.uploaded.getTime() / 1000) * 1000);
  if (useRange) {
    const parsed = /^bytes=(\d*)-(\d*)$/.exec(rawRange);
    let start = 0, end = meta.size - 1;
    if (parsed && (parsed[1] || parsed[2])) {
      if (parsed[1]) { start = Number(parsed[1]); if (parsed[2]) end = Math.min(end, Number(parsed[2])); }
      else { start = Math.max(0, meta.size - Number(parsed[2])); }
    }
    if (!parsed || (!parsed[1] && !parsed[2]) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= meta.size) {
      headers.set('Content-Range', `bytes */${meta.size}`);
      return new Response(null, { status: 416, headers });
    }
    range = { offset: start, length: end - start + 1 };
    headers.set('Content-Range', `bytes ${start}-${end}/${meta.size}`);
  }
  headers.set('Content-Length', String(range?.length ?? meta.size));
  if (request.method === 'HEAD') return new Response(null, { headers });
  const object = await bucket.get(key, range ? { range } : undefined);
  if (!object) return new Response('Not found', { status: 404 });
  return new Response(object.body as unknown as ReadableStream, { status: range ? 206 : 200, headers });
}
