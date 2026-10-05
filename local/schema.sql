CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY, source_url TEXT NOT NULL, creator TEXT NOT NULL,
  caption TEXT, source_date TEXT, media_json TEXT NOT NULL,
  expected_count INTEGER NOT NULL, discovered_at TEXT NOT NULL,
  review_state TEXT NOT NULL DEFAULT 'queue', download_state TEXT NOT NULL DEFAULT 'pending',
  error TEXT, notes TEXT NOT NULL DEFAULT '', published_at TEXT,
  acknowledged_revision TEXT
);
CREATE TABLE IF NOT EXISTS assets (
  post_id TEXT NOT NULL REFERENCES posts(id), position INTEGER NOT NULL,
  key TEXT NOT NULL, preview_key TEXT NOT NULL, type TEXT NOT NULL,
  mime TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
  hash TEXT NOT NULL, bytes INTEGER NOT NULL,
  PRIMARY KEY(post_id, position)
);
CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE, color TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, acknowledged_version INTEGER NOT NULL DEFAULT 0,
  merged_into TEXT
);
CREATE TABLE IF NOT EXISTS post_tags (
  post_id TEXT NOT NULL REFERENCES posts(id), tag_id TEXT NOT NULL REFERENCES tags(id),
  PRIMARY KEY(post_id, tag_id)
);
CREATE TABLE IF NOT EXISTS revisions (
  id TEXT PRIMARY KEY, post_id TEXT NOT NULL REFERENCES posts(id), operation TEXT NOT NULL,
  snapshot TEXT NOT NULL, created_at TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending', error TEXT
);
CREATE INDEX IF NOT EXISTS pending_revisions ON revisions(state, created_at);
CREATE TABLE IF NOT EXISTS sync_runs (
  id TEXT PRIMARY KEY, started_at TEXT NOT NULL, finished_at TEXT,
  state TEXT NOT NULL, discovered INTEGER NOT NULL DEFAULT 0, error TEXT
);
