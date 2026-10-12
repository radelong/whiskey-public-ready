import { describe, expect, it } from "vitest";
import { ESTIMATED_POUR_ML, poursLeft } from "../src/lib";
import { canonicalDistillery } from "../shared/distilleries";
import { reviewBottleImport } from "../worker/import-review";

describe("inventory estimates", () => {
  it("uses and names the same 45 ml serving size for full, partial and empty bottles", () => {
    expect(ESTIMATED_POUR_ML).toBe(45);
    expect(poursLeft(null, 750)).toContain("~16 × 45 ml pours");
    expect(poursLeft(30, 750)).toContain("<1 × 45 ml pour");
    expect(poursLeft(0, 750)).toContain("0 × 45 ml pours");
  });
});

describe("CSV duplicate review", () => {
  it("warns about file and collection duplicates without dropping valid rows", () => {
    const review = reviewBottleImport(
      [{ name: "Same", distillery: "Maker" }, { name: "Same", distillery: "Maker" }],
      [{ name: "Same", distillery: "Maker" }],
    );
    expect(review.ready).toBe(2);
    expect(review.blocked).toBe(0);
    expect(review.warnings).toBe(3);
    expect(review.rows.every((row) => row.ready)).toBe(true);
  });
});

describe("distillery naming", () => {
  it("uses the canonical directory names for known spelling variants", () => {
    expect(canonicalDistillery("Barrel")).toBe("Barrell");
    expect(canonicalDistillery("  Bellemeade ")).toBe("Belle Meade");
    expect(canonicalDistillery("Ben Holladay")).toBe("Holladay");
    expect(canonicalDistillery("Rochetaune")).toBe("Roche taune");
    expect(canonicalDistillery("Sazarac")).toBe("Sazerac");
    expect(canonicalDistillery("Sill Austin")).toBe("Still Austin");
  });
});
