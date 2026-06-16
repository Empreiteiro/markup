// SQLite schema, inlined as a string so it ships with the bundle and does not
// depend on reading a .sql file at runtime. Executed (idempotently) on first
// connection in src/db/index.ts.

export const SCHEMA = /* sql */ `
CREATE TABLE IF NOT EXISTS projects (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  repo_path          TEXT,
  base_url           TEXT NOT NULL,
  viewport_w         INTEGER NOT NULL DEFAULT 1440,
  viewport_h         INTEGER NOT NULL DEFAULT 900,
  auth_storage_state TEXT,
  created_at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS screens (
  id               TEXT PRIMARY KEY,
  project_id       TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind             TEXT NOT NULL DEFAULT 'page',        -- 'page' | 'modal'
  name             TEXT NOT NULL,
  route            TEXT,
  source_file      TEXT,
  source_line      INTEGER,
  parent_screen_id TEXT REFERENCES screens(id) ON DELETE CASCADE,
  screenshot_path  TEXT,
  width            INTEGER,
  height           INTEGER,
  pos_x            REAL,
  pos_y            REAL,
  ord              INTEGER NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'discovered',  -- 'discovered' | 'captured' | 'error'
  error            TEXT,
  created_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS elements (
  id              TEXT PRIMARY KEY,
  screen_id       TEXT NOT NULL REFERENCES screens(id) ON DELETE CASCADE,
  selector        TEXT NOT NULL,
  role            TEXT,
  accessible_name TEXT,
  text            TEXT,
  tag             TEXT,
  bbox_x          REAL NOT NULL DEFAULT 0,
  bbox_y          REAL NOT NULL DEFAULT 0,
  bbox_w          REAL NOT NULL DEFAULT 0,
  bbox_h          REAL NOT NULL DEFAULT 0,
  source_file     TEXT,
  source_line     INTEGER
);

CREATE TABLE IF NOT EXISTS nav_edges (
  id             TEXT PRIMARY KEY,
  project_id     TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  from_screen_id TEXT NOT NULL REFERENCES screens(id) ON DELETE CASCADE,
  to_screen_id   TEXT NOT NULL REFERENCES screens(id) ON DELETE CASCADE,
  trigger        TEXT,
  kind           TEXT NOT NULL DEFAULT 'navigate'       -- 'navigate' | 'open-modal'
);

CREATE TABLE IF NOT EXISTS annotations (
  id          TEXT PRIMARY KEY,
  screen_id   TEXT NOT NULL REFERENCES screens(id) ON DELETE CASCADE,
  shape       TEXT NOT NULL DEFAULT 'pin',              -- 'pin' | 'box' | 'arrow'
  x           REAL NOT NULL,
  y           REAL NOT NULL,
  w           REAL,
  h           REAL,
  element_id  TEXT REFERENCES elements(id) ON DELETE SET NULL,
  note        TEXT NOT NULL DEFAULT '',
  type        TEXT NOT NULL DEFAULT 'change',           -- 'bug' | 'change' | 'question' | 'idea'
  severity    TEXT NOT NULL DEFAULT 'med',              -- 'low' | 'med' | 'high'
  suggestion  TEXT,
  status      TEXT NOT NULL DEFAULT 'open',             -- 'open' | 'resolved'
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_screens_project    ON screens(project_id);
CREATE INDEX IF NOT EXISTS idx_screens_parent     ON screens(parent_screen_id);
CREATE INDEX IF NOT EXISTS idx_elements_screen    ON elements(screen_id);
CREATE INDEX IF NOT EXISTS idx_edges_project      ON nav_edges(project_id);
CREATE INDEX IF NOT EXISTS idx_annotations_screen ON annotations(screen_id);
`;
