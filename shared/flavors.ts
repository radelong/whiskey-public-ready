import type { FlavorProfile, FlavorTag } from "./types";

export const FLAVOR_LABELS: Record<FlavorTag, string> = {
  caramel: "Caramel / toffee",
  vanilla: "Vanilla",
  oak: "Oak / wood",
  "baking-spice": "Baking spice",
  pepper: "Pepper / heat",
  citrus: "Citrus",
  "orchard-fruit": "Orchard fruit",
  "dark-fruit": "Dark fruit",
  "dried-fruit": "Dried fruit",
  honey: "Honey",
  floral: "Floral",
  chocolate: "Chocolate / cocoa",
  nuts: "Nuts",
  smoke: "Smoke",
  leather: "Leather / tobacco",
  mint: "Mint / herbs",
  grain: "Grain / malt",
  coffee: "Coffee",
};

export const FLAVOR_TAGS = Object.keys(FLAVOR_LABELS) as FlavorTag[];

/** A short, original sentence based only on a bottle's saved flavor descriptors. */
export function flavorSummary(profile: FlavorProfile | null | undefined, source?: string | null): string | null {
  if (!profile) return null;
  const entries = Object.entries(profile)
    .filter(([tag, strength]) => tag in FLAVOR_LABELS && strength != null)
    .map(([tag, strength]) => ({ label: FLAVOR_LABELS[tag as FlavorTag], strength: strength as number }))
    .sort((a, b) => b.strength - a.strength || a.label.localeCompare(b.label));
  if (!entries.length) return null;

  const selected = entries.slice(0, 5);
  const prominent = selected.filter((entry) => entry.strength >= 2).map((entry) => entry.label);
  const subtle = selected.filter((entry) => entry.strength === 1).map((entry) => entry.label);
  const join = (items: string[]) => items.length < 2
    ? items[0]
    : items.length === 2
      ? `${items[0]} and ${items[1]}`
      : `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
  const opening = source?.includes("Closest release:") ? "Similar-release reference: notes of" : "Expect notes of";
  if (!prominent.length) return `${source?.includes("Closest release:") ? opening : "Expect subtle notes of"} ${join(subtle)}.`;
  return `${opening} ${join(prominent)}${subtle.length ? `, with hints of ${join(subtle)}` : ""}.`;
}
