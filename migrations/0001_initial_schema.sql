
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL DEFAULT 'editor',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);

CREATE TABLE user_meta (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  meta_key TEXT NOT NULL,
  meta_value TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, meta_key)
);

CREATE INDEX idx_user_meta_user_id ON user_meta(user_id);
CREATE INDEX idx_user_meta_key ON user_meta(meta_key);

-- LP "box" row. Holds URL/slug, display settings, scheduling, and
-- pointers into page_versions / publications. The LP body JSON
-- (sections, CTAs, etc.) lives in page_versions.content; this row
-- intentionally does not duplicate it.
CREATE TABLE pages (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'default',
  slug TEXT NOT NULL,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'draft',

  -- Pointers into page_versions / publications. NULL until the
  -- pageQueries.create helper wires the first draft / first publish.
  current_draft_version_id TEXT,
  published_version_id TEXT,
  latest_publication_id TEXT,

  max_width INTEGER NOT NULL DEFAULT 750,
  background_color TEXT,
  frame_style TEXT,
  meta TEXT DEFAULT '{}',
  custom_domain TEXT,
  password_hash TEXT,
  publish_at TEXT,
  unpublish_at TEXT,

  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  published_at TEXT,
  trashed_at TEXT,
  preview_token TEXT
);

CREATE UNIQUE INDEX idx_pages_slug_unique ON pages(slug);
CREATE INDEX idx_pages_workspace_id ON pages(workspace_id);
CREATE INDEX idx_pages_status ON pages(status);
CREATE INDEX idx_pages_current_draft_version_id ON pages(current_draft_version_id);
CREATE INDEX idx_pages_published_version_id ON pages(published_version_id);
CREATE INDEX idx_pages_latest_publication_id ON pages(latest_publication_id);
CREATE INDEX idx_pages_preview_token ON pages(preview_token);
CREATE INDEX idx_pages_trashed_at ON pages(trashed_at);

-- Snapshot of LP body JSON. One row per draft / published snapshot.
-- pages.current_draft_version_id points at the live editable draft;
-- pages.published_version_id points at the snapshot the public URL
-- currently serves (NULL when never published).
CREATE TABLE page_versions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'default',
  page_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  source TEXT NOT NULL DEFAULT 'manual',
  base_version_id TEXT,
  base_publication_id TEXT,
  label TEXT,
  content TEXT NOT NULL DEFAULT '{}',
  content_hash TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE,
  FOREIGN KEY (base_version_id) REFERENCES page_versions(id) ON DELETE SET NULL,
  FOREIGN KEY (base_publication_id) REFERENCES publications(id) ON DELETE SET NULL,
  UNIQUE(page_id, version_number)
);

CREATE INDEX idx_page_versions_workspace_id ON page_versions(workspace_id);
CREATE INDEX idx_page_versions_page_id ON page_versions(page_id);
CREATE INDEX idx_page_versions_status ON page_versions(status);
CREATE INDEX idx_page_versions_source ON page_versions(source);
CREATE INDEX idx_page_versions_base_version_id ON page_versions(base_version_id);
CREATE INDEX idx_page_versions_base_publication_id ON page_versions(base_publication_id);

-- Publication history. Every publish / republish appends a row; the
-- current active row (status='active') is the one pages.latest_publication_id
-- points at. Unpublishing flips the active row to status='ended'.
CREATE TABLE publications (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'default',
  page_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  published_at TEXT NOT NULL DEFAULT (datetime('now')),
  unpublished_at TEXT,
  created_by TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  label TEXT,
  meta TEXT DEFAULT '{}',
  FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE,
  -- NO ACTION (vs RESTRICT) lets the DELETE FROM pages cascade resolve
  -- correctly: publications.page_id cascade-deletes the publications
  -- row before SQLite checks this FK at statement end. Direct deletes
  -- of a page_versions row still error out if any publication still
  -- references it, so the orphan-protection intent is preserved.
  FOREIGN KEY (version_id) REFERENCES page_versions(id) ON DELETE NO ACTION
);

CREATE INDEX idx_publications_workspace_id ON publications(workspace_id);
CREATE INDEX idx_publications_page_id ON publications(page_id);
CREATE INDEX idx_publications_version_id ON publications(version_id);
CREATE INDEX idx_publications_status ON publications(status);
CREATE INDEX idx_publications_published_at ON publications(published_at);

-- Only one publication may be active per page at a time. Helpers must
-- end the previous active row (status='ended') before inserting a new
-- active row; this index makes the constraint enforceable at the DB
-- layer too.
CREATE UNIQUE INDEX idx_publications_one_active_per_page
  ON publications(page_id)
  WHERE status = 'active';

CREATE TABLE page_meta (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL DEFAULT 'default',
  page_id TEXT NOT NULL,
  meta_key TEXT NOT NULL,
  meta_value TEXT,
  FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE,
  UNIQUE(page_id, meta_key)
);

CREATE INDEX idx_page_meta_workspace_id ON page_meta(workspace_id);
CREATE INDEX idx_page_meta_page_id ON page_meta(page_id);
CREATE INDEX idx_page_meta_key ON page_meta(meta_key);

CREATE TABLE my_links (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'default',
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  meta TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_my_links_workspace_id ON my_links(workspace_id);
CREATE INDEX idx_my_links_label ON my_links(label);

-- Connection settings for external integrations. The first (and
-- currently only) tenant of this table is the Hub Connector contract:
-- one row per workspace where `type = 'hub_connector'`, carrying the
-- script URL, the hub base URL, the workspace-level on/off, and a
-- per-row status. `meta.script_enabled` gates the public <script> tag
-- specifically (orthogonal to `enabled`). `server_token_encrypted` is
-- a write-only column reserved for the connector-auth contract; DB
-- helpers never return it.
CREATE TABLE connections (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'default',
  type TEXT NOT NULL,
  connection_id TEXT,
  hub_base_url TEXT,
  script_url TEXT,
  server_token_encrypted TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  enabled INTEGER NOT NULL DEFAULT 0,
  connected_at TEXT,
  last_verified_at TEXT,
  meta TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_connections_workspace_id ON connections(workspace_id);
CREATE INDEX idx_connections_type ON connections(type);

-- Only one Hub Connector row per workspace. Partial unique index so
-- future connection types (which may legitimately want multiple rows
-- per workspace) aren't constrained by this rule.
CREATE UNIQUE INDEX idx_connections_hub_connector_per_workspace
  ON connections(workspace_id)
  WHERE type = 'hub_connector';

CREATE TABLE tracking_tags (
  workspace_id TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
  gtm_id TEXT,
  ga4_id TEXT,
  clarity_id TEXT,
  meta_pixel_id TEXT,
  line_tag_id TEXT,
  tiktok_pixel_id TEXT,
  x_pixel_id TEXT,
  hotjar_id TEXT,
  meta TEXT DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE site_meta (
  workspace_id TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
  site_title TEXT,
  site_description TEXT,
  favicon_url TEXT,
  ogp_default_image_url TEXT,
  ogp_default_title TEXT,
  ogp_default_description TEXT,
  domain TEXT,
  workers_dev_disabled INTEGER NOT NULL DEFAULT 0,
  meta TEXT DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE utm_links (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'default',
  page_id TEXT,
  label TEXT NOT NULL,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  utm_term TEXT,
  short_path TEXT UNIQUE,
  meta TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE
);

CREATE INDEX idx_utm_links_workspace_id ON utm_links(workspace_id);
CREATE INDEX idx_utm_links_page_id ON utm_links(page_id);
CREATE INDEX idx_utm_links_short_path ON utm_links(short_path);

CREATE TABLE site_settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  maintenance_mode INTEGER NOT NULL DEFAULT 0,
  custom_domain TEXT,
  meta TEXT DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (id = 1)
);

CREATE TABLE admin_users (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'default',
  email TEXT NOT NULL,
  google_sub TEXT,
  role TEXT NOT NULL DEFAULT 'owner',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT,
  UNIQUE(workspace_id, email)
);

CREATE INDEX idx_admin_users_workspace ON admin_users(workspace_id);
CREATE INDEX idx_admin_users_workspace_email ON admin_users(workspace_id, email);
CREATE INDEX idx_admin_users_workspace_sub ON admin_users(workspace_id, google_sub);

CREATE TABLE admin_sessions (
  -- Opaque cookie value; compared directly against the inbound Cookie.
  token TEXT PRIMARY KEY,
  admin_user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL DEFAULT 'default',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (admin_user_id) REFERENCES admin_users(id) ON DELETE CASCADE
);

CREATE INDEX idx_admin_sessions_workspace ON admin_sessions(workspace_id);
CREATE INDEX idx_admin_sessions_user ON admin_sessions(admin_user_id);
CREATE INDEX idx_admin_sessions_expires ON admin_sessions(expires_at);

-- Per-workspace mapping to the customer's GitHub App installation.
-- The install id is captured during the /admin/update flow and reused
-- to mint fresh installation access tokens without bouncing the
-- customer through GitHub again.
CREATE TABLE workspace_github_installations (
  workspace_id TEXT PRIMARY KEY,
  installation_id INTEGER NOT NULL,
  installed_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO schema_migrations (version) VALUES ('0001_initial_schema');

-- DOWN: provided for consistency with later migrations. In practice
-- 0001 only runs against an empty database on the first request of a
-- fresh deploy; the self-update flow never re-runs it because it's
-- always already in schema_migrations by the time an update is
-- triggered. If 0001 ever does fail, the safest move is to nuke the
-- whole schema so the next request starts over from scratch.
DROP TABLE IF EXISTS schema_migrations;
DROP TABLE IF EXISTS workspace_github_installations;
DROP INDEX IF EXISTS idx_admin_sessions_expires;
DROP INDEX IF EXISTS idx_admin_sessions_user;
DROP INDEX IF EXISTS idx_admin_sessions_workspace;
DROP TABLE IF EXISTS admin_sessions;
DROP INDEX IF EXISTS idx_admin_users_workspace_sub;
DROP INDEX IF EXISTS idx_admin_users_workspace_email;
DROP INDEX IF EXISTS idx_admin_users_workspace;
DROP TABLE IF EXISTS admin_users;
DROP TABLE IF EXISTS site_settings;
DROP INDEX IF EXISTS idx_utm_links_short_path;
DROP INDEX IF EXISTS idx_utm_links_page_id;
DROP INDEX IF EXISTS idx_utm_links_workspace_id;
DROP TABLE IF EXISTS utm_links;
DROP TABLE IF EXISTS site_meta;
DROP TABLE IF EXISTS tracking_tags;
DROP INDEX IF EXISTS idx_connections_hub_connector_per_workspace;
DROP INDEX IF EXISTS idx_connections_type;
DROP INDEX IF EXISTS idx_connections_workspace_id;
DROP TABLE IF EXISTS connections;
DROP INDEX IF EXISTS idx_my_links_label;
DROP INDEX IF EXISTS idx_my_links_workspace_id;
DROP TABLE IF EXISTS my_links;
DROP INDEX IF EXISTS idx_page_meta_key;
DROP INDEX IF EXISTS idx_page_meta_page_id;
DROP INDEX IF EXISTS idx_page_meta_workspace_id;
DROP TABLE IF EXISTS page_meta;
DROP INDEX IF EXISTS idx_publications_one_active_per_page;
DROP INDEX IF EXISTS idx_publications_published_at;
DROP INDEX IF EXISTS idx_publications_status;
DROP INDEX IF EXISTS idx_publications_version_id;
DROP INDEX IF EXISTS idx_publications_page_id;
DROP INDEX IF EXISTS idx_publications_workspace_id;
DROP TABLE IF EXISTS publications;
DROP INDEX IF EXISTS idx_page_versions_base_publication_id;
DROP INDEX IF EXISTS idx_page_versions_base_version_id;
DROP INDEX IF EXISTS idx_page_versions_source;
DROP INDEX IF EXISTS idx_page_versions_status;
DROP INDEX IF EXISTS idx_page_versions_page_id;
DROP INDEX IF EXISTS idx_page_versions_workspace_id;
DROP TABLE IF EXISTS page_versions;
DROP INDEX IF EXISTS idx_pages_trashed_at;
DROP INDEX IF EXISTS idx_pages_preview_token;
DROP INDEX IF EXISTS idx_pages_latest_publication_id;
DROP INDEX IF EXISTS idx_pages_published_version_id;
DROP INDEX IF EXISTS idx_pages_current_draft_version_id;
DROP INDEX IF EXISTS idx_pages_status;
DROP INDEX IF EXISTS idx_pages_workspace_id;
DROP INDEX IF EXISTS idx_pages_slug_unique;
DROP TABLE IF EXISTS pages;
DROP INDEX IF EXISTS idx_user_meta_key;
DROP INDEX IF EXISTS idx_user_meta_user_id;
DROP TABLE IF EXISTS user_meta;
DROP INDEX IF EXISTS idx_users_role;
DROP INDEX IF EXISTS idx_users_email;
DROP TABLE IF EXISTS users;
