// "Look up a bottle online" — turns a search term into candidate bottles the
// user can one-tap into the Add-Bottle form. Sources are keyless public APIs:
//   • Wikipedia  (reliable descriptions, images, often ABV/age in the text)
//   • Open Food Facts (product data + barcode; best-effort, skipped if down)

export interface BottleCandidate {
  name: string;
  distillery: string | null;
  category: string | null;
  age_years: number | null;
  abv: number | null;
  size_ml: number | null;
  notes: string | null;
  photo_url: string | null;
  source_url: string | null;
  barcode: string | null;
  source: string;
}

const UA =
  "WhiskeyCellar/1.0 (self-hosted whiskey inventory app; single-user occasional lookups)";
const WHISKEY_WORDS =
  /\b(whisk(e)?y|bourbon|rye|scotch|single malt|blended malt|spirit|distiller|liqueur)\b/i;

const CATEGORY_RULES: [RegExp, string][] = [
  [/\bbourbon\b/i, "Bourbon"],
  [/\btennessee whiskey\b/i, "Tennessee"],
  [/\brye\b/i, "Rye"],
  [/\bsingle malt\b.*\bscotch\b|\bscotch\b.*\bsingle malt\b|\bsingle malt scotch\b/i, "Single Malt Scotch"],
  [/\bblended (scotch|whisky)\b/i, "Blended Scotch"],
  [/\bscotch\b/i, "Single Malt Scotch"],
  [/\birish whiskey\b/i, "Irish"],
  [/\bjapanese whisky\b/i, "Japanese"],
  [/\bcanadian whisky\b/i, "Canadian"],
];

async function getJson<T = any>(url: string, ms: number): Promise<T | null> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: ac.signal,
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("json")) return null;
    // Decode explicitly as UTF-8 so accented names don't get mangled.
    const text = new TextDecoder("utf-8").decode(await res.arrayBuffer());
    return JSON.parse(text) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function parseAbv(text: string): number | null {
  const pct = text.match(/(\d{2}(?:\.\d)?)\s*%\s*(?:abv|alc|alcohol)/i) || text.match(/(\d{2}(?:\.\d)?)\s*%/);
  if (pct) {
    const v = parseFloat(pct[1]);
    if (v >= 20 && v <= 75) return v;
  }
  const proof = text.match(/(\d{2,3})\s*(?:°|degrees\s*)?proof/i);
  if (proof) {
    const v = parseInt(proof[1], 10) / 2;
    if (v >= 20 && v <= 75) return v;
  }
  return null;
}

function parseAge(text: string): number | null {
  const m = text.match(/\b(\d{1,2})[\s-]*(?:years?|yr)s?(?:[\s-]*old)?\b/i);
  if (m) {
    const v = parseInt(m[1], 10);
    if (v >= 2 && v <= 50) return v;
  }
  return null;
}

function pickCategory(text: string): string | null {
  for (const [re, cat] of CATEGORY_RULES) if (re.test(text)) return cat;
  return null;
}

function parseSizeMl(quantity: string | undefined | null): number | null {
  if (!quantity) return null;
  const m = quantity.match(/([\d.]+)\s*(ml|cl|l|liter|litre)\b/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const unit = m[2].toLowerCase();
  if (unit === "ml") return Math.round(n);
  if (unit === "cl") return Math.round(n * 10);
  return Math.round(n * 1000);
}

const stripHtml = (s: string) => s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

async function fromWikipedia(query: string): Promise<BottleCandidate[]> {
  // One search call (MediaWiki REST — friendlier rate limits than the action API).
  const searchUrl =
    "https://en.wikipedia.org/w/rest.php/v1/search/page?limit=6&q=" + encodeURIComponent(query);
  const data = await getJson<{
    pages?: { key: string; title: string; description?: string; excerpt?: string; thumbnail?: { url?: string } }[];
  }>(searchUrl, 5000);
  const pages = data?.pages ?? [];

  // Query tokens (3+ chars) — a Wikipedia hit must share at least one with the
  // search, so "Lagavulin" doesn't drag in "Laphroaig distillery".
  const qWords = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2);

  const hits = pages
    .filter((p) => {
      const title = p.title.toLowerCase();
      const blob = `${p.title} ${p.description ?? ""} ${stripHtml(p.excerpt ?? "")}`;
      return (
        WHISKEY_WORDS.test(blob) &&
        (qWords.length === 0 || qWords.some((w) => title.includes(w)))
      );
    })
    .slice(0, 4);

  // Enrich the survivors with the page summary (extract → ABV/age). Best-effort:
  // if a summary call fails we still emit a candidate from the search hit alone.
  return Promise.all(
    hits.map(async (p) => {
      let extract = stripHtml(p.excerpt ?? "");
      const thumb = p.thumbnail?.url;
      let photo = thumb ? (thumb.startsWith("//") ? `https:${thumb}` : thumb) : null;
      let url = `https://en.wikipedia.org/wiki/${encodeURIComponent(p.key)}`;
      const s = await getJson<Record<string, any>>(
        "https://en.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(p.key),
        4500,
      );
      if (s) {
        if (s.extract) extract = s.extract;
        photo = s.thumbnail?.source ?? s.originalimage?.source ?? photo;
        url = s.content_urls?.desktop?.page ?? url;
      }
      const blob = `${p.title} ${p.description ?? ""} ${extract}`;
      return {
        name: p.title,
        distillery: null,
        category: pickCategory(blob),
        age_years: parseAge(blob),
        abv: parseAbv(extract),
        size_ml: null,
        notes: extract ? extract.slice(0, 400) : p.description ?? null,
        photo_url: photo,
        source_url: url,
        barcode: null,
        source: "Wikipedia",
      } satisfies BottleCandidate;
    }),
  );
}

async function fromOpenFoodFacts(query: string): Promise<BottleCandidate[]> {
  const url =
    "https://world.openfoodfacts.org/cgi/search.pl?search_simple=1&action=process&json=1&page_size=6" +
    "&fields=code,product_name,brands,quantity,image_front_url,image_url,categories,nutriments,generic_name" +
    "&search_terms=" +
    encodeURIComponent(query);
  const data = await getJson<{ products?: Record<string, any>[] }>(url, 5000);
  return (data?.products ?? [])
    .filter((p) => (p.product_name || p.generic_name) && WHISKEY_WORDS.test(`${p.product_name} ${p.categories ?? ""}`))
    .map((p) => {
      const cat = String(p.categories ?? "");
      const abvRaw = p.nutriments?.["alcohol_value"] ?? p.nutriments?.["alcohol_100g"] ?? p.nutriments?.alcohol;
      const abv = abvRaw != null && !isNaN(Number(abvRaw)) ? Number(abvRaw) : null;
      return {
        name: (p.product_name || p.generic_name) as string,
        distillery: p.brands ? String(p.brands).split(",")[0].trim() : null,
        category: pickCategory(cat),
        age_years: parseAge(`${p.product_name} ${p.generic_name ?? ""}`),
        abv: abv && abv >= 20 && abv <= 75 ? abv : null,
        size_ml: parseSizeMl(p.quantity),
        notes: null,
        photo_url: p.image_front_url ?? p.image_url ?? null,
        source_url: p.code ? `https://world.openfoodfacts.org/product/${p.code}` : null,
        barcode: p.code ?? null,
        source: "Open Food Facts",
      } satisfies BottleCandidate;
    });
}

export async function lookupBottles(query: string): Promise<BottleCandidate[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const [off, wiki] = await Promise.allSettled([fromOpenFoodFacts(q), fromWikipedia(q)]);
  // Actual products (Open Food Facts) first, then Wikipedia articles.
  const all = [
    ...(off.status === "fulfilled" ? off.value : []),
    ...(wiki.status === "fulfilled" ? wiki.value : []),
  ];

  // De-dupe by lowercased name, keeping the richer entry.
  const byName = new Map<string, BottleCandidate>();
  const score = (x: BottleCandidate) =>
    [x.abv, x.age_years, x.category, x.photo_url, x.notes, x.barcode].filter(Boolean).length;
  for (const c of all) {
    const key = c.name.toLowerCase().replace(/\s+/g, " ").trim();
    const existing = byName.get(key);
    if (!existing || score(c) > score(existing)) byName.set(key, c);
  }
  return [...byName.values()].slice(0, 8);
}
