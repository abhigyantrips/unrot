import { createHash } from 'node:crypto';
import { mkdir,readFile,writeFile,copyFile,readdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { resolve,relative } from 'node:path';
import { ROOT } from './config';
export const TABLES = ['posts','assets','tags','post_tags','revisions','sync_runs','live_posts','live_assets','live_tags','live_post_tags'] as const;
const DELETE_ORDER = ['live_post_tags','live_assets','live_posts','live_tags','post_tags','assets','revisions','sync_runs','posts','tags'];
export interface Backup { format: 'unrot-v1'; exported_at: string; tables: Record<string,Record<string,any>[]>; objects: string[] }
const validKey = (key: string) => /^objects\/[a-f0-9]{64}\.(jpg|jpeg|png|webp|avif|mp4|mov|webm)$/.test(key);
export async function exportArchive(db: D1Database, directory: string, assetRoot = `${ROOT}/assets`) {
  const target = resolve(directory);
  if (!relative(resolve(ROOT),target).startsWith('..')) throw new Error('Backups must be outside the local state directory.');
  await mkdir(target,{ recursive: true,mode: 0o700 });
  const results = await db.batch(TABLES.map(t => db.prepare(`SELECT * FROM ${t}`)));
  const tables = Object.fromEntries(TABLES.map((t,index) => [t,results[index]!.results])) as Backup['tables'];
  // Signed source URLs are ephemeral; restore can refresh them through Instagram.
  for (const post of tables.posts!) post.media_json = JSON.stringify(JSON.parse(post.media_json).map((media: any) => ({ ...media,url: '' })));
  const files = await readdir(`${assetRoot}/objects`).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return []; throw error; });
  const objects = [...new Set([...tables.assets!,...tables.live_assets!].flatMap(a => [a.key,a.preview_key]).concat(files.map(file => `objects/${file}`)))] as string[];
  await mkdir(`${target}/assets/objects`,{ recursive: true });
  for (const key of objects) {
    if (!validKey(key)) throw new Error('Invalid asset key in metadata.');
    await copyFile(`${assetRoot}/${key}`,`${target}/assets/${key}`);
  }
  const backup: Backup = { format: 'unrot-v1',exported_at: new Date().toISOString(),tables,objects };
  await writeFile(`${target}/metadata.json`,JSON.stringify(backup,null,2),{ mode: 0o600 });
  return { directory: target,posts: tables.posts!.length,objects: objects.length };
}
export async function restoreArchive(db: D1Database,bucket: R2Bucket,directory: string,replace = false,assetRoot = `${ROOT}/assets`) {
  const backup: Backup = JSON.parse(await readFile(`${directory}/metadata.json`,'utf8'));
  if (backup.format !== 'unrot-v1' || !backup.tables || !Array.isArray(backup.objects) || TABLES.some(t => !Array.isArray(backup.tables[t]))) throw new Error('Unsupported or incomplete backup.');
  const count = await db.prepare('SELECT COUNT(*) AS count FROM posts').first<{ count: number }>();
  if (count?.count && !replace) throw new Error('Local archive is not empty. Export it first; use --replace to restore this backup over it.');
  const objects = new Set(backup.objects);
  for (const asset of [...backup.tables.assets!,...backup.tables.live_assets!]) if (!objects.has(asset.key) || !objects.has(asset.preview_key)) throw new Error('Backup is missing referenced assets.');
  for (const key of backup.objects) {
    if (!validKey(key)) throw new Error('Invalid backup asset path.');
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(`${directory}/assets/${key}`)) hash.update(chunk);
    if (hash.digest('hex') !== key.split('/')[1]!.split('.')[0]) throw new Error(`Corrupt asset: ${key}`);
  }
  const statements = DELETE_ORDER.map(t => db.prepare(`DELETE FROM ${t}`));
  const INSERT_ORDER = ['posts','tags','assets','post_tags','revisions','sync_runs','live_posts','live_tags','live_assets','live_post_tags'];
  for (const table of INSERT_ORDER) {
    const info = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
    const columns = info.results.map(c => c.name);
    for (const row of backup.tables[table]!) {
      if (Object.keys(row).some(k => !columns.includes(k)) || columns.some(k => !Object.hasOwn(row,k))) throw new Error(`Unexpected metadata columns in ${table}.`);
      statements.push(db.prepare(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`).bind(...columns.map(c => row[c])));
    }
  }
  await mkdir(`${assetRoot}/objects`,{ recursive: true });
  for (const key of backup.objects) {
    const asset = [...backup.tables.assets!,...backup.tables.live_assets!].find(a => a.key === key);
    const ext = key.split('.').at(-1)!;
    const mime = asset?.mime ?? (ext === 'jpg' ? 'image/jpeg' : ['mp4','mov','webm'].includes(ext) ? `video/${ext === 'mov' ? 'quicktime' : ext}` : `image/${ext}`);
    await copyFile(`${directory}/assets/${key}`,`${assetRoot}/${key}`);
    const buffer = await readFile(`${assetRoot}/${key}`);
    await bucket.put(key,buffer,{ httpMetadata: { contentType: mime } });
  }
  // D1 batches roll back the entire metadata restoration on failure.
  await db.batch(statements);
  return { posts: backup.tables.posts!.length,objects: objects.size };
}
