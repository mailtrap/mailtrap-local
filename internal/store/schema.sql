-- mailtrap-local schema. Single SQLite file. Single-tenant by design —
-- no account_id / org_id / sandbox_id scoping anywhere.

CREATE TABLE IF NOT EXISTS messages (
  id              TEXT    PRIMARY KEY,
  smtp_from       TEXT    NOT NULL DEFAULT '',
  smtp_to         TEXT    NOT NULL DEFAULT '[]',  -- JSON array of strings
  message_id      TEXT    NOT NULL DEFAULT '',
  from_name       TEXT    NOT NULL DEFAULT '',
  from_address    TEXT    NOT NULL DEFAULT '',
  to_addresses    TEXT    NOT NULL DEFAULT '[]',  -- JSON array of {Name,Address}
  cc_addresses    TEXT    NOT NULL DEFAULT '[]',
  bcc_addresses   TEXT    NOT NULL DEFAULT '[]',
  reply_to        TEXT    NOT NULL DEFAULT '[]',
  return_path     TEXT    NOT NULL DEFAULT '',
  subject         TEXT    NOT NULL DEFAULT '',
  date            TEXT,                           -- RFC3339Nano, nullable
  category        TEXT,                           -- nullable
  text_body       TEXT    NOT NULL DEFAULT '',
  html            TEXT    NOT NULL DEFAULT '',
  raw             BLOB    NOT NULL,
  size            INTEGER NOT NULL DEFAULT 0,
  snippet         TEXT    NOT NULL DEFAULT '',
  recipients_text TEXT    NOT NULL DEFAULT '',    -- denormalized for LIKE search
  list_unsubscribe TEXT,                          -- JSON, nullable
  read_at         TEXT,                           -- RFC3339Nano, NULL = unread
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_messages_created   ON messages (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_message_id ON messages (message_id);
CREATE INDEX IF NOT EXISTS idx_messages_read       ON messages (read_at);
CREATE INDEX IF NOT EXISTS idx_messages_category   ON messages (category);

CREATE TABLE IF NOT EXISTS attachments (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id       TEXT    NOT NULL,
  part_id          TEXT    NOT NULL DEFAULT '',
  filename         TEXT    NOT NULL DEFAULT '',
  content_type     TEXT    NOT NULL DEFAULT '',
  content_id       TEXT    NOT NULL DEFAULT '',
  disposition      TEXT    NOT NULL DEFAULT 'attachment',
  size             INTEGER NOT NULL DEFAULT 0,
  content          BLOB,
  checksum_md5     TEXT    NOT NULL DEFAULT '',
  checksum_sha1    TEXT    NOT NULL DEFAULT '',
  checksum_sha256  TEXT    NOT NULL DEFAULT '',
  created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments (message_id);

-- Singleton connection tables. The app writes at most one row per
-- table — effective config merges (config-file overlay, the single
-- DB row).

-- Singleton connection tables. `CHECK (id = 1)` makes the
-- "at most one row" invariant load-bearing in the database, not just
-- in the Go code. The matching upserts in internal/store/connections.go
-- always write id=1 explicitly. (Existing DBs migrated from an earlier
-- schema kept their original AUTOINCREMENT IDs and miss the CHECK
-- because `CREATE TABLE IF NOT EXISTS` is a no-op — fine, the code-
-- side invariant still holds.)
CREATE TABLE IF NOT EXISTS cloud_connections (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  api_token       TEXT    NOT NULL,
  sandbox_id      INTEGER NOT NULL,
  mirror_enabled  INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS relay_connections (
  id                  INTEGER PRIMARY KEY CHECK (id = 1),
  host                TEXT    NOT NULL,
  port                INTEGER NOT NULL DEFAULT 587,
  username            TEXT,
  password            TEXT,
  auth                TEXT    NOT NULL DEFAULT 'plain',  -- plain | login | none | cram_md5
  tls                 TEXT    NOT NULL DEFAULT 'auto',   -- auto | ssl | off | always | never
  auto_relay_enabled  INTEGER NOT NULL DEFAULT 0,
  override_from       TEXT,
  return_path         TEXT,
  created_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS webhook_connections (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  url          TEXT    NOT NULL,
  secret       TEXT,
  enabled      INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
