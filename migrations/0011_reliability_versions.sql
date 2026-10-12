-- Monotonic version numbers let edits detect stale inventory and revoke admin
-- cookies after a password change. Defaults preserve all existing rows.
ALTER TABLE bottles ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bottles ADD COLUMN archived_at TEXT;
