import type { Bottle } from "../../../shared/types";

export type ProofBand = "all" | "under-90" | "90-99" | "100-119" | "120-plus";

export type DistilleryGroup = {
  name: string;
  count: number;
  avg_rating: number | null;
  rating_count: number;
};

/**
 * Build directory buttons from the bottles that match the current filters while
 * keeping each distillery's rating representative of its complete catalog.
 */
export function distilleryGroups(bottles: Bottle[], visibleBottles = bottles): DistilleryGroup[] {
  const ratings = new Map<string, { total: number; count: number }>();
  for (const bottle of bottles) {
    const name = bottle.distillery?.trim();
    if (!name || bottle.avg_rating == null || !bottle.rating_count) continue;
    const current = ratings.get(name) ?? { total: 0, count: 0 };
    current.total += bottle.avg_rating * bottle.rating_count;
    current.count += bottle.rating_count;
    ratings.set(name, current);
  }
  const counts = new Map<string, number>();
  for (const bottle of visibleBottles) {
    const name = bottle.distillery?.trim();
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => {
      const rating = ratings.get(name);
      return {
        name,
        count,
        avg_rating: rating?.count ? rating.total / rating.count : null,
        rating_count: rating?.count ?? 0,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function matchesProofBand(bottle: Bottle, proofBand: ProofBand): boolean {
  if (proofBand === "all") return true;
  if (bottle.abv == null) return false;

  const bottleProof = Math.round(bottle.abv * 2);
  switch (proofBand) {
    case "under-90":
      return bottleProof < 89;
    case "90-99":
      return bottleProof >= 90 && bottleProof < 100;
    case "100-119":
      return bottleProof >= 100 && bottleProof < 120;
    case "120-plus":
      return bottleProof >= 120;
  }
}

export function filterWhiskeys(
  bottles: Bottle[],
  { query, distillery, proofBand }: { query: string; distillery: string; proofBand: ProofBand },
): Bottle[] {
  const normalizedQuery = query.trim().toLowerCase();
  return bottles.filter((bottle) => {
    const matchesQuery =
      !normalizedQuery ||
      [bottle.name, bottle.distillery, bottle.category].some((value) =>
        value?.toLowerCase().includes(normalizedQuery),
      );
    const matchesDistillery = !distillery || bottle.distillery?.trim() === distillery;
    return matchesQuery && matchesDistillery && matchesProofBand(bottle, proofBand);
  });
}
