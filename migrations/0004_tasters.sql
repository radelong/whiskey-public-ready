-- Taster accounts: guests who sign up on the tasting site to keep their own
-- tasting notes and ratings. Separate from the single admin `users` row.

CREATE TABLE tasters (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  display_name  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A tasting can now belong to a taster (self-logged) as well as, or instead of,
-- a free-text taster_name (operator-logged at the bar).
ALTER TABLE tastings ADD COLUMN taster_id INTEGER REFERENCES tasters(id) ON DELETE SET NULL;

CREATE INDEX idx_tastings_taster ON tastings(taster_id);
