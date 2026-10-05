import type { Asset, Post, Revision, Tag } from '../src/lib/types';
import type { Store } from './store';
import { createHash } from 'node:crypto';
export interface DirtyTag extends Tag { version: number; acknowledged_version: number; merged_into: string | null }
export interface PublishPlan { revisions: Revision[]; tags: DirtyTag[] }
export async function publicationPlan(store: Store): Promise<PublishPlan> {
  const [revisions,tags] = await Promise.all([
    store.pending(), store.db.prepare('SELECT * FROM tags WHERE version>acknowledged_version').all<DirtyTag>(),
  ]);
  return { revisions, tags: tags.results };
}
function assetStatement(db: D1Database, id: string, a: Asset) {
  return db.prepare('INSERT INTO live_assets(post_id,position,key,preview_key,type,mime,width,height,hash,bytes) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id,a.position,a.key,a.preview_key,a.type,a.mime,a.width,a.height,a.hash,a.bytes);
}
export async function publishContent(store: Store, remote: { DB: D1Database; MEDIA: R2Bucket }, plan: PublishPlan, read: (key: string) => Promise<Uint8Array>) {
  const report: { succeeded: string[]; failed: { id: string; error: string }[]; uploaded: number; skipped: number } = { succeeded: [], failed: [], uploaded: 0, skipped: 0 };
  const now = new Date().toISOString();
  // Tag metadata is independent of draft post revisions. A merge retains its old public
  // tag until every affected post revision succeeds, preventing dangling associations.
  for (const tag of plan.tags.filter(t => !t.merged_into)) {
    await remote.DB.prepare('INSERT INTO live_tags(id,name,color) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,color=excluded.color').bind(tag.id,tag.name,tag.color).run();
    await store.db.prepare('UPDATE tags SET acknowledged_version=? WHERE id=? AND version=?').bind(tag.version,tag.id,tag.version).run();
  }
  for (const revision of plan.revisions) {
    try {
      const post: Post = JSON.parse(revision.snapshot);
      if (revision.operation === 'unpublish') {
        await remote.DB.batch([
          remote.DB.prepare('UPDATE live_posts SET visible=0,revision_id=?,updated_at=? WHERE id=?').bind(revision.id,now,post.id),
          remote.DB.prepare('DELETE FROM live_post_tags WHERE post_id=?').bind(post.id),
        ]);
      } else {
        if (!post.assets.length || !post.tags.length) throw new Error('Revision has incomplete media or no tags.');
        for (const asset of post.assets) {
          for (const [key,mime] of [[asset.key,asset.mime],[asset.preview_key,'image/webp']]) {
            if (await remote.MEDIA.head(key!)) { report.skipped++; continue; }
            const bytes = await read(key!);
            if (createHash('sha256').update(bytes).digest('hex') !== key!.split('/')[1]?.split('.')[0]) throw new Error(`Corrupt local media: ${key}`);
            await remote.MEDIA.put(key!,bytes,{ httpMetadata: { contentType: mime! } });
            report.uploaded++;
          }
        }
        // One atomic parameterized D1 batch per post, after all media is present.
        await remote.DB.batch([
          ...post.tags.map(tag => remote.DB.prepare('INSERT OR IGNORE INTO live_tags(id,name,color) VALUES(?,?,?)').bind(tag.id,tag.name,tag.color)),
          remote.DB.prepare(`INSERT INTO live_posts(id,source_url,creator,caption,source_date,notes,published_at,updated_at,revision_id,visible) VALUES(?,?,?,?,?,?,?,?,?,1)
            ON CONFLICT(id) DO UPDATE SET source_url=excluded.source_url,creator=excluded.creator,caption=excluded.caption,source_date=excluded.source_date,notes=excluded.notes,updated_at=excluded.updated_at,revision_id=excluded.revision_id,visible=1`)
            .bind(post.id,post.source_url,post.creator,post.caption,post.source_date,post.notes,post.published_at ?? revision.created_at,now,revision.id),
          remote.DB.prepare('DELETE FROM live_assets WHERE post_id=?').bind(post.id),
          ...post.assets.map(a => assetStatement(remote.DB,post.id,a)),
          remote.DB.prepare('DELETE FROM live_post_tags WHERE post_id=?').bind(post.id),
          ...post.tags.map(t => remote.DB.prepare('INSERT INTO live_post_tags(post_id,tag_id) VALUES(?,?)').bind(post.id,t.id)),
        ]);
      }
      const published = await remote.DB.prepare('SELECT published_at FROM live_posts WHERE id=?').bind(post.id).first<{ published_at: string }>();
      await store.db.batch([
        store.db.prepare("UPDATE revisions SET state='acknowledged',error=NULL WHERE id=? AND state='pending'").bind(revision.id),
        store.db.prepare(`UPDATE posts SET acknowledged_revision=?,published_at=?,review_state=CASE WHEN review_state='ignored' THEN 'ignored' WHEN EXISTS(SELECT 1 FROM revisions WHERE post_id=? AND state='pending') THEN 'ready' ELSE 'queue' END WHERE id=?`).bind(revision.id,revision.operation === 'unpublish' ? null : published?.published_at ?? null,post.id,post.id),
      ]);
      report.succeeded.push(post.id);
    } catch (error) {
      const message = (error as Error).message;
      await store.db.prepare("UPDATE revisions SET error=? WHERE id=? AND state='pending'").bind(message,revision.id).run();
      report.failed.push({ id: revision.post_id,error: message });
    }
  }
  for (const tag of plan.tags.filter(t => t.merged_into)) {
    const inUse = await remote.DB.prepare('SELECT 1 FROM live_post_tags WHERE tag_id=? LIMIT 1').bind(tag.id).first();
    if (inUse) continue;
    await remote.DB.prepare('DELETE FROM live_tags WHERE id=?').bind(tag.id).run();
    await store.db.prepare('UPDATE tags SET acknowledged_version=? WHERE id=? AND version=?').bind(tag.version,tag.id,tag.version).run();
  }
  return report;
}
