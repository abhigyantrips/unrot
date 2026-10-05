import { before,after,test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer,type Server } from 'node:http';
import { mkdtemp,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { localPlatform } from '../local/platform';
import { downloadPost } from '../local/download';
import { Instagram } from '../local/instagram';
import type { Discovery } from '../src/lib/types';
let server: Server,root: string,image: Buffer,video: Buffer,url: string,platform: Awaited<ReturnType<typeof localPlatform>>,response: unknown;
const source = (types: ('image' | 'video')[]): Discovery => ({ id: 'download-test',source_url: 'https://www.instagram.com/p/TEST/',creator: 'tester',caption: null,source_date: null,expected_count: types.length,media: types.map(type => ({ url: 'https://expired.cdninstagram.com/old',type,width: 64,height: 48 })) });
before(async () => {
  root = await mkdtemp(join(tmpdir(),'unrot-download-')); platform = await localPlatform(false);
  image = await sharp({ create: { width: 64,height: 48,channels: 3,background: '#d97706' } }).jpeg().toBuffer();
  await promisify(execFile)('ffmpeg',['-v','error','-f','lavfi','-i','color=c=teal:s=64x48:d=2','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart','-y',`${root}/fixture.mp4`]); video = await readFile(`${root}/fixture.mp4`);
  server = createServer((req,res) => {
    if (req.method === 'POST') { res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(response)); }
    else if (req.url === '/expired') { res.statusCode = 403; res.end(); }
    else { res.setHeader('Content-Type',req.url === '/video' ? 'video/mp4' : 'image/jpeg'); res.end(req.url === '/video' ? video : image); }
  });
  await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve)); url = `http://127.0.0.1:${(server.address() as any).port}`;
});
after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await platform.dispose(); await rm(root,{ recursive: true,force: true }); });
const cfg = () => ({ cobaltUrl: url,collectionId: 'collection',collectionUrl: 'https://www.instagram.com/test/saved/collection/' });
const noFallback = { refresh: async () => { throw new Error('Unexpected fallback'); } } as unknown as Instagram;
test('single image originals are preserved, hashed and have generated thumbnails',async () => {
  response = { status: 'redirect',url: `${url}/image` };
  const { assets } = await downloadPost(cfg(),source(['image']),noFallback,platform.env.MEDIA,root);
  assert.equal(assets[0]!.type,'image'); assert.equal(assets[0]!.width,64); assert.equal(assets[0]!.height,48);
  assert.deepEqual(await readFile(`${root}/assets/${assets[0]!.key}`),image);
  assert.ok(assets[0]!.preview_key.endsWith('.webp')); assert.ok(await platform.env.MEDIA.head(assets[0]!.preview_key));
});
test('reels generate posters while keeping the original video',async () => {
  response = { status: 'tunnel',url: `${url}/video` };
  const { assets } = await downloadPost(cfg(),source(['video']),noFallback,platform.env.MEDIA,root);
  assert.equal(assets[0]!.type,'video'); assert.equal(assets[0]!.mime,'video/mp4'); assert.equal(assets[0]!.width,64); assert.deepEqual(await readFile(`${root}/assets/${assets[0]!.key}`),video);
});
test('image, video, and mixed picker carousels retain all ordered originals',async () => {
  for (const types of [['image','image'],['video','video'],['image','video','image']] as ('image' | 'video')[][]) {
    response = { status: 'picker',picker: types.map(type => ({ type: type === 'image' ? 'photo' : 'video',url: `${url}/${type}` })) };
    const { assets } = await downloadPost(cfg(),source(types),noFallback,platform.env.MEDIA,root); assert.deepEqual(assets.map(a => a.type),types); assert.deepEqual(assets.map(a => a.position),types.map((_,i) => i));
  }
});
test('Cobalt errors, incomplete pickers, expired tunnels and type mismatches refresh authenticated sources',async () => {
  for (const bad of [{ status: 'error',error: { code: 'fetch.failed' } },{ status: 'picker',picker: [{ type: 'photo',url: `${url}/image` }] },{ status: 'tunnel',url: `${url}/expired` },{ status: 'picker',picker: [{ type: 'video',url: `${url}/video` },{ type: 'photo',url: `${url}/image` }] }]) {
    response = bad; let refreshed = false;
    const browser = {
      refresh: async () => { refreshed = true; const post = source(['image','video']); post.media[0]!.url = 'fresh-image'; post.media[1]!.url = 'fresh-video'; return post; },
      download: async (mediaUrl: string) => { assert.equal(refreshed,true); assert.ok(mediaUrl.startsWith('fresh')); return { buffer: mediaUrl.endsWith('image') ? image : video,mime: '' }; },
    } as unknown as Instagram;
    const { assets } = await downloadPost(cfg(),source(['image','video']),browser,platform.env.MEDIA,root); assert.equal(refreshed,true); assert.deepEqual(assets.map(a => a.type),['image','video']);
  }
});
test('unresolved or incomplete authenticated media rejects without claiming completeness',async () => {
  response = { status: 'error',error: { code: 'fetch.failed' } };
  const browser = { refresh: async () => ({ ...source(['image']),expected_count: 2 }) } as unknown as Instagram;
  await assert.rejects(downloadPost(cfg(),source(['image','video']),browser,platform.env.MEDIA,root),/incomplete media/);
});
