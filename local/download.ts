import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import type { Asset, Discovery, SourceMedia } from '../src/lib/types';
import { ROOT, type LocalConfig } from './config';
import type { Instagram } from './instagram';
const exec = promisify(execFile);
export interface Download { url: string; type?: 'image' | 'video' }
export function cobaltFiles(response: any): Download[] {
  if (['tunnel','redirect'].includes(response.status) && typeof response.url === 'string') return [{ url: response.url }];
  if (response.status === 'picker' && Array.isArray(response.picker) && response.picker.length) return response.picker.map((p: any) => {
    if (!p.url || !['photo','video','gif'].includes(p.type)) throw new Error('Invalid Cobalt picker response.');
    return { url: p.url, type: p.type === 'photo' ? 'image' : 'video' };
  });
  throw new Error(response.error?.code ?? `Unsupported Cobalt response: ${response.status}.`);
}
export function complete(files: Download[], metadata: SourceMedia[], expected: number) {
  return files.length === expected && expected > 0 && files.every((file,i) => !file.type || !metadata[i] || metadata[i]!.type === file.type);
}
export async function cobalt(config: LocalConfig, postUrl: string) {
  const response = await fetch(config.cobaltUrl, {
    method: 'POST', signal: AbortSignal.timeout(60000),
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(config.cobaltKey ? { Authorization: `Api-Key ${config.cobaltKey}` } : {}) },
    body: JSON.stringify({ url: postUrl, videoQuality: 'max', localProcessing: 'disabled' }),
  });
  if (!response.ok) throw new Error(`Cobalt request failed (${response.status}).`);
  return cobaltFiles(await response.json());
}
export async function storeObject(buffer: Buffer, ext: string, mime: string, bucket: R2Bucket, root = ROOT) {
  const hash = createHash('sha256').update(buffer).digest('hex');
  const key = `objects/${hash}.${ext}`;
  await mkdir(`${root}/assets/objects`,{ recursive: true });
  await writeFile(`${root}/assets/${key}`,buffer);
  if (!await bucket.head(key)) await bucket.put(key,buffer,{ httpMetadata: { contentType: mime } });
  return { key, hash };
}
async function processMedia(buffer: Buffer, expected: SourceMedia | undefined, position: number, bucket: R2Bucket, root = ROOT): Promise<Asset> {
  let type: 'image' | 'video', mime: string, ext: string, width: number, height: number, preview: Buffer;
  try {
    const image = sharp(buffer);
    const info = await image.metadata();
    if (!info.width || !info.height) throw new Error('Invalid image.');
    type = 'image'; width = info.autoOrient.width; height = info.autoOrient.height;
    ext = info.format === 'jpeg' ? 'jpg' : info.format;
    if (!['jpg','png','webp','avif'].includes(ext)) throw new Error('Unsupported original image format.');
    mime = `image/${ext === 'jpg' ? 'jpeg' : ext}`;
    preview = await image.rotate().resize(960,960,{ fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
  } catch {
    const temp = `${root}/temp/${crypto.randomUUID()}`;
    await mkdir(temp,{ recursive: true });
    try {
      const input = `${temp}/original`;
      await writeFile(input,buffer);
      const { stdout } = await exec('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=width,height:stream_tags=rotate:stream_side_data=rotation:format=format_name','-of','json',input]);
      const info = JSON.parse(stdout);
      const stream = info.streams?.[0];
      if (!stream?.width || !stream?.height) throw new Error('No playable video stream.');
      width = stream.width; height = stream.height;
      const rotation = Number(stream.side_data_list?.[0]?.rotation ?? stream.tags?.rotate ?? 0);
      if (Math.abs(rotation) % 180 === 90) [width,height] = [height,width];
      ext = String(info.format?.format_name).includes('webm') ? 'webm' : 'mp4';
      mime = `video/${ext}`; type = 'video';
      await exec('ffmpeg',['-v','error','-i',input,'-frames:v','1','-vf','scale=960:960:force_original_aspect_ratio=decrease','-y',`${temp}/poster.png`]);
      preview = await sharp(await readFile(`${temp}/poster.png`)).webp({ quality: 82 }).toBuffer();
    } finally { await rm(temp,{ recursive: true, force: true }); }
  }
  if (expected && expected.type !== type) throw new Error('Downloaded media does not match Instagram ordering/type.');
  const original = await storeObject(buffer,ext,mime,bucket,root);
  const poster = await storeObject(preview,'webp','image/webp',bucket,root);
  return { position,key: original.key,preview_key: poster.key,type,mime,width,height,hash: original.hash,bytes: buffer.length };
}
export async function downloadPost(config: LocalConfig, item: Discovery, instagram: Instagram, bucket: R2Bucket, root = ROOT): Promise<{ assets: Asset[]; discovery: Discovery }> {
  try {
    const files = await cobalt(config,item.source_url);
    if (!complete(files,item.media,item.expected_count)) throw new Error('Cobalt returned an incomplete carousel.');
    const assets: Asset[] = [];
    for (const [position,file] of files.entries()) {
      const response = await fetch(file.url,{ signal: AbortSignal.timeout(120000) });
      if (!response.ok) throw new Error(`Media download failed (${response.status}).`);
      assets.push(await processMedia(Buffer.from(await response.arrayBuffer()),item.media[position],position,bucket,root));
    }
    return { assets, discovery: item };
  } catch {
    // Refresh signed URLs immediately before authenticated fallback, including expired cached URLs.
    const refreshed = await instagram.refresh(item);
    if (refreshed.media.length !== refreshed.expected_count || !refreshed.media.length) throw new Error('Instagram returned incomplete media. Retry this item later.');
    const assets: Asset[] = [];
    for (const [position,media] of refreshed.media.entries()) {
      const { buffer } = await instagram.download(media.url);
      assets.push(await processMedia(buffer,media,position,bucket,root));
    }
    return { assets, discovery: refreshed };
  }
}
