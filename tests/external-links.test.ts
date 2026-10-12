import { describe, expect, it } from "vitest";
import { distilleryWebsite, externalResultUrl, standardBottleName, whiskybaseResultUrl } from "../worker/external-links";

describe("external catalog links", () => {
  it("uses the standard release name for private picks", () => {
    expect(standardBottleName("Single Barrel Example Store Pick")).toBe("Single Barrel");
    expect(standardBottleName("Private Release Example Store Pick")).toBe("Private Release");
  });

  it("uses a direct official homepage when the distillery is known", () => {
    expect(distilleryWebsite("1792")).toBe("https://1792bourbon.com/");
    expect(distilleryWebsite("Holladay")).toBe("https://holladaydistillery.com/");
  });

  it("accepts only direct Whiskybase product pages", () => {
    expect(whiskybaseResultUrl('href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.whiskybase.com%2Fwhiskies%2Fwhisky%2F164468%2Felijah-craig-toasted-barrel&amp;rut=x"'))
      .toBe("https://www.whiskybase.com/whiskies/whisky/164468/elijah-craig-toasted-barrel");
    expect(whiskybaseResultUrl('uddg=https%3A%2F%2Fexample.com%2Fwhisky')).toBeNull();
  });

  it("finds a normal website while skipping search engines", () => {
    const html = 'uddg=https%3A%2F%2Fwww.google.com%2Fsearch&amp;x=1 uddg=https%3A%2F%2Fwww.buffalotracedistillery.com%2F&amp;x=2';
    expect(externalResultUrl(html)).toBe("https://www.buffalotracedistillery.com/");
  });
});
