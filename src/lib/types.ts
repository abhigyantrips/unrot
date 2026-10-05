export const COLORS = ['amber', 'orange', 'rose', 'lime', 'emerald', 'teal', 'sky', 'violet', 'stone'] as const;
export type TagColor = typeof COLORS[number];
export interface Tag { id: string; name: string; color: TagColor }
export interface Asset {
  position: number; key: string; preview_key: string; type: 'image' | 'video';
  mime: string; width: number; height: number; hash: string; bytes: number;
}
export interface Post {
  id: string; source_url: string; creator: string; caption: string | null;
  source_date: string | null; notes: string; published_at: string | null;
  assets: Asset[]; tags: Tag[];
}
export interface SourceMedia { url: string; type: 'image' | 'video'; width: number; height: number }
export interface Discovery {
  id: string; source_url: string; creator: string; caption: string | null;
  source_date: string | null; media: SourceMedia[]; expected_count: number;
}
export interface LocalPost extends Post {
  review_state: 'queue' | 'ready' | 'ignored';
  download_state: 'pending' | 'downloading' | 'complete' | 'failed';
  error: string | null; expected_count: number; media_json: string;
}
export interface Revision { id: string; post_id: string; operation: 'publish' | 'unpublish'; snapshot: string; created_at: string }
export interface Bindings { DB: D1Database; MEDIA: R2Bucket }
export const mediaUrl = (key: string) => `/media/${key.split('/').map(encodeURIComponent).join('/')}`;
export const tagClass: Record<TagColor, string> = {
  amber: 'bg-amber-100 text-amber-900', orange: 'bg-orange-100 text-orange-900',
  rose: 'bg-rose-100 text-rose-900', lime: 'bg-lime-100 text-lime-900',
  emerald: 'bg-emerald-100 text-emerald-900', teal: 'bg-teal-100 text-teal-900',
  sky: 'bg-sky-100 text-sky-900', violet: 'bg-violet-100 text-violet-900', stone: 'bg-stone-200 text-stone-800',
};
