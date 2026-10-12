import { describe, expect, it } from "vitest";
import type { Bottle } from "../shared/types";
import { distilleryGroups, filterWhiskeys, matchesProofBand } from "../src/pages/tasting/whiskeyFilters";

const bottle = (name: string, distillery: string | null, abv: number | null): Bottle => ({
  id: 1,
  version: 0,
  name,
  distillery,
  category: "Bourbon",
  age_years: null,
  abv,
  size_ml: 750,
  purchase_date: null,
  purchase_price: null,
  status: "sealed",
  remaining_ml: null,
  location: null,
  photo_key: null,
  photo_url: null,
  barcode: null,
  source_url: null,
  notes: null,
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
});

describe("tasting whiskey filters", () => {
  it("places proof values in the requested bands", () => {
    expect(matchesProofBand(bottle("Low", "A", 44), "under-90")).toBe(true);
    expect(matchesProofBand(bottle("Eighty-nine", "A", 44.5), "under-90")).toBe(false);
    expect(matchesProofBand(bottle("Ninety", "A", 45), "90-99")).toBe(true);
    expect(matchesProofBand(bottle("Hundred", "A", 50), "100-119")).toBe(true);
    expect(matchesProofBand(bottle("High", "A", 60), "120-plus")).toBe(true);
    expect(matchesProofBand(bottle("Unknown", "A", null), "90-99")).toBe(false);
  });

  it("combines search, distillery, and proof filters without changing list order", () => {
    const bottles = [
      bottle("Alpha Bourbon", "North", 50),
      bottle("Alpha Rye", "South", 50),
      bottle("Beta Bourbon", "North", 60),
    ];

    expect(
      filterWhiskeys(bottles, { query: "alpha", distillery: "North", proofBand: "100-119" }).map(
        (item) => item.name,
      ),
    ).toEqual(["Alpha Bourbon"]);
  });

  it("groups a normalized distillery name into one directory button", () => {
    const groups = distilleryGroups([
      bottle("One", "  North  ", 50),
      bottle("Two", "North", 55),
      bottle("No maker", null, 45),
    ]);

    expect(groups).toEqual([{ name: "North", count: 2, avg_rating: null, rating_count: 0 }]);
  });

  it("uses every bottle rating for a distillery summary, even when filtering its displayed bottles", () => {
    const first = { ...bottle("North low", "North", 45), avg_rating: 4, rating_count: 1 };
    const second = { ...bottle("North high", "North", 60), avg_rating: 5, rating_count: 1 };
    expect(distilleryGroups([first, second], [first])).toEqual([
      { name: "North", count: 1, avg_rating: 4.5, rating_count: 2 },
    ]);
  });
});
