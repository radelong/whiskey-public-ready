-- The tasting catalog now uses the shorter, preferred distillery name.
UPDATE bottles
SET distillery = 'Holladay'
WHERE LOWER(TRIM(distillery)) IN ('holladay', 'ben holiday', 'ben holladay');
