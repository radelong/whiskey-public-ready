import type {
  AdminTasterNote,
  Bottle,
  BottleCandidate,
  BottleInput,
  RequestInput,
  Taster,
  TasterSummary,
  TasterTasting,
  TastingInput,
  TastingNoteInput,
  WhiskeyDetail,
  TastingRequest,
  ImportReview,
  WhiskeyRecommendation,
} from "../shared/types";

let onUnauthorized: (() => void) | null = null;
/** Let the auth layer react when the API says the session is gone. */
export function setOnUnauthorized(fn: () => void) {
  onUnauthorized = fn;
}

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { "content-type": "application/json" },
    ...opts,
  });
  if (res.status === 401 && !path.startsWith("/taster")) onUnauthorized?.();
  if (!res.ok) {
    const msg = await res
      .json()
      .then((b) => (b as { error?: string }).error)
      .catch(() => null);
    throw new Error(msg || `${res.status} ${res.statusText}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export interface BottleDetail extends Bottle {
  tastings: TastingRow[];
}
export interface TastingRow {
  id: number;
  bottle_id: number;
  bottle_name?: string;
  taster_name: string | null;
  pour_ml: number;
  rating: number | null;
  nose: string | null;
  palate: string | null;
  finish: string | null;
  notes: string | null;
  created_at: string;
}
export interface RequestRow {
  id: number;
  bottle_id: number | null;
  bottle_name: string | null;
  bottle_text: string | null;
  requester_name: string;
  note: string | null;
  status: string;
  created_at: string;
  taster_id: number | null;
  pour_ml: number | null;
  approved_at: string | null;
  cancelled_at: string | null;
}
export interface Stats {
  total_bottles: number;
  sealed: number;
  open: number;
  finished: number;
  total_spent: number;
}
export interface AuthStatus {
  configured: boolean;
  emailLogin: boolean;
  emailTo: string;
  accessWall: boolean;
  authed: boolean;
  label: string | null;
  via: "password" | "email" | "access" | null;
}

export const api = {
  authStatus: () => req<AuthStatus>("/auth/status"),
  requestCode: () => req<{ ok: true; to: string }>("/auth/request-code", { method: "POST" }),
  verifyCode: (code: string) =>
    req<{ ok: true }>("/auth/verify-code", { method: "POST", body: JSON.stringify({ code }) }),
  setup: (username: string, password: string) =>
    req<{ ok: true; username: string }>("/auth/setup", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  login: (username: string, password: string) =>
    req<{ ok: true; username: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  logout: () => req<{ ok: true }>("/auth/logout", { method: "POST" }),
  setCredentials: (username: string, password: string) =>
    req<{ ok: true }>("/auth/credentials", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),

  lookup: (q: string) =>
    req<{ candidates: BottleCandidate[] }>(`/lookup?q=${encodeURIComponent(q)}`),

  stats: () => req<Stats>("/stats"),

  bottles: (status?: string) =>
    req<Bottle[]>(`/bottles${status ? `?status=${status}` : ""}`),
  bottle: (id: number | string) => req<BottleDetail>(`/bottles/${id}`),
  createBottle: (b: BottleInput) =>
    req<Bottle>("/bottles", { method: "POST", body: JSON.stringify(b) }),
  importBottles: (bottles: Record<string, string>[]) =>
    req<{ inserted: number; skipped: number; errors: { row: number; error: string }[]; warnings: number }>(
      "/bottles/import",
      { method: "POST", body: JSON.stringify({ bottles }) },
    ),
  reviewImport: (bottles: Record<string, string>[]) =>
    req<ImportReview>("/bottles/import/review", {
      method: "POST",
      body: JSON.stringify({ bottles }),
    }),
  updateBottle: (id: number, b: Partial<BottleInput>, expectedVersion: number) =>
    req<Bottle>(`/bottles/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ ...b, expected_version: expectedVersion }),
    }),
  deleteBottle: (id: number) => req<void>(`/bottles/${id}`, { method: "DELETE" }),
  openBottle: (id: number) => req<Bottle>(`/bottles/${id}/open`, { method: "POST" }),
  lookupFlavorProfile: (id: number, persist = false) =>
    req<{ found: boolean; skipped?: boolean; reason?: string; flavor_profile?: Bottle["flavor_profile"]; flavor_source?: string; flavor_source_url?: string }>(
      `/bottles/${id}/flavor-lookup`, { method: "POST", body: JSON.stringify({ persist }) },
    ),

  requests: (status = "pending") => req<RequestRow[]>(`/requests?status=${status}`),
  createRequest: (r: RequestInput) =>
    req<RequestRow>("/requests", { method: "POST", body: JSON.stringify(r) }),
  declineRequest: (id: number) =>
    req<RequestRow>(`/requests/${id}/decline`, { method: "POST" }),
  approveRequest: (id: number, pour_ml: number) =>
    req<RequestRow>(`/requests/${id}/approve`, {
      method: "POST",
      body: JSON.stringify({ pour_ml }),
    }),

  tastings: () => req<TastingRow[]>("/tastings"),
  createTasting: (t: TastingInput) =>
    req<{ ok: true }>("/tastings", { method: "POST", body: JSON.stringify(t) }),
  deleteTasting: (id: number) => req<void>(`/tastings/${id}`, { method: "DELETE" }),

  // Admin: all tasters + their notes
  resetTasterPassword: (id: number, password: string) =>
    req<{ ok: true }>(`/tasters/${id}/reset-password`, {
      method: "POST", body: JSON.stringify({ password }),
    }),
  tasterNotes: () =>
    req<{ tasters: TasterSummary[]; notes: AdminTasterNote[] }>("/tasters"),

  // --- Tasting site (guests with their own accounts) ---
  whiskey: (id: number | string) => req<WhiskeyDetail>(`/whiskeys/${id}`),
  recommendations: () => req<{ has_ratings: boolean; profiled_bottles: number; profiled_reviews: number; recommendations: WhiskeyRecommendation[] }>("/taster/recommendations"),
  taster: {
    me: () =>
      req<{ taster: Taster | null; signupCodeRequired: boolean }>("/taster/me"),
    register: (body: {
      username: string;
      password: string;
      display_name?: string;
      code?: string;
    }) => req<{ ok: true }>("/taster/register", { method: "POST", body: JSON.stringify(body) }),
    login: (username: string, password: string) =>
      req<{ ok: true }>("/taster/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      }),
    logout: () => req<{ ok: true }>("/taster/logout", { method: "POST" }),
    updateAccount: (body: { display_name?: string; password?: string }) =>
      req<{ ok: true }>("/taster/account", { method: "POST", body: JSON.stringify(body) }),
    notes: () =>
      req<{ tastings: TasterTasting[]; count: number; avg_rating: number | null }>(
        "/taster/tastings",
      ),
    requests: (bottleId?: number) =>
      req<TastingRequest[]>(`/taster/requests${bottleId ? `?bottle_id=${bottleId}` : ""}`),
    cancelRequest: (id: number) =>
      req<TastingRequest>(`/taster/requests/${id}/cancel`, { method: "POST" }),
    addNote: (t: TastingNoteInput) =>
      req<TasterTasting>("/taster/tastings", { method: "POST", body: JSON.stringify(t) }),
    updateNote: (id: number, t: Partial<TastingNoteInput>) =>
      req<TasterTasting>(`/taster/tastings/${id}`, { method: "PATCH", body: JSON.stringify(t) }),
    deleteNote: (id: number) =>
      req<void>(`/taster/tastings/${id}`, { method: "DELETE" }),
  },
};
