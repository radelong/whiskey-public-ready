export function proof(abv: number | null | undefined): string {
  return abv == null ? "" : `${abv}% ABV · ${Math.round(abv * 2)} proof`;
}

export function money(n: number | null | undefined): string {
  return n == null ? "—" : `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const ESTIMATED_POUR_ML = 45;

export function poursLeft(remaining: number | null, size: number): string {
  const ml = remaining ?? size;
  const pct = size > 0 ? Math.max(0, Math.min(100, Math.round((ml / size) * 100))) : 0;
  const pours = Math.floor(Math.max(0, ml) / ESTIMATED_POUR_ML);
  const estimate =
    ml <= 0
      ? `0 × ${ESTIMATED_POUR_ML} ml pours`
      : pours < 1
        ? `<1 × ${ESTIMATED_POUR_ML} ml pour`
        : `~${pours} × ${ESTIMATED_POUR_ML} ml pours`;
  return `${Math.max(0, ml)} ml left · ${estimate} · ${pct}%`;
}

export function bottleLine(b: {
  distillery?: string | null;
  category?: string | null;
  age_years?: number | null;
  abv?: number | null;
}): string {
  return [b.distillery, b.category, b.age_years ? `${b.age_years} yr` : null, proof(b.abv) || null]
    .filter(Boolean)
    .join("  ·  ");
}
