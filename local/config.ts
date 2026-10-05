import { mkdir, readFile, writeFile } from 'node:fs/promises';
export interface LocalConfig { cobaltUrl: string; cobaltKey?: string; collectionId: string; collectionUrl: string }
export const ROOT = '.unrot';
export async function config(): Promise<LocalConfig | null> {
  try { return JSON.parse(await readFile(`${ROOT}/config.json`, 'utf8')); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
}
export async function saveConfig(value: LocalConfig) {
  const url = new URL(value.collectionUrl);
  if (url.origin !== 'https://www.instagram.com' || !/^[a-zA-Z0-9_-]+$/.test(value.collectionId)) throw new Error('Invalid Instagram collection.');
  if (!['http:', 'https:'].includes(new URL(value.cobaltUrl).protocol)) throw new Error('Invalid Cobalt URL.');
  await mkdir(ROOT, { recursive: true, mode: 0o700 });
  await writeFile(`${ROOT}/config.json`, JSON.stringify(value, null, 2), { mode: 0o600 });
}
