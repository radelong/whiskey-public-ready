-- Admin accounts (created on first run, unique per deployment) + app settings,
-- plus a few columns for bottles logged from an online lookup.

CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,              -- pbkdf2$<iters>$<saltB64>$<hashB64>
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

ALTER TABLE bottles ADD COLUMN photo_url  TEXT;
ALTER TABLE bottles ADD COLUMN barcode    TEXT;
ALTER TABLE bottles ADD COLUMN source_url TEXT;
