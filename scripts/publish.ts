import { getPlatformProxy } from 'wrangler';
import { readFile } from 'node:fs/promises';
import { localPlatform, migrate } from '../local/platform';
import { Store } from '../local/store';
import { publicationPlan, publishContent } from '../local/publish';
import { ROOT } from '../local/config';
import { lock } from '../local/lock';
import type { Bindings } from '../src/lib/types';
const release = await lock('publish');
const local = await localPlatform();
let remote: Awaited<ReturnType<typeof getPlatformProxy<Bindings>>> | undefined;
try {
  await migrate(local.env.DB);
  const store = new Store(local.env.DB);
  const plan = await publicationPlan(store);
  console.log(JSON.stringify({ revisions: plan.revisions.map(r => ({ post: r.post_id, operation: r.operation,revision: r.id })), tags: plan.tags.map(t => ({ id: t.id,name: t.name,color: t.color,mergedInto: t.merged_into })) },null,2));
  if (!process.argv.includes('--dry-run') && (plan.revisions.length || plan.tags.length)) {
    // Production bindings are declared remote only in this dedicated config.
    remote = await getPlatformProxy<Bindings>({ configPath: 'wrangler.publish.jsonc',remoteBindings: true,persist: false });
    const report = await publishContent(store,remote.env,plan,async key => {
      if (!/^objects\/[a-f0-9]{64}\.(jpg|jpeg|png|webp|avif|mp4|mov|webm)$/.test(key)) throw new Error('Invalid asset key.');
      return readFile(`${ROOT}/assets/${key}`);
    });
    console.log(JSON.stringify(report,null,2));
    if (report.failed.length) process.exitCode = 1;
  }
} finally { await remote?.dispose(); await local.dispose(); await release(); }
