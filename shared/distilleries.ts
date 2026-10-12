const CANONICAL_DISTILLERIES: Record<string, string> = {
  barrel: "Barrell",
  bellemeade: "Belle Meade",
  holladay: "Holladay",
  "ben holiday": "Holladay",
  "ben holladay": "Holladay",
  rochetaune: "Roche taune",
  "roche taune": "Roche taune",
  sazarac: "Sazerac",
  sazerac: "Sazerac",
  "sill austin": "Still Austin",
  "still austin": "Still Austin",
};

/** Normalize known spelling variants before storing or comparing distillery names. */
export function canonicalDistillery(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return CANONICAL_DISTILLERIES[trimmed.toLocaleLowerCase()] ?? trimmed;
}
