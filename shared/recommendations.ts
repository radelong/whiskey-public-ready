import type { Bottle, FlavorTag, WhiskeyRecommendation } from "./types";

/** Rank only available, flavor-profiled bottles the taster has not rated. */
export function recommendWhiskeys(
  bottles: Bottle[],
  reviews: { bottle_id: number; rating: number | null }[],
  limit = 10,
): WhiskeyRecommendation[] {
  const ratedIds = new Set(reviews.filter((review) => review.rating != null).map((review) => review.bottle_id));
  const preference = new Map<FlavorTag, { signal: number; samples: number }>();
  const proofSamples: { proof: number; weight: number }[] = [];

  for (const review of reviews) {
    if (review.rating == null) continue;
    const bottle = bottles.find((item) => item.id === review.bottle_id);
    if (bottle?.abv != null && bottle.abv > 0) proofSamples.push({ proof: bottle.abv * 2, weight: Math.max(review.rating, 0.25) });
    if (!bottle?.flavor_profile) continue;
    const signal = (review.rating - 3) / 2;
    for (const [tag, strength] of Object.entries(bottle.flavor_profile) as [FlavorTag, number][]) {
      const current = preference.get(tag) ?? { signal: 0, samples: 0 };
      current.signal += signal * (strength / 3);
      current.samples += 1;
      preference.set(tag, current);
    }
    // ABV/proof is entered by the cellar owner. Recommendations only read it;
    // they never infer or modify proof from flavor notes.
  }

  const preferredProof = proofSamples.length
    ? proofSamples.reduce((sum, item) => sum + item.proof * item.weight, 0) / proofSamples.reduce((sum, item) => sum + item.weight, 0)
    : null;
  const profiles = [...preference.entries()]
    .map(([tag, value]) => [tag, value.signal / value.samples] as const)
    .filter(([, value]) => Math.abs(value) > 0);

  return bottles
    .filter((bottle) => {
      const remaining = bottle.remaining_ml ?? bottle.size_ml;
      return !ratedIds.has(bottle.id) && bottle.status !== "finished" && remaining > 0 && !!bottle.flavor_profile && Object.keys(bottle.flavor_profile).length > 0;
    })
    .map((bottle) => {
      const flavorSignals = profiles
        .map(([tag, preferenceValue]) => ({ tag, value: preferenceValue * ((bottle.flavor_profile?.[tag] ?? 0) / 3) }))
        .filter((match) => match.value !== 0);
      const matches = flavorSignals
        .filter((match) => match.value > 0)
        .sort((a, b) => b.value - a.value);
      const flavorScore = profiles.length
        ? flavorSignals.reduce((sum, match) => sum + match.value, 0) / profiles.length
        : 0;
      const proof = bottle.abv != null && bottle.abv > 0 ? bottle.abv * 2 : null;
      const proofScore = preferredProof != null && proof != null ? Math.max(0, 1 - Math.abs(proof - preferredProof) / 60) : null;
      const score = proofScore == null ? flavorScore : flavorScore * 0.85 + proofScore * 0.15;
      return {
        bottle,
        score,
        reasons: matches.slice(0, 3).map((match) => match.tag.replaceAll("-", " ")),
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.bottle.name.localeCompare(b.bottle.name))
    .slice(0, limit);
}
