/** Creates disposable remote resources; never writes fixture data to the live archive. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getPlatformProxy } from 'wrangler';
import { mkdtemp,writeFile,rm,readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { localPlatform,migrate } from '../local/platform';
import { Store } from '../local/store';
import { publicationPlan,publishContent } from '../local/publish';
import { getPost } from '../src/lib/public';
import type { Bindings } from '../src/lib/types';
const cli = async (...args: string[]) => (await promisify(execFile)('pnpm',['exec','wrangler',...args],{ maxBuffer: 1024 * 1024 })).stdout;
const name = `unrot-check-${Date.now()}`;
const temp = await mkdtemp(join(tmpdir(),'unrot-cloud-'));
let dbCreated = false,bucketCreated = false,remote: Awaited<ReturnType<typeof getPlatformProxy<Bindings>>> | undefined;
const local = await localPlatform(false);
try {
  const created = await cli('d1','create',name); dbCreated = true;
  const id = /"database_id":\s*"([a-f0-9-]+)"/.exec(created)?.[1]; if (!id) throw new Error('Could not read test database ID.');
  await cli('r2','bucket','create',name); bucketCreated = true;
  const base = JSON.parse(await readFile('wrangler.jsonc','utf8'));
  const path = `${temp}/wrangler.json`;
  await writeFile(path,JSON.stringify({ name,account_id: base.account_id,compatibility_date: base.compatibility_date,d1_databases: [{ binding: 'DB',database_name: name,database_id: id,remote: true }],r2_buckets: [{ binding: 'MEDIA',bucket_name: name,remote: true }] }));
  await cli('d1','execute',name,'--remote','--file',resolve('migrations/0001_public.sql'),'--config',path);
  remote = await getPlatformProxy<Bindings>({ configPath: path,remoteBindings: true,persist: false });
  await migrate(local.env.DB); const store = new Store(local.env.DB);
  const bytes = await sharp({ create: { width: 48,height: 48,channels: 3,background: '#d97706' } }).jpeg().toBuffer();
  const hash = createHash('sha256').update(bytes).digest('hex'),key = `objects/${hash}.jpg`;
  await store.discover({ id: 'cloud-test',source_url: 'https://www.instagram.com/p/TEST/',creator: 'test-fixture',caption: null,source_date: null,expected_count: 1,media: [{ url: '',type: 'image',width: 48,height: 48 }] });
  await store.assets('cloud-test',[{ position: 0,key,preview_key: key,type: 'image',mime: 'image/jpeg',width: 48,height: 48,hash,bytes: bytes.length }]);
  const tag = await store.tag('Remote validation','amber'); await store.save('cloud-test','first revision',[tag]);
  const plan = await publicationPlan(store);
  const failBucket = new Proxy(remote.env.MEDIA,{ get(target,prop) { if (prop === 'put') return async () => { throw new Error('simulated interrupted upload'); }; const value = Reflect.get(target,prop); return typeof value === 'function' ? value.bind(target) : value; } });
  assert.equal((await publishContent(store,{ DB: remote.env.DB,MEDIA: failBucket },plan,async () => bytes)).failed.length,1);
  assert.equal(await getPost(remote.env.DB,'cloud-test'),null);
  const failDB = new Proxy(remote.env.DB,{ get(target,prop) { if (prop === 'batch') return async () => { throw new Error('simulated metadata failure'); }; const value = Reflect.get(target,prop); return typeof value === 'function' ? value.bind(target) : value; } });
  assert.equal((await publishContent(store,{ DB: failDB,MEDIA: remote.env.MEDIA },await publicationPlan(store),async () => bytes)).failed.length,1);
  const publish = await publishContent(store,remote.env,await publicationPlan(store),async () => bytes); assert.equal(publish.failed.length,0); assert.equal(publish.skipped,2);
  const firstDate = (await getPost(remote.env.DB,'cloud-test'))!.published_at;
  assert.equal((await publishContent(store,remote.env,plan,async () => { throw new Error('Must reuse existing upload'); })).failed.length,0);
  await store.save('cloud-test','edited revision',[tag]); await publishContent(store,remote.env,await publicationPlan(store),async () => bytes);
  const edited = await getPost(remote.env.DB,'cloud-test'); assert.equal(edited!.published_at,firstDate); assert.equal(edited!.notes,'edited revision');
  await store.review('cloud-test','unpublish'); await publishContent(store,remote.env,await publicationPlan(store),async () => bytes); assert.equal(await getPost(remote.env.DB,'cloud-test'),null);
  console.log('Remote Cloudflare checks passed: interrupted upload, metadata failure, retry, repeat publish, edits, and unpublish.');
} finally {
  if (remote) { const listed = await remote.env.MEDIA.list(); for (const object of listed.objects) await remote.env.MEDIA.delete(object.key); await remote.dispose(); }
  await local.dispose();
  if (bucketCreated) await cli('r2','bucket','delete',name);
  if (dbCreated) await cli('d1','delete',name,'--skip-confirmation');
  await rm(temp,{ recursive: true,force: true });
}
