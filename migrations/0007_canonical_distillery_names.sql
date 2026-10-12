-- Keep the directory, filters, and historical bottle data on the same names.
UPDATE bottles SET distillery = 'Barrell' WHERE LOWER(TRIM(distillery)) = 'barrel';
UPDATE bottles SET distillery = 'Belle Meade' WHERE LOWER(TRIM(distillery)) = 'bellemeade';
