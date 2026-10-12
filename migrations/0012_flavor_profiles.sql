-- Bottle-owned flavor profiles persist across tasting sessions and are not
-- inferred from or coupled to the manually maintained proof/ABV field.
ALTER TABLE bottles ADD COLUMN flavor_profile TEXT;
ALTER TABLE bottles ADD COLUMN flavor_source TEXT;
ALTER TABLE bottles ADD COLUMN flavor_source_url TEXT;
ALTER TABLE bottles ADD COLUMN flavor_updated_at TEXT;
