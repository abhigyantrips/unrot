import { getPlatformProxy } from 'wrangler';
import { readFile } from 'node:fs/promises';
import type { Bindings } from '../src/lib/types';
export const LOCAL_STATE = '.wrangler/state/v3';
export async function localPlatform(persist: string | false = LOCAL_STATE) {
  return getPlatformProxy<Bindings>({ configPath: 'wrangler.jsonc', remoteBindings: false, persist: persist === false ? false : { path: persist } });
}
export async function migrate(db: D1Database, includeLocal = true) {
  for (const path of ['migrations/0001_public.sql', ...(includeLocal ? ['local/schema.sql'] : [])]) {
    const sql = await readFile(path, 'utf8');
    const statements = sql.split(';').map(s => s.trim()).filter(Boolean).map(s => db.prepare(s));
    await db.batch(statements);
  }
}
