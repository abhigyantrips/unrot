import type { Asset, Post, Tag } from './types';
type Row = Omit<Post, 'assets' | 'tags'>;
export class QueryError extends Error {}
export function filters(params: URLSearchParams) {
  const tags = [...new Set(params.getAll('tag'))];
  if (tags.length > 30 || tags.some(t => !/^[a-zA-Z0-9_-]{1,80}$/.test(t))) throw new QueryError('Invalid tags.');
  const mode = params.get('match') ?? 'any';
  if (!['any', 'all'].includes(mode)) throw new QueryError('Matching must be any or all.');
  return { tags, mode };
}
export function encodeCursor(post: Pick<Post, 'published_at' | 'id'>) {
  return btoa(JSON.stringify([post.published_at, post.id]));
}
export function decodeCursor(value: string): [string, string] {
  try {
    const decoded: unknown = JSON.parse(atob(value));
    if (!Array.isArray(decoded) || decoded.length !== 2 || !decoded.every(v => typeof v === 'string') ||
      !/^\d{4}-\d{2}-\d{2}T/.test(decoded[0]) || !/^[a-zA-Z0-9_-]{1,80}$/.test(decoded[1])) throw new Error();
    return decoded as [string, string];
  } catch { throw new QueryError('Invalid cursor.'); }
}
async function hydrate(db: D1Database, rows: Row[]): Promise<Post[]> {
  if (!rows.length) return [];
  const marks = rows.map(() => '?').join(',');
  const ids = rows.map(p => p.id);
  const [assets, tags] = await db.batch([
    db.prepare(`SELECT * FROM live_assets WHERE post_id IN (${marks}) ORDER BY position`).bind(...ids),
    db.prepare(`SELECT pt.post_id, t.* FROM live_post_tags pt JOIN live_tags t ON t.id=pt.tag_id WHERE pt.post_id IN (${marks}) ORDER BY t.name`).bind(...ids),
  ]);
  return rows.map(row => ({ ...row,
    assets: (assets.results as unknown as (Asset & { post_id: string })[]).filter(a => a.post_id === row.id),
    tags: (tags.results as unknown as (Tag & { post_id: string })[]).filter(t => t.post_id === row.id),
  }));
}
const fields = 'p.id,p.source_url,p.creator,p.caption,p.source_date,p.notes,p.published_at';
export async function listPosts(db: D1Database, params: URLSearchParams) {
  const { tags, mode } = filters(params);
  const where = ['p.visible=1'];
  const args: (string | number)[] = [];
  if (tags.length) {
    where.push(`(SELECT COUNT(DISTINCT pt.tag_id) FROM live_post_tags pt WHERE pt.post_id=p.id AND pt.tag_id IN (${tags.map(() => '?').join(',')})) ${mode === 'all' ? '= ?' : '> 0'}`);
    args.push(...tags);
    if (mode === 'all') args.push(tags.length);
  }
  const cursor = params.get('cursor');
  if (cursor) {
    const [date, id] = decodeCursor(cursor);
    where.push('(p.published_at < ? OR (p.published_at = ? AND p.id < ?))');
    args.push(date, date, id);
  }
  const { results } = await db.prepare(`SELECT ${fields} FROM live_posts p WHERE ${where.join(' AND ')} ORDER BY p.published_at DESC,p.id DESC LIMIT 25`).bind(...args).all<Row>();
  const more = results.length > 24;
  const posts = await hydrate(db, results.slice(0, 24));
  return { posts, cursor: more ? encodeCursor(posts[posts.length - 1]!) : null };
}
export async function getPost(db: D1Database, id: string) {
  const row = await db.prepare(`SELECT ${fields} FROM live_posts p WHERE p.id=? AND p.visible=1`).bind(id).first<Row>();
  return row ? (await hydrate(db, [row]))[0]! : null;
}
export async function listTags(db: D1Database): Promise<Tag[]> {
  const { results } = await db.prepare('SELECT DISTINCT t.* FROM live_tags t JOIN live_post_tags pt ON pt.tag_id=t.id JOIN live_posts p ON p.id=pt.post_id WHERE p.visible=1 ORDER BY t.name').all<Tag>();
  return results;
}
