import { randomUUID } from 'node:crypto';
import { Store } from './store';
import { Instagram, scanCollection, SessionExpired } from './instagram';
import { config } from './config';
import { downloadPost } from './download';
import type { Discovery } from '../src/lib/types';
export interface JobStatus { state: 'idle' | 'syncing' | 'downloading' | 'reconnect' | 'failed'; message: string; discovered: number }
export class Jobs {
  status: JobStatus = { state: 'idle', message: 'Ready to sync.', discovered: 0 };
  private chain = Promise.resolve();
  private syncing = false;
  private downloads = new Set<string>();
  constructor(private store: Store, private bucket: R2Bucket) {}
  private enqueue(job: () => Promise<void>) {
    this.chain = this.chain.then(job).catch(error => { this.status = { ...this.status, state: error instanceof SessionExpired ? 'reconnect' : 'failed', message: (error as Error).message }; });
  }
  sync() {
    if (this.syncing) return false;
    this.syncing = true;
    this.enqueue(async () => {
      try {
      const cfg = await config();
      if (!cfg) { this.syncing = false; this.status = { ...this.status, state: 'reconnect', message: 'Run pnpm setup:instagram to select an Instagram collection.' }; return; }
      const id = randomUUID();
      const browser = new Instagram();
      this.status = { state: 'syncing', message: 'Reading every collection page…', discovered: 0 };
      await this.store.db.prepare('INSERT INTO sync_runs(id,started_at,state) VALUES(?,?,?)').bind(id,new Date().toISOString(),'running').run();
      try {
        const feed = await browser.collection(cfg);
        const count = await scanCollection(feed.first,feed.next,async items => {
          for (const item of items) await this.store.discover(item);
          this.status.discovered += items.length;
          await this.store.db.prepare('UPDATE sync_runs SET discovered=? WHERE id=?').bind(this.status.discovered,id).run();
        });
        await this.store.db.prepare("UPDATE sync_runs SET state='complete',finished_at=?,discovered=? WHERE id=?").bind(new Date().toISOString(),count,id).run();
        this.status = { state: 'idle', message: `Scanned ${count} saved posts. Existing edits were preserved.`, discovered: count };
      } catch (error) {
        await this.store.db.prepare("UPDATE sync_runs SET state='failed',finished_at=?,error=? WHERE id=?").bind(new Date().toISOString(),(error as Error).message,id).run();
        throw error;
      } finally { this.syncing = false; await browser.close(); }
      } finally { this.syncing = false; }
    });
    return true;
  }
  prefetch(ids: string[]) {
    for (const id of ids.slice(0,3)) {
      if (this.downloads.has(id)) continue;
      this.downloads.add(id);
      this.enqueue(async () => {
        const browser = new Instagram();
        try {
          const post = await this.store.post(id);
          if (!post || post.review_state === 'ignored' || post.download_state === 'complete') return;
          const cfg = await config();
          if (!cfg) throw new Error('Run pnpm setup:instagram before downloading.');
          this.status = { ...this.status,state: 'downloading',message: `Downloading ${post.creator ? '@' + post.creator : id}…` };
          await this.store.setDownload(id,'downloading');
          const item: Discovery = { ...post,media: JSON.parse(post.media_json) };
          const result = await downloadPost(cfg,item,browser,this.bucket);
          await this.store.discover(result.discovery);
          await this.store.assets(id,result.assets);
          this.status = { ...this.status,state: 'idle',message: 'Media downloaded. Ready to curate.' };
        } catch (error) { await this.store.setDownload(id,'failed',(error as Error).message); throw error; }
        finally { this.downloads.delete(id); await browser.close(); }
      });
    }
  }
  async drain() { await this.chain; }
}
