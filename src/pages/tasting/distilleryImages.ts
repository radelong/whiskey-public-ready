/** Generic self-authored illustration; no original photos or personal catalog. */
export function distilleryImage(name: string): string | null {
  let normalized: string;
  try { normalized = decodeURIComponent(name).trim(); } catch { return null; }
  return normalized ? "/distilleries/example.svg" : null;
}
