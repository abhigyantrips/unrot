import { randomUUID } from 'node:crypto';
import { COLORS, type Asset, type Discovery, type LocalPost, type Post, type Revision, type Tag, type TagColor } from '../src/lib/types';
export class Store {
  constructor(public db: D1Database) {}
  async discover(item: Discovery) {
    // Only refresh ephemeral source information. Curator-owned fields are never overwritten.
    await this.db.prepare(`INSERT INTO posts(id,source_url,creator,caption,source_date,media_json,expected_count,discovered_at) VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET media_json=excluded.media_json,expected_count=excluded.expected_count,
      creator=CASE WHEN excluded.creator != '' THEN excluded.creator ELSE posts.creator END,
      caption=COALESCE(excluded.caption,posts.caption),source_date=COALESCE(excluded.source_date,posts.source_date)`)
      .bind(item.id,item.source_url,item.creator,item.caption,item.source_date,JSON.stringify(item.media),item.expected_count,new Date().toISOString()).run();
  }
  async post(id: string): Promise<LocalPost | null> {
    const row = await this.db.prepare('SELECT * FROM posts WHERE id=?').bind(id).first<Omit<LocalPost, 'assets' | 'tags'>>();
    if (!row) return null;
    const [assets, tags] = await this.db.batch([
      this.db.prepare('SELECT * FROM assets WHERE post_id=? ORDER BY position').bind(id),
      this.db.prepare('SELECT t.id,t.name,t.color FROM tags t JOIN post_tags pt ON pt.tag_id=t.id WHERE pt.post_id=? AND t.merged_into IS NULL ORDER BY t.name').bind(id),
    ]);
    return { ...row, assets: assets.results as unknown as Asset[], tags: tags.results as unknown as Tag[] };
  }
  async list(view = 'queue') {
    const clause: Record<string, string> = { queue: "review_state='queue' AND published_at IS NULL AND download_state!='failed'", ready: "review_state='ready'", published: "published_at IS NOT NULL AND review_state!='ignored'", ignored: "review_state='ignored'", failed: "download_state='failed' AND review_state!='ignored'" };
    const where = clause[view] ?? clause.queue;
    const [rows,assets,tags] = await this.db.batch([
      this.db.prepare(`SELECT * FROM posts WHERE ${where} ORDER BY discovered_at,id`),
      this.db.prepare(`SELECT a.* FROM assets a JOIN posts p ON p.id=a.post_id WHERE ${where} ORDER BY a.position`),
      this.db.prepare(`SELECT pt.post_id,t.id,t.name,t.color FROM tags t JOIN post_tags pt ON pt.tag_id=t.id JOIN posts p ON p.id=pt.post_id WHERE (${where}) AND t.merged_into IS NULL ORDER BY t.name`),
    ]);
    return (rows.results as unknown as Omit<LocalPost,'assets' | 'tags'>[]).map(post => ({ ...post,
      assets: (assets.results as unknown as (Asset & { post_id: string })[]).filter(a => a.post_id === post.id),
      tags: (tags.results as unknown as (Tag & { post_id: string })[]).filter(t => t.post_id === post.id),
    }));
  }
  async tags() { return (await this.db.prepare('SELECT id,name,color FROM tags WHERE merged_into IS NULL ORDER BY name').all<Tag>()).results; }
  async setDownload(id: string, state: LocalPost['download_state'], error: string | null = null) {
    await this.db.prepare('UPDATE posts SET download_state=?,error=? WHERE id=?').bind(state, error, id).run();
  }
  async assets(id: string, assets: Asset[]) {
    await this.db.batch([
      this.db.prepare('DELETE FROM assets WHERE post_id=?').bind(id),
      ...assets.map(a => this.db.prepare('INSERT INTO assets(post_id,position,key,preview_key,type,mime,width,height,hash,bytes) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id,a.position,a.key,a.preview_key,a.type,a.mime,a.width,a.height,a.hash,a.bytes)),
      this.db.prepare("UPDATE posts SET download_state='complete',error=NULL WHERE id=?").bind(id),
    ]);
  }
  async save(id: string, notes: string, tagIds: string[]) {
    const post = await this.post(id);
    if (!post) throw new Error('Post not found.');
    if (post.download_state !== 'complete' || !post.assets.length || post.assets.length !== post.expected_count) throw new Error('Download all media before saving.');
    const unique = [...new Set(tagIds)];
    if (!unique.length) throw new Error('Choose at least one tag.');
    if (notes.length > 50000 || unique.length > 30) throw new Error('Notes or tag selection is too large.');
    const tags = await this.tags();
    if (unique.some(id => !tags.some(t => t.id === id))) throw new Error('A selected tag no longer exists.');
    const snapshot: Post = { id: post.id, source_url: post.source_url, creator: post.creator, caption: post.caption, source_date: post.source_date, notes, assets: post.assets, tags: tags.filter(t => unique.includes(t.id)), published_at: post.published_at };
    const revision = this.revision(id, 'publish', snapshot);
    await this.db.batch([
      this.db.prepare("UPDATE posts SET notes=?,review_state='ready' WHERE id=?").bind(notes,id),
      this.db.prepare('DELETE FROM post_tags WHERE post_id=?').bind(id),
      ...unique.map(t => this.db.prepare('INSERT INTO post_tags(post_id,tag_id) VALUES(?,?)').bind(id,t)),
      ...revision,
    ]);
  }
  private revision(id: string, operation: Revision['operation'], snapshot: Post) {
    return [
      this.db.prepare("UPDATE revisions SET state='superseded' WHERE post_id=? AND state='pending'").bind(id),
      this.db.prepare('INSERT INTO revisions(id,post_id,operation,snapshot,created_at) VALUES(?,?,?,?,?)').bind(randomUUID(),id,operation,JSON.stringify(snapshot),new Date().toISOString()),
    ];
  }
  async review(id: string, action: 'ignore' | 'restore' | 'unpublish') {
    const post = await this.post(id);
    if (!post) throw new Error('Post not found.');
    if (action === 'unpublish') {
      if (!post.published_at) throw new Error('Post is not published.');
      await this.db.batch([...this.revision(id, 'unpublish', post),this.db.prepare("UPDATE posts SET review_state='ready' WHERE id=?").bind(id)]);
    } else {
      await this.db.batch([
        this.db.prepare('UPDATE posts SET review_state=? WHERE id=?').bind(action === 'ignore' ? 'ignored' : 'queue', id),
        this.db.prepare("UPDATE revisions SET state='superseded' WHERE post_id=? AND state='pending'").bind(id),
      ]);
    }
  }
  async tag(name: string, color: TagColor, id?: string) {
    name = name.trim();
    if (!name || name.length > 60 || !COLORS.includes(color)) throw new Error('Use a name of 1–60 characters and a palette color.');
    if (id) {
      const tag = await this.db.prepare('SELECT id FROM tags WHERE id=? AND merged_into IS NULL').bind(id).first();
      if (!tag) throw new Error('Tag not found.');
      await this.db.prepare('UPDATE tags SET name=?,color=?,version=version+1 WHERE id=?').bind(name,color,id).run();
      await this.refreshAffected(id);
      return id;
    }
    id = randomUUID();
    await this.db.prepare('INSERT INTO tags(id,name,color) VALUES(?,?,?)').bind(id,name,color).run();
    return id;
  }
  async merge(from: string, into: string) {
    const tags = await this.tags();
    if (from === into || !tags.some(t => t.id === from) || !tags.some(t => t.id === into)) throw new Error('Choose two different existing tags.');
    const { results: affected } = await this.db.prepare('SELECT post_id FROM post_tags WHERE tag_id=?').bind(from).all<{ post_id: string }>();
    await this.db.batch([
      this.db.prepare('INSERT OR IGNORE INTO post_tags(post_id,tag_id) SELECT post_id,? FROM post_tags WHERE tag_id=?').bind(into,from),
      this.db.prepare('DELETE FROM post_tags WHERE tag_id=?').bind(from),
      this.db.prepare('UPDATE tags SET merged_into=?,version=version+1 WHERE id=?').bind(into,from),
    ]);
    for (const { post_id } of affected) await this.stageAffected(post_id);
  }
  private async refreshAffected(tag: string) {
    const { results } = await this.db.prepare('SELECT post_id FROM post_tags WHERE tag_id=?').bind(tag).all<{ post_id: string }>();
    for (const { post_id } of results) await this.stageAffected(post_id);
  }
  private async stageAffected(id: string) {
    const pending = await this.db.prepare("SELECT operation FROM revisions WHERE post_id=? AND state='pending'").bind(id).first<{ operation: string }>();
    const post = await this.post(id);
    if (post && (post.review_state === 'ready' || post.published_at) && pending?.operation !== 'unpublish') {
      if (post.review_state === 'ignored') await this.db.batch(this.revision(id,'publish',post));
      else await this.save(id,post.notes,post.tags.map(t => t.id));
    }
  }
  async pending(): Promise<Revision[]> { return (await this.db.prepare("SELECT * FROM revisions WHERE state='pending' ORDER BY created_at,id").all<Revision>()).results; }
  async recover() {
    await this.db.batch([
      this.db.prepare("UPDATE posts SET download_state='pending' WHERE download_state='downloading'"),
      this.db.prepare("UPDATE sync_runs SET state='interrupted',finished_at=?,error='Process ended before synchronization completed.' WHERE state='running'").bind(new Date().toISOString()),
    ]);
  }
}
