import type { Bottle, ImportReview, ImportReviewRow } from "../shared/types";
import { canonicalDistillery } from "../shared/distilleries";

const TEXT_FIELDS = ["name", "distillery", "category", "location", "notes", "photo_url", "barcode", "source_url"] as const;
const VALID_STATUS = new Set(["sealed", "open", "finished"]);

function textValue(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function numberValue(value: unknown, decorations = /[,\s]/g): number | null {
  const raw = textValue(value).replace(decorations, "");
  if (!raw) return null;
  const number = Number(raw);
  return Number.isFinite(number) ? number : NaN;
}

function duplicateKey(name: unknown, distillery: unknown): string {
  return textValue(name).toLocaleLowerCase() + "|" + textValue(distillery).toLocaleLowerCase();
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00Z");
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function reviewBottleImport(
  rawRows: Record<string, unknown>[],
  existing: Pick<Bottle, "name" | "distillery">[] = [],
): ImportReview {
  const seen = new Map<string, number>();
  const existingKeys = new Set(existing.map((b) => duplicateKey(b.name, b.distillery)));

  const rows: ImportReviewRow[] = rawRows.map((input, index) => {
    const row = index + 2;
    const errors: string[] = [];
    const warnings: string[] = [];
    const normalized: Record<string, string | number | null> = {};

    for (const field of TEXT_FIELDS) {
      const value = textValue(input[field]);
      if (value) normalized[field] = value;
    }
    normalized.distillery = canonicalDistillery(normalized.distillery as string | undefined);
    if (!normalized.name) errors.push("Name is required.");

    const age = numberValue(input.age_years, /[,\s]|years?|yrs?/gi);
    if (Number.isNaN(age)) errors.push("Age must be a number.");
    else if (age != null && (age < 0 || age > 100)) errors.push("Age must be between 0 and 100 years.");
    else if (age != null) normalized.age_years = age;

    const abv = numberValue(input.abv, /[,\s%]/g);
    if (Number.isNaN(abv)) errors.push("ABV must be a number or percentage.");
    else if (abv != null && (abv < 0 || abv > 100)) errors.push("ABV must be between 0% and 100%.");
    else if (abv != null) normalized.abv = abv;

    const size = numberValue(input.size_ml, /[,\s]|ml/gi);
    if (Number.isNaN(size)) errors.push("Bottle size must be a number.");
    else if (size != null && size <= 0) errors.push("Bottle size must be greater than zero.");
    normalized.size_ml = size ?? 750;

    const price = numberValue(input.purchase_price, /[$,\s]/g);
    if (Number.isNaN(price)) errors.push("Purchase price must be a number or currency amount.");
    else if (price != null && price < 0) errors.push("Purchase price cannot be negative.");
    else if (price != null) normalized.purchase_price = price;

    const date = textValue(input.purchase_date);
    if (date && !validDate(date)) errors.push("Purchase date must be a real date in YYYY-MM-DD format.");
    else if (date) normalized.purchase_date = date;

    const status = textValue(input.status).toLowerCase();
    if (status && !VALID_STATUS.has(status)) errors.push("Status must be sealed, open, or finished.");
    else if (status) normalized.status = status;

    const remainingMl = numberValue(input.remaining_ml, /[,\s]|ml/gi);
    const remainingRaw = input.remaining_pct ?? input.remaining_percent ?? input.remaining;
    const remainingPct = numberValue(remainingRaw, /[,\s%]/g);
    if (Number.isNaN(remainingMl)) errors.push("Remaining ml must be a number.");
    if (Number.isNaN(remainingPct)) errors.push("Remaining percentage must be a number or percentage.");
    if (remainingPct != null && !Number.isNaN(remainingPct) && (remainingPct < 0 || remainingPct > 100))
      errors.push("Remaining percentage must be between 0% and 100%.");
    if (remainingMl != null && !Number.isNaN(remainingMl) && remainingMl < 0)
      errors.push("Remaining ml cannot be negative.");
    if (remainingMl != null && !Number.isNaN(remainingMl) && remainingPct != null)
      errors.push("Use remaining_ml or remaining_pct, not both.");

    const bottleSize = Number(normalized.size_ml);
    if (remainingMl != null && !Number.isNaN(remainingMl)) {
      if (remainingMl > bottleSize) errors.push("Remaining ml cannot exceed bottle size.");
      else normalized.remaining_ml = remainingMl;
    } else if (remainingPct != null && !Number.isNaN(remainingPct) && remainingPct >= 0 && remainingPct <= 100) {
      normalized.remaining_ml = Math.round((bottleSize * remainingPct) / 100);
    }

    if (normalized.remaining_ml == null && normalized.status === "open") normalized.remaining_ml = bottleSize;
    if (typeof normalized.remaining_ml === "number" && !normalized.status)
      normalized.status = normalized.remaining_ml <= 0 ? "finished" : "open";
    if (normalized.status === "sealed") normalized.remaining_ml = null;
    if (normalized.status === "finished") normalized.remaining_ml = 0;
    if (!normalized.status) normalized.status = "sealed";

    const key = duplicateKey(normalized.name, normalized.distillery);
    if (normalized.name && existingKeys.has(key))
      warnings.push("A bottle with the same name and distillery already exists; this row will still import.");
    if (normalized.name && seen.has(key))
      warnings.push("Duplicates CSV row " + seen.get(key) + "; this row will still import.");
    else if (normalized.name) seen.set(key, row);

    return {
      row,
      input: Object.fromEntries(Object.entries(input).map(([key, value]) => [key, textValue(value)])),
      normalized: errors.length ? null : normalized,
      errors,
      warnings,
      ready: errors.length === 0,
    };
  });

  return {
    rows,
    ready: rows.filter((row) => row.ready).length,
    blocked: rows.filter((row) => !row.ready).length,
    warnings: rows.reduce((count, row) => count + row.warnings.length, 0),
  };
}
