-- Whiskey Cellar — initial schema

CREATE TABLE bottles (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  distillery     TEXT,
  category       TEXT,                       -- Bourbon, Rye, Single Malt Scotch, Irish, Japanese, ...
  age_years      REAL,
  abv            REAL,                       -- alcohol by volume, e.g. 46.3  (proof = abv * 2)
  size_ml        INTEGER NOT NULL DEFAULT 750,
  purchase_date  TEXT,                       -- ISO date, e.g. 2026-08-29
  purchase_price REAL,
  status         TEXT NOT NULL DEFAULT 'sealed'  -- sealed | open | finished
                 CHECK (status IN ('sealed', 'open', 'finished')),
  remaining_ml   INTEGER,                    -- NULL while sealed; set to size_ml when opened
  location       TEXT,                       -- shelf / box / bar
  photo_key      TEXT,                       -- R2 object key (added later)
  notes          TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE requests (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  bottle_id      INTEGER REFERENCES bottles(id) ON DELETE SET NULL,
  bottle_text    TEXT,                       -- free text when the bottle isn't in inventory
  requester_name TEXT NOT NULL,
  note           TEXT,
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'poured', 'declined')),
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at    TEXT
);

CREATE TABLE tastings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  bottle_id    INTEGER NOT NULL REFERENCES bottles(id) ON DELETE CASCADE,
  request_id   INTEGER REFERENCES requests(id) ON DELETE SET NULL,
  taster_name  TEXT,
  pour_ml      INTEGER NOT NULL DEFAULT 15,
  rating       REAL,                         -- 0..10, one decimal
  nose         TEXT,
  palate       TEXT,
  finish       TEXT,
  notes        TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_bottles_status  ON bottles(status);
CREATE INDEX idx_requests_status ON requests(status);
CREATE INDEX idx_tastings_bottle ON tastings(bottle_id);
