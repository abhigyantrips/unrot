import type { IncomingMessage, ServerResponse } from 'node:http';
import { localPlatform, migrate } from './platform';
import { Store } from './store';
import { Jobs } from './sync';
import { Instagram } from './instagram';
import { config } from './config';
import { objectResponse } from '../src/lib/media';
import { markdown } from '../src/lib/markdown';
import { lock } from './lock';
import type { TagColor } from '../src/lib/types';
export function permitted(request: Pick<IncomingMessage, 'headers' | 'method'> & { socket: { remoteAddress?: string } }) {
  const address = request.socket.remoteAddress;
  if (!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(address ?? '')) return false;
  const host = request.headers.host ?? '';
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)) return false;
  if (request.headers.origin && request.headers.origin !== `http://${host}`) return false;
  return ['GET','HEAD'].includes(request.method ?? '') || request.headers.origin === `http://${host}`;
}
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  let text = '';
  for await (const chunk of req) { text += chunk; if (text.length > 150000) throw new Error('Request too large.'); }
  const value = JSON.parse(text || '{}');
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a JSON object.');
  return value;
}
export async function bridge() {
  const release = await lock('curator');
  const platform = await localPlatform();
  await migrate(platform.env.DB);
  const store = new Store(platform.env.DB);
  await store.recover();
  const jobs = new Jobs(store,platform.env.MEDIA);
  let reconnect: Instagram | null = null;
  jobs.sync();
  const middleware = async (req: IncomingMessage,res: ServerResponse,next: () => void) => {
    const url = new URL(req.url ?? '/',`http://${req.headers.host ?? 'localhost'}`);
    if (url.pathname !== '/curate' && !url.pathname.startsWith('/__local/')) return next();
    res.setHeader('Cache-Control','no-store');
    if (!permitted(req)) { res.statusCode = 403; res.end('The curator is available on loopback only.'); return; }
    if (url.pathname === '/curate') return next();
    const send = (value: unknown, status = 200) => { res.statusCode = status; res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(value)); };
    try {
      if (req.method === 'GET' && url.pathname === '/__local/state') {
        const [posts,tags,pending,cfg,counts,lastSync] = await Promise.all([
          store.list(url.searchParams.get('view') ?? 'queue'),store.tags(),store.pending(),config(),
          store.db.prepare('SELECT review_state,download_state,published_at,COUNT(*) AS count FROM posts GROUP BY review_state,download_state,published_at IS NOT NULL').all(),
          store.db.prepare('SELECT * FROM sync_runs ORDER BY started_at DESC LIMIT 1').first(),
        ]);
        send({ posts,tags,pending: pending.map(r => ({ id: r.id,post_id: r.post_id,operation: r.operation })),status: jobs.status,counts: counts.results,lastSync,configured: !!cfg,reconnecting: !!reconnect }); return;
      }
      if (['GET','HEAD'].includes(req.method ?? '') && url.pathname.startsWith('/__local/media/')) {
        const key = decodeURIComponent(url.pathname.slice('/__local/media/'.length));
        if (!/^objects\/[a-f0-9]{64}\.(jpg|jpeg|png|webp|avif|mp4|mov|webm)$/.test(key)) { send({ error: 'Not found.' },404); return; }
        const request = new Request(url,{ method: req.method,headers: Object.fromEntries(Object.entries(req.headers).filter((entry): entry is [string,string] => typeof entry[1] === 'string')) });
        const response = await objectResponse(request,platform.env.MEDIA,key);
        res.statusCode = response.status;
        response.headers.forEach((value,key) => res.setHeader(key,value));
        if (response.body) { for await (const chunk of response.body) res.write(Buffer.from(chunk)); }
        res.end(); return;
      }
      if (req.method !== 'POST') { send({ error: 'Not found.' },404); return; }
      const data = await body(req);
      if (url.pathname === '/__local/preview') { send({ html: markdown(String(data.notes ?? '')) }); return; }
      if (url.pathname === '/__local/reconnect') {
        if (!await config()) throw new Error('Run pnpm setup:instagram in your terminal first.');
        if (reconnect) { send({ ok: true }); return; }
        reconnect = new Instagram();
        await jobs.drain();
        const page = await reconnect.open(false);
        await page.goto((await config())!.collectionUrl);
        send({ ok: true }); return;
      }
      if (url.pathname === '/__local/resume') {
        await reconnect?.close(); reconnect = null; jobs.sync(); send({ ok: true },202); return;
      }
      if (reconnect && ['/__local/sync','/__local/download'].includes(url.pathname)) throw new Error('Finish reconnecting and select Resume sync first.');
      if (url.pathname === '/__local/sync') { send({ started: jobs.sync() },202); return; }
      if (url.pathname === '/__local/download') {
        if (!Array.isArray(data.ids) || data.ids.some(id => typeof id !== 'string')) throw new Error('Expected post IDs.');
        jobs.prefetch(data.ids as string[]); send({ ok: true },202); return;
      }
      if (url.pathname === '/__local/save') {
        if (typeof data.id !== 'string' || typeof data.notes !== 'string' || !Array.isArray(data.tags) || data.tags.some(t => typeof t !== 'string')) throw new Error('Invalid revision.');
        await store.save(data.id,data.notes,data.tags as string[]); send({ ok: true }); return;
      }
      if (url.pathname === '/__local/review') {
        if (typeof data.id !== 'string' || !['ignore','restore','unpublish'].includes(String(data.action))) throw new Error('Invalid action.');
        await store.review(data.id,data.action as 'ignore' | 'restore' | 'unpublish'); send({ ok: true }); return;
      }
      if (url.pathname === '/__local/tag') {
        send({ id: await store.tag(String(data.name ?? ''),String(data.color) as TagColor,typeof data.id === 'string' ? data.id : undefined) }); return;
      }
      if (url.pathname === '/__local/merge') { await store.merge(String(data.from),String(data.into)); send({ ok: true }); return; }
      send({ error: 'Not found.' },404);
    } catch (error) { send({ error: (error as Error).message },400); }
  };
  return { middleware,close: async () => { await jobs.drain(); await reconnect?.close(); await platform.dispose(); await release(); } };
}
