import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { distilleryImage } from "../src/pages/tasting/distilleryImages";
describe("generic distillery illustration", () => {
  it("uses one existing generic asset for route names and omits empty or malformed names", () => {
    expect(existsSync("public/distilleries/example.svg")).toBe(true);
    for (const name of ["Example Distillery", "  example distillery ", "Example%20Distillery"])
      expect(distilleryImage(name)).toBe("/distilleries/example.svg");
    expect(distilleryImage(" ")).toBeNull();
    expect(distilleryImage("%zz")).toBeNull();
  });
});
