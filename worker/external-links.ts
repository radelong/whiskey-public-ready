const PRIVATE_PICK_SUFFIX = /\s+(?:store|club|example(?:\s+store)?)\s+pick$|\s+private\s+(?:barrel|release)$|\s+private\s+selection\s+.*$/i;

// Public commercial-brand examples; no personal catalog or social profiles.
const DISTILLERY_WEBSITES: Record<string, string> = {
  "1792": "https://1792bourbon.com/",
  "holladay": "https://holladaydistillery.com/",
  "buffalo trace": "https://www.buffalotracedistillery.com/",
  "ardbeg": "https://www.ardbeg.com/",
};

export function distilleryWebsite(name: string): string | null {
  return DISTILLERY_WEBSITES[name.trim().toLocaleLowerCase()] ?? null;
}

/** Use the standard bottling when the cellar name includes a private-pick suffix. */
export function standardBottleName(name: string): string {
  return name.trim().replace(PRIVATE_PICK_SUFFIX, "").trim();
}

/** Extract the first verified Whiskybase product page from a DuckDuckGo result page. */
export function whiskybaseResultUrl(html: string): string | null {
  for (const match of html.matchAll(/uddg=([^&"']+)/g)) {
    try {
      const url = decodeURIComponent(match[1]);
      if (/^https:\/\/www\.whiskybase\.com\/whiskies\/whisky\/\d+(?:\/|$)/.test(url)) return url;
    } catch {
      // Ignore malformed result URLs and continue looking.
    }
  }
  return null;
}

/** Return the first normal website result, skipping search engines and social links. */
export function externalResultUrl(html: string): string | null {
  const excluded = /(^https?:\/\/(?:www\.)?(?:duckduckgo\.com|google\.com|bing\.com|facebook\.com|instagram\.com|wikipedia\.org))|whiskybase\.com/i;
  for (const match of html.matchAll(/uddg=([^&"']+)/g)) {
    try {
      const url = decodeURIComponent(match[1]);
      if (/^https:\/\//.test(url) && !excluded.test(url)) return url;
    } catch {
      // Ignore malformed result URLs and continue looking.
    }
  }
  return null;
}

export function duckDuckGoUrl(query: string): string {
  return `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
}
