# Filling in `import-template.csv`

Open `import-template.csv` in Excel, Numbers, or Google Sheets. Delete the
example rows, add your bottles, then **File → Save As / Export → CSV**.
Load it at **the /import page of your own deployment** (upload or paste).

## Columns

| Column | Required | Format / allowed values |
| --- | --- | --- |
| `name` | **yes** | anything, e.g. `Eagle Rare 10 Year` |
| `distillery` | no | e.g. `Buffalo Trace` |
| `category` | no | `Bourbon` · `Rye` · `Single Malt Scotch` · `Blended Scotch` · `Irish` · `Japanese` · `Canadian` · `Tennessee` · `World / Other` |
| `age_years` | no | number, 0–100 (blank for no age statement) |
| `abv` | no | number 0–100, **no `%`** (e.g. `46.5`) |
| `size_ml` | no | number (defaults to `750`) |
| `purchase_date` | no | `YYYY-MM-DD` (e.g. `2000-01-01`) |
| `purchase_price` | no | number, **no `$`** (e.g. `89.99`) |
| `status` | no | `sealed` (default) · `open` · `finished` |
| `remaining_pct` | no | how full the bottle is, `0`–`100` (eyeball it — `65` = about two-thirds). Blank on an `open` bottle = assumed full. `remaining_ml` also works if you prefer exact volume. |
| `location` | no | e.g. `Shelf 2`, `Bar cart` |
| `notes` | no | free text; if it contains a comma, your spreadsheet app will quote it automatically |

## Rules

- Only `name` matters — leave any other cell blank to skip it.
- A row with no `name` is skipped (you'll see it in the result report).
- Bad numbers / unknown `status` values are ignored for that cell, the rest of
  the row still imports.
- Set `remaining_pct` on a bottle and it's treated as `open` automatically
  (`0` -> `finished`).
- You can re-run the import as many times as you want (it adds rows; it doesn't
  de-duplicate — so don't import the same file twice).
- Up to 1000 rows per import.
