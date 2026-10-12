-- Keep subsequent name corrections separate from the already-applied migration.
UPDATE bottles SET distillery = 'Ben Holladay' WHERE LOWER(TRIM(distillery)) IN ('holladay', 'ben holiday', 'ben holladay');
UPDATE bottles SET distillery = 'Roche taune' WHERE LOWER(TRIM(distillery)) IN ('rochetaune', 'roche taune');
UPDATE bottles SET distillery = 'Sazerac' WHERE LOWER(TRIM(distillery)) IN ('sazarac', 'sazerac');
UPDATE bottles SET distillery = 'Still Austin' WHERE LOWER(TRIM(distillery)) IN ('sill austin', 'still austin');
