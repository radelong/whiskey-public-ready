import { describe, expect, it } from "vitest";
import type { Bottle } from "../shared/types";
import { flavorSummary } from "../shared/flavors";
import { recommendWhiskeys } from "../shared/recommendations";
import { whiskyCastResultUrls, extractFlavorProfile, reviewMatchesBottle } from "../worker/flavor-profiles";

describe("structured flavor profiles", () => {
  it("renders a single plain-language sentence from saved tags", () => {
    expect(flavorSummary({ vanilla: 3, caramel: 2, citrus: 1 }))
      .toBe("Expect notes of Vanilla and Caramel / toffee, with hints of Citrus.");
    expect(flavorSummary(null)).toBeNull();
    expect(flavorSummary({ oak: 2 }, "Breaking Bourbon — Closest release: Another batch"))
      .toBe("Similar-release reference: notes of Oak / wood.");
  });

  it("extracts only controlled tags from the Nose, Palate and Finish sections", () => {
    const html = `
      <h2>NOSE</h2><p>Caramel, vanilla, and cherry lead, with oak underneath.</p>
      <h2>PALATE</h2><p>Sweet caramel with cinnamon spice, cherry, and vanilla.</p>
      <h2>FINISH</h2><p>Oak and baking spice linger.</p>`;
    expect(extractFlavorProfile(html)).toMatchObject({
      caramel: 2,
      vanilla: 2,
      "dark-fruit": 2,
      oak: 2,
      "baking-spice": 2,
    });
  });

  it("accepts only WhiskyCast ratings results from its search API", () => {
    expect(whiskyCastResultUrls([
      { subtype: "post", url: "https://whiskycast.com/ratings/should-not-match" },
      { subtype: "ratings", url: "https://example.com/ratings/not-whiskycast" },
      { subtype: "ratings", url: "https://whiskycast.com/ratings/buffalo-trace/?utm_source=x" },
      { subtype: "ratings", url: "https://breakingbourbon.com/review/buffalo-trace" },
    ])).toEqual(["https://whiskycast.com/ratings/buffalo-trace/"]);
  });

  it("does not assign a review whose slug is unrelated to the bottle and distillery", () => {
    expect(reviewMatchesBottle("https://whiskycast.com/ratings/old-forester-1920", "Eagle Rare 10", "Buffalo Trace")).toBe(false);
    expect(reviewMatchesBottle("https://whiskycast.com/ratings/buffalo-trace-bourbon", "Buffalo Trace", "Buffalo Trace")).toBe(true);
  });

  it("extracts flavor descriptors from WhiskyCast prose without retaining the prose", () => {
    const html = `<p>One of the most sought-after Irish whiskeys, with a nose that's aromatic and spicy with notes of nutmeg, almonds, and vanilla. The taste is syrupy-smooth with vanilla, muted spices and a pepperiness that builds slowly and lasts well into the finish.</p>`;
    expect(extractFlavorProfile(html)).toMatchObject({ vanilla: 2, nuts: 1, "baking-spice": 1, pepper: 1 });
  });

  it("rejects different ages and variants while preserving exact release matches", () => {
    const matches = (slug: string, name: string, maker: string) => reviewMatchesBottle(`https://whiskycast.com/ratings/${slug}/`, name, maker);
    expect(matches("eagle-rare-17-2018-edition", "Eagle Rare 10", "Buffalo Trace")).toBe(false);
    expect(matches("buffalo-trace-single-oak-bourbon", "Buffalo Trace", "Buffalo Trace")).toBe(false);
    expect(matches("woodford-reserve-double-double-oaked", "Double Oaked", "Woodford Reserve")).toBe(false);
    expect(matches("sagamore-spirit-8-year-old-rye", "Cask Strength", "Sagamore Rye")).toBe(false);
    expect(matches("angels-envy-2026-cask-strength-rye", "Finished Rye", "Angel's Envy")).toBe(false);
    expect(matches("elijah-craig-barrel-proof-batch-b523", "Barrel Proof B523", "Elijah Craig")).toBe(true);
    expect(matches("elmer-t-lee-single-barrel-bourbon", "Elmer T. Lee", "Buffalo Trace")).toBe(true);
    expect(matches("basil-haydens-dark-rye", "Dark Rye", "Basil Hayden")).toBe(true);
    expect(matches("auchentoshan-american-oak", "American Oak", "2XO")).toBe(false);
    expect(matches("writers-tears-cognac-cask-finish", "Cognac Cask Finish", "1792")).toBe(false);
    expect(matches("blantons-gold", "Blanton's", "Buffalo Trace")).toBe(false);
    expect(matches("buffalo-trace-experimental-collection-warehouse-floors", "Buffalo Trace", "Buffalo Trace")).toBe(false);
  });

  it("ranks unrated, available flavor matches across distilleries without changing proof", () => {
    const bottle = (id: number, distillery: string, profile: Bottle["flavor_profile"], abv: number | null = 50, status: Bottle["status"] = "sealed"): Bottle => ({
      id, version: 0, name: `Bottle ${id}`, distillery, category: "Bourbon", age_years: null, abv,
      size_ml: 750, purchase_date: null, purchase_price: null, status, remaining_ml: null,
      location: null, photo_key: null, photo_url: null, barcode: null, source_url: null, notes: null,
      created_at: "2026-01-01", updated_at: "2026-01-01", flavor_profile: profile,
    });
    const rated = bottle(1, "North", { vanilla: 3, "dark-fruit": 2 });
    const best = bottle(2, "South", { vanilla: 3, "dark-fruit": 2 }, 45);
    const second = bottle(3, "North", { vanilla: 2, oak: 1 }, 50);
    const finished = bottle(4, "Other", { vanilla: 3 }, 50, "finished");
    const disliked = bottle(5, "Oak House", { oak: 3 });
    const oakHeavy = bottle(6, "Oak House", { oak: 3 });
    expect(recommendWhiskeys([rated, best, second, finished, disliked, oakHeavy], [
      { bottle_id: 1, rating: 5 },
      { bottle_id: 5, rating: 1 },
    ]).map((item) => item.bottle.id))
      .toEqual([2, 3]);
    expect(best.abv).toBe(45);
  });

  it("returns no recommendations when there are no rated reviews", () => {
    expect(recommendWhiskeys([], [])).toEqual([]);
  });
});
