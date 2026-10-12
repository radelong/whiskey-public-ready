import { FLAVOR_TAGS } from "../shared/flavors";
import type { FlavorProfile, FlavorTag } from "../shared/types";

const ALIASES: Record<FlavorTag, RegExp> = {
  caramel: /\bcaramel|toffee|butterscotch|molasses\b/gi,
  vanilla: /\bvanilla|vanillin\b/gi,
  oak: /\boak|woody|wood|barrel char\b/gi,
  "baking-spice": /\bbaking spices?|cinnamon|clove|nutmeg|allspice|rye spice\b/gi,
  pepper: /\bpepper|peppery|chili|heat\b/gi,
  citrus: /\bcitrus|orange|lemon|lime|grapefruit\b/gi,
  "orchard-fruit": /\bapple|pear|peach|apricot\b/gi,
  "dark-fruit": /\bcherr(?:y|ies)|plum|blackberry|raspberry|blueberry\b/gi,
  "dried-fruit": /\braisin|date|fig|prune|dried fruit\b/gi,
  honey: /\bhoney\b/gi,
  floral: /\bfloral|flower|rose|lavender|violet\b/gi,
  chocolate: /\bchocolate|cocoa\b/gi,
  nuts: /\bnutty|peanut|almond|pecan|walnut|hazelnut\b/gi,
  smoke: /\bsmok(?:e|y|ed)|charcoal\b/gi,
  leather: /\bleather|tobacco\b/gi,
  mint: /\bmint|menthol|herbal\b/gi,
  grain: /\bgrain|corn|malt(?:y)?|cereal\b/gi,
  coffee: /\bcoffee|espresso\b/gi,
};

function decodeText(text: string): string {
  return text
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

/** A compact, structured extraction only; review prose is never stored or re-served. */
export function extractFlavorProfile(html: string): FlavorProfile {
  const headings = [...html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi)];
  const sections: string[] = [];
  for (let index = 0; index < headings.length; index++) {
    const title = decodeText(headings[index][2]).toLowerCase();
    if (!["nose", "palate", "finish"].includes(title)) continue;
    const start = headings[index].index! + headings[index][0].length;
    const end = headings[index + 1]?.index ?? Math.min(html.length, start + 18_000);
    sections.push(decodeText(html.slice(start, end)));
  }

  // WhiskyCast reviews generally put the tasting description in prose rather
  // than separate Nose/Palate/Finish headings. Extract only controlled flavor
  // tags from sensory paragraphs; never retain or return the source paragraph.
  if (!sections.length) {
    const paragraphs = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p\s*>/gi)]
      .map((match) => decodeText(match[1]))
      .filter((paragraph) => paragraph.length >= 45 &&
        (/\b(nose|palate|taste|flavou?r|finish|aroma)\b/i.test(paragraph) ||
          Object.values(ALIASES).filter((matcher) => {
            matcher.lastIndex = 0;
            return matcher.test(paragraph);
          }).length >= 2));
    sections.push(...paragraphs);
  }

  const profile: FlavorProfile = {};
  for (const tag of FLAVOR_TAGS) {
    const matcher = ALIASES[tag];
    const hits = sections.map((section) => {
      matcher.lastIndex = 0;
      return [...section.matchAll(matcher)].length;
    });
    const sectionCount = hits.filter((count) => count > 0).length;
    const totalHits = hits.reduce((sum, count) => sum + count, 0);
    if (totalHits) profile[tag] = Math.min(3, Math.max(sectionCount, totalHits >= 4 ? 3 : totalHits >= 2 ? 2 : 1)) as 1 | 2 | 3;
  }
  return profile;
}

export function whiskyCastResultUrls(payload: unknown): string[] {
  if (!Array.isArray(payload)) return [];
  const urls: string[] = [];
  for (const result of payload) {
    if (!result || typeof result !== "object") continue;
    const entry = result as { subtype?: unknown; url?: unknown };
    if (entry.subtype !== "ratings" || typeof entry.url !== "string") continue;
    try {
      const url = new URL(entry.url);
      if (["whiskycast.com", "www.whiskycast.com"].includes(url.hostname.toLowerCase()) && /^\/ratings\//.test(url.pathname))
        urls.push(`https://whiskycast.com${url.pathname}`);
    } catch { /* Ignore malformed or non-absolute result URLs. */ }
  }
  return [...new Set(urls)];
}

const NOTE_STOP_WORDS = new Set(["a", "an", "the", "and", "of", "in", "bourbon", "whiskey", "whisky", "review", "ratings", "straight", "bottle", "aged", "year", "years", "old", "distillery", "distilleries", "company", "spirit", "spirits", "finished"]);
const NOTE_VARIANTS = new Set(["rye", "single", "barrel", "cask", "proof", "strength", "full", "double", "oaked", "oak", "toasted", "wheated", "malt", "bond", "bottled", "small", "batch", "reserve", "honey", "port", "sherry", "rum", "cognac", "singleoak"]);
const NUMBER_WORDS: Record<string, string> = { one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10", twelve: "12", fifteen: "15", twenty: "20" };

function noteTokens(value: string): string[] {
  return value.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").split(/\s+/)
    .map((token) => NUMBER_WORDS[token] ?? (token === "haydens" ? "hayden" : token))
    .filter((token) => token && !NOTE_STOP_WORDS.has(token));
}

/** Require the product identity, including age/batch/style, before ranking results. */
export function reviewMatchScore(url: string, name: string, distillery: string | null): number {
  const product = noteTokens(name);
  const maker = noteTokens(distillery ?? "");
  const actual = noteTokens(new URL(url).pathname);
  if (!product.length) return 0;
  const count = (items: string[], token: string) => items.filter((item) => item === token).length;
  if (product.some((token) => count(actual, token) < count(product, token))) return 0;
  const expected = new Set([...product, ...maker]);
  // Generic names such as "Small Batch" need a maker match too.
  const generic = product.every((token) => NOTE_VARIANTS.has(token) || /^\d+$/.test(token));
  if (generic && (!maker.length || maker.some((token) => !actual.includes(token)))) return 0;
  for (const token of actual) {
    if (token === "batch" && product.some((part) => /^[a-z]\d{3}$/i.test(part))) continue;
    if (["single", "barrel"].includes(token) && product.join(" ") === "elmer t lee") continue;
    // Unknown additional words can identify a different brand or special release
    // (American Oak vs Auchentoshan American Oak, Blanton's vs Blanton's Gold).
    // Do not treat a product-name substring as enough evidence to save a profile.
    if (!expected.has(token) && !["edition", "kentucky"].includes(token) && !/^20\d{2}$/.test(token) && !/^us\d$/.test(token)) return 0;
    if (NOTE_VARIANTS.has(token) && (!expected.has(token) || count(actual, token) > Math.max(count(product, token), count(maker, token)))) return 0;
    // A release year can vary; an age or batch number cannot.
    if (/\d/.test(token) && !expected.has(token) && !/^20\d{2}$/.test(token) && !/^us\d$/.test(token)) return 0;
  }
  const extra = actual.filter((token) => !expected.has(token)).length;
  const makerHits = maker.filter((token) => actual.includes(token)).length;
  return 100 + makerHits * 2 - extra;
}

export function reviewMatchesBottle(url: string, name: string, distillery: string | null): boolean {
  return reviewMatchScore(url, name, distillery) > 0;
}
