import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import { ROOT } from './config';
/** Cross-process lock prevents concurrent CLI publishers or profile users. */
export async function lock(name: string) {
  await mkdir(ROOT,{ recursive: true,mode: 0o700 });
  const path = `${ROOT}/${name}.lock`;
  try { const handle = await open(path,'wx',0o600); await handle.writeFile(String(process.pid)); await handle.close(); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const pid = Number(await readFile(path,'utf8'));
    try { process.kill(pid,0); } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ESRCH') { await unlink(path); return lock(name); }
    }
    throw new Error(`${name} is already running (process ${pid}). Stop it before continuing.`);
  }
  return async () => { await unlink(path).catch(() => {}); };
}
