-- Taster ratings originally used a ten-point scale. Preserve the meaning of
-- existing notes while moving the tasting experience to a five-star scale.
UPDATE tastings
SET rating = ROUND(rating / 2.0, 1)
WHERE rating IS NOT NULL;
