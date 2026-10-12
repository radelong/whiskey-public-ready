-- Link pour requests to authenticated tasters and make approval safe to retry.
--
-- Existing requests remain valid historical records but have no taster_id, so
-- they cannot authorize new guest-authored tasting notes. Existing tasting
-- notes keep their nullable request_id and remain readable/editable as legacy
-- notes; no approval is fabricated for them.

ALTER TABLE requests ADD COLUMN taster_id INTEGER REFERENCES tasters(id) ON DELETE SET NULL;
ALTER TABLE requests ADD COLUMN pour_ml INTEGER;
ALTER TABLE requests ADD COLUMN approved_at TEXT;
ALTER TABLE requests ADD COLUMN inventory_deducted_at TEXT;
ALTER TABLE requests ADD COLUMN cancelled_at TEXT;

CREATE INDEX idx_requests_taster ON requests(taster_id, bottle_id, created_at);

-- A guest can have one editable tasting entry for each approved pour. Admin
-- entries have a NULL taster_id and are intentionally outside this constraint.
CREATE UNIQUE INDEX idx_tastings_one_guest_note_per_pour
  ON tastings(request_id)
  WHERE request_id IS NOT NULL AND taster_id IS NOT NULL;
