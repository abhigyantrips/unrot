import { localPlatform,migrate } from '../local/platform';
import { exportArchive,restoreArchive } from '../local/backup';
import { Store } from '../local/store';
import { lock } from '../local/lock';
const release = await lock('curator');
const publishRelease = await lock('publish');
const platform = await localPlatform();
try {
  await migrate(platform.env.DB);
  const [command,directory] = process.argv.slice(2).filter(arg => arg !== '--replace');
  if (command === 'export') console.log(await exportArchive(platform.env.DB,directory ?? `backups/${new Date().toISOString().replaceAll(':','-')}`));
  else if (command === 'restore' && directory) { console.log(await restoreArchive(platform.env.DB,platform.env.MEDIA,directory,process.argv.includes('--replace'))); await new Store(platform.env.DB).recover(); }
  else throw new Error('Usage: pnpm backup [directory] or pnpm restore <directory> [--replace]');
} finally { await platform.dispose(); await publishRelease(); await release(); }
