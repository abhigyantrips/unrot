import { test,before,after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm,mkdir,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { localPlatform,migrate } from '../local/platform';
import { Store } from '../local/store';
import { extractDiscoveries,parseCollection,scanCollection,retry,SessionExpired } from '../local/instagram';
import { cobaltFiles,complete } from '../local/download';
import { publicationPlan,publishContent } from '../local/publish';
import { getPost,listPosts,listTags } from '../src/lib/public';
import { serveMedia,objectResponse } from '../src/lib/media';
import { markdown } from '../src/lib/markdown';
import { permitted } from '../local/bridge';
import { exportArchive,restoreArchive } from '../local/backup';
import type { Asset,Discovery } from '../src/lib/types';
let local: Awaited<ReturnType<typeof localPlatform>>,remote: typeof local,store: Store;
const data = Buffer.from('an archived original image');
const hash = createHash('sha256').update(data).digest('hex');
const key = `objects/${hash}.jpg`;
const asset: Asset = { position: 0,key,preview_key: key,type: 'image',mime: 'image/jpeg',width: 640,height: 480,hash,bytes: data.length };
const source = (id = '123'): Discovery => ({ id,source_url: `https://www.instagram.com/p/ABC${id}/`,creator: 'maker',caption: 'original',source_date: '2024-01-01T00:00:00.000Z',media: [{ url: 'https://cdninstagram.com/image',type: 'image',width: 640,height: 480 }],expected_count: 1 });
let tagA: string,tagB: string;
before(async () => { local = await localPlatform(false); remote = await localPlatform(false); await migrate(local.env.DB); await migrate(remote.env.DB); store = new Store(local.env.DB); });
after(async () => { await local.dispose(); await remote.dispose(); });
test('REST and GraphQL discovery normalize ordered mixed carousels and optional metadata',() => {
  const rest = { items: [{ media: { pk: '123_999',code: 'ABC',user: { username: 'maker' },taken_at: 1704067200,caption: { text: 'caption' },carousel_media_count: 2,carousel_media: [{ image_versions2: { candidates: [{ url: 'image' }] },original_width: 800,original_height: 1000 },{ video_versions: [{ url: 'video' }],original_width: 1920,original_height: 1080 }] } }],more_available: true,next_max_id: 'next' };
  const page = parseCollection(rest); assert.equal(page.more,true); assert.equal(page.items[0]!.id,'123'); assert.deepEqual(page.items[0]!.media.map(m => m.type),['image','video']);
  assert.equal(page.items[0]!.source_date,'2024-01-01T00:00:00.000Z');
  const graph = { data: { saved: { edges: [{ node: { id: '456',shortcode: 'DEF',owner: { username: 'other' },edge_sidecar_to_children: { edges: [{ node: { display_url: 'photo',dimensions: { width: 400,height: 400 } } },{ node: { is_video: true,video_url: 'movie' } }] } } }],page_info: { has_next_page: false,end_cursor: null } } } };
  assert.equal(parseCollection(graph).items[0]!.expected_count,2); assert.equal(extractDiscoveries(graph)[0]!.caption,null);
  assert.throws(() => parseCollection({ items: [] }),/pagination/);
});
test('full pagination deduplicates, discovers older additions, preserves edits and ignored records',async () => {
  await store.discover(source()); await store.assets('123',[asset]);
  tagA = await store.tag('Architecture','amber'); tagB = await store.tag('Places','teal');
  await store.save('123','curated notes',[tagA]);
  await store.discover(source('ignored')); await store.review('ignored','ignore');
  const count = await scanCollection({ items: [source(),source('ignored')],more: true,cursor: 'page2' },async () => ({ items: [source(),source('older')],more: false,cursor: null }),async items => { for (const item of items) await store.discover(item); },0);
  assert.equal(count,3); assert.equal((await store.post('123'))!.notes,'curated notes'); assert.equal((await store.post('ignored'))!.review_state,'ignored'); assert.ok(await store.post('older'));
  await store.review('ignored','restore'); assert.equal((await store.post('ignored'))!.review_state,'queue');
});
test('interrupted scans preserve discovered records and session expiry stops retries',async () => {
  await assert.rejects(scanCollection({ items: [source('partial')],more: true,cursor: 'next' },async () => { throw new SessionExpired(); },async items => { for (const item of items) await store.discover(item); },0),SessionExpired);
  assert.ok(await store.post('partial'));
  let attempts = 0; await assert.rejects(retry(async () => { attempts++; throw new SessionExpired(); },3,0)); assert.equal(attempts,1);
  await store.setDownload('partial','downloading'); await store.recover(); assert.equal((await store.post('partial'))!.download_state,'pending');
});
test('Cobalt single files, tunnels, ordered picker, errors and completeness',() => {
  assert.equal(cobaltFiles({ status: 'redirect',url: 'one' }).length,1);
  assert.equal(cobaltFiles({ status: 'tunnel',url: 'one' })[0]!.url,'one');
  const files = cobaltFiles({ status: 'picker',picker: [{ type: 'photo',url: 'a' },{ type: 'video',url: 'b' }] });
  assert.deepEqual(files.map(f => f.url),['a','b']); assert.equal(complete(files,[{ type: 'image' } as any,{ type: 'video' } as any],2),true);
  assert.equal(complete(files,[],3),false); assert.equal(complete(files,[{ type: 'video' } as any],2),false);
  assert.throws(() => cobaltFiles({ status: 'error',error: { code: 'fetch.failed' } }),/fetch.failed/);
  assert.throws(() => cobaltFiles({ status: 'picker',picker: [] }));
});
test('required tags, complete downloads and sanitized Markdown',async () => {
  await assert.rejects(store.save('older','',[tagA]),/Download all/);
  await assert.rejects(store.save('123','',[]),/at least one/);
  await assert.rejects(store.tag('bad','pink' as any),/palette/);
  const html = markdown('<script>alert(1)</script>\n\n[unsafe](javascript:alert(1))\n\n**good** [link](https://example.com)');
  assert.ok(!html.includes('<script>')); assert.ok(!html.includes('href="javascript:')); assert.ok(html.includes('<strong>good</strong>')); assert.ok(html.includes('noopener noreferrer'));
});
test('interrupted uploads leave revisions pending and posts invisible',async () => {
  let failed = false;
  const bucket = new Proxy(remote.env.MEDIA,{ get(target,prop) { if (prop === 'put') return async () => { failed = true; throw new Error('upload interrupted'); }; const value = Reflect.get(target,prop); return typeof value === 'function' ? value.bind(target) : value; } });
  const report = await publishContent(store,{ DB: remote.env.DB,MEDIA: bucket },await publicationPlan(store),async () => data);
  assert.equal(failed,true); assert.equal(report.failed.length,1); assert.equal((await store.pending()).length,1); assert.equal(await getPost(remote.env.DB,'123'),null);
});
test('metadata failures retain pending revisions; repeating publish reuses objects and stable IDs',async () => {
  const db = new Proxy(remote.env.DB,{ get(target,prop) { if (prop === 'batch') return async () => { throw new Error('metadata failed'); }; const value = Reflect.get(target,prop); return typeof value === 'function' ? value.bind(target) : value; } });
  const failed = await publishContent(store,{ DB: db,MEDIA: remote.env.MEDIA },await publicationPlan(store),async () => data);
  assert.equal(failed.failed.length,1); assert.equal(await getPost(remote.env.DB,'123'),null);
  const plan = await publicationPlan(store);
  const first = await publishContent(store,remote.env,plan,async () => data); assert.equal(first.succeeded.length,1); assert.equal(first.uploaded,0);
  const date = (await getPost(remote.env.DB,'123'))!.published_at;
  const repeated = await publishContent(store,remote.env,plan,async () => { throw new Error('must skip existing'); }); assert.equal(repeated.failed.length,0);
  assert.equal((await listPosts(remote.env.DB,new URLSearchParams())).posts.length,1); assert.equal((await getPost(remote.env.DB,'123'))!.published_at,date);
  await store.save('123','edited locally',[tagA,tagB]); assert.equal((await getPost(remote.env.DB,'123'))!.notes,'curated notes');
  await publishContent(store,remote.env,await publicationPlan(store),async () => data); assert.equal((await getPost(remote.env.DB,'123'))!.notes,'edited locally'); assert.equal((await getPost(remote.env.DB,'123'))!.published_at,date);
});
test('rename, palette color and merges apply through post revisions',async () => {
  await store.tag('Buildings','orange',tagA); assert.equal((await store.tags()).find(t => t.id === tagA)!.color,'orange');
  assert.equal((await listTags(remote.env.DB)).find(t => t.id === tagA)!.name,'Architecture');
  await store.merge(tagA,tagB); assert.equal((await store.post('123'))!.tags.length,1); assert.equal((await store.pending()).length,1);
  await publishContent(store,remote.env,await publicationPlan(store),async () => data);
  assert.deepEqual((await getPost(remote.env.DB,'123'))!.tags.map(t => t.id),[tagB]); assert.equal((await listTags(remote.env.DB)).length,1);
});
test('Any/All filters, unknown tags, stable cursor ordering and private records',async () => {
  const third = await store.tag('Design','rose');
  for (let i = 0; i < 26; i++) { const id = `batch${String(i).padStart(2,'0')}`; await store.discover(source(id)); await store.assets(id,[asset]); await store.save(id,'',[tagB,...(i % 2 === 0 ? [third] : [])]); }
  await publishContent(store,remote.env,await publicationPlan(store),async () => data);
  const first = await listPosts(remote.env.DB,new URLSearchParams()); assert.equal(first.posts.length,24); assert.ok(first.cursor);
  const second = await listPosts(remote.env.DB,new URLSearchParams({ cursor: first.cursor! })); assert.equal(second.posts.length,3); assert.equal(second.cursor,null);
  assert.equal(new Set([...first.posts,...second.posts].map(p => p.id)).size,27);
  const all = new URLSearchParams({ match: 'all' }); all.append('tag',tagB); all.append('tag',third);
  assert.equal((await listPosts(remote.env.DB,all)).posts.length,13);
  all.set('match','any'); assert.equal((await listPosts(remote.env.DB,all)).posts.length,24);
  assert.equal((await listPosts(remote.env.DB,new URLSearchParams({ tag: 'nonexistent' }))).posts.length,0);
  await assert.rejects(listPosts(remote.env.DB,new URLSearchParams({ cursor: 'bad' })),/cursor/);
  assert.equal(await getPost(remote.env.DB,'ignored'),null); assert.equal(await getPost(remote.env.DB,'partial'),null);
});
test('R2 HEAD, seeking ranges, conditions and authorization',async () => {
  const request = (headers: Record<string,string> = {},method = 'GET') => new Request(`https://archive.test/media/${key}`,{ headers,method });
  const response = await serveMedia(request({ Range: 'bytes=3-8' }),remote.env.DB,remote.env.MEDIA,key);
  assert.equal(response.status,206); assert.equal(await response.text(),data.subarray(3,9).toString()); assert.equal(response.headers.get('Content-Range'),`bytes 3-8/${data.length}`);
  const suffix = await serveMedia(request({ Range: 'bytes=-4' }),remote.env.DB,remote.env.MEDIA,key); assert.equal(await suffix.text(),data.subarray(-4).toString());
  assert.equal((await serveMedia(request({ Range: 'bytes=999-' }),remote.env.DB,remote.env.MEDIA,key)).status,416);
  const head = await serveMedia(request({},'HEAD'),remote.env.DB,remote.env.MEDIA,key); assert.equal(await head.text(),''); assert.equal(head.headers.get('Content-Length'),String(data.length));
  assert.equal((await objectResponse(request({ 'If-None-Match': head.headers.get('ETag')! }),remote.env.MEDIA,key)).status,304);
  assert.equal((await objectResponse(request({ Range: 'bytes=0-2','If-Range': '"wrong"' }),remote.env.MEDIA,key)).status,200);
});
test('unpublish stages locally, hides live record only after publish and retains local media',async () => {
  await store.review('123','unpublish'); assert.ok(await getPost(remote.env.DB,'123'));
  await publishContent(store,remote.env,await publicationPlan(store),async () => data); assert.equal(await getPost(remote.env.DB,'123'),null); assert.equal((await store.post('123'))!.assets.length,1);
});
test('loopback and exact origins required for curator mutations',() => {
  const req = { headers: { host: '127.0.0.1:4321',origin: 'http://127.0.0.1:4321' },method: 'POST',socket: { remoteAddress: '127.0.0.1' } };
  assert.equal(permitted(req),true); assert.equal(permitted({ ...req,headers: { ...req.headers,origin: 'https://attacker.test' } }),false);
  assert.equal(permitted({ ...req,socket: { remoteAddress: '10.0.0.2' } }),false); assert.equal(permitted({ ...req,headers: { host: req.headers.host } }),false);
  assert.equal(permitted({ ...req,headers: { host: 'attacker.test',origin: 'http://attacker.test' } }),false);
});
test('portable backup restores metadata and originals, excludes session files and rejects corruption',async () => {
  const temp = await mkdtemp(join(tmpdir(),'unrot-backup-')); const original = `${temp}/originals`; await mkdir(`${original}/objects`,{ recursive: true }); await writeFile(`${original}/${key}`,data);
  const target = await localPlatform(false);
  try {
    await migrate(target.env.DB);
    const exported = await exportArchive(local.env.DB,`${temp}/export`,original); assert.equal(exported.objects,1);
    const restored = await restoreArchive(target.env.DB,target.env.MEDIA,`${temp}/export`,false,`${temp}/restored`); assert.ok(restored.posts > 0);
    const restoredStore = new Store(target.env.DB); assert.equal((await restoredStore.post('123'))!.notes,'edited locally');
    assert.equal((await restoredStore.tags())[0]!.name,'Design'); assert.ok(await target.env.MEDIA.head(key));
    await assert.rejects(restoreArchive(target.env.DB,target.env.MEDIA,`${temp}/export`,false),/not empty/);
    await writeFile(`${temp}/export/assets/${key}`,'corrupt'); await assert.rejects(restoreArchive(target.env.DB,target.env.MEDIA,`${temp}/export`,true),/Corrupt/);
  } finally { await target.dispose(); await rm(temp,{ recursive: true,force: true }); }
});
test('tag merges update ignored publications and finish after affected posts are unpublished',async () => {
  const from = await store.tag('Merge source','stone'),into = await store.tag('Merge destination','amber');
  for (const id of ['merge-ignored','merge-hidden']) {
    await store.discover(source(id)); await store.assets(id,[asset]); await store.save(id,'',[from]);
  }
  await publishContent(store,remote.env,await publicationPlan(store),async () => data);
  await store.review('merge-ignored','ignore'); await store.review('merge-hidden','unpublish');
  await publishContent(store,remote.env,await publicationPlan(store),async () => data);
  await store.merge(from,into);
  assert.equal((await store.post('merge-ignored'))!.review_state,'ignored');
  await publishContent(store,remote.env,await publicationPlan(store),async () => data);
  assert.equal((await store.post('merge-ignored'))!.review_state,'ignored');
  assert.deepEqual((await getPost(remote.env.DB,'merge-ignored'))!.tags.map(tag => tag.id),[into]);
  assert.equal(await getPost(remote.env.DB,'merge-hidden'),null);
  assert.equal((await publicationPlan(store)).tags.some(tag => tag.id === from),false);
});
