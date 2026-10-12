-- Incrementing this version revokes existing taster sessions after a reset.
ALTER TABLE tasters ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0;
