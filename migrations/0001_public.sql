CREATE TABLE IF NOT EXISTS live_posts (
  id TEXT PRIMARY KEY, source_url TEXT NOT NULL, creator TEXT NOT NULL,
  caption TEXT, source_date TEXT, notes TEXT NOT NULL DEFAULT '',
  published_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  revision_id TEXT NOT NULL, visible INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS live_order ON live_posts(visible, published_at DESC, id DESC);
CREATE TABLE IF NOT EXISTS live_assets (
  post_id TEXT NOT NULL REFERENCES live_posts(id), position INTEGER NOT NULL,
  key TEXT NOT NULL, preview_key TEXT NOT NULL, type TEXT NOT NULL,
  mime TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
  hash TEXT NOT NULL, bytes INTEGER NOT NULL,
  PRIMARY KEY(post_id, position)
);
CREATE TABLE IF NOT EXISTS live_tags (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS live_post_tags (
  post_id TEXT NOT NULL REFERENCES live_posts(id), tag_id TEXT NOT NULL REFERENCES live_tags(id),
  PRIMARY KEY(post_id, tag_id)
);
CREATE INDEX IF NOT EXISTS live_tag_posts ON live_post_tags(tag_id, post_id);
