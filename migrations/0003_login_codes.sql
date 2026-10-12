-- One-time email login codes for the admin entry point.

CREATE TABLE login_codes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  code_hash  TEXT NOT NULL,
  expires_at TEXT NOT NULL,            -- ISO datetime
  attempts   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
