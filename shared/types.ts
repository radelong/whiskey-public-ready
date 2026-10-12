// Types shared between the Worker API and the React front end.

export type BottleStatus = "sealed" | "open" | "finished";
export type RequestStatus = "pending" | "poured" | "declined";
export type FlavorTag =
  | "caramel" | "vanilla" | "oak" | "baking-spice" | "pepper" | "citrus"
  | "orchard-fruit" | "dark-fruit" | "dried-fruit" | "honey" | "floral"
  | "chocolate" | "nuts" | "smoke" | "leather" | "mint" | "grain" | "coffee";
export type FlavorProfile = Partial<Record<FlavorTag, 1 | 2 | 3>>;

export interface Bottle {
  id: number;
  /** Incremented on each inventory mutation to reject stale edit forms. */
  version: number;
  name: string;
  distillery: string | null;
  category: string | null;
  age_years: number | null;
  abv: number | null;
  size_ml: number;
  purchase_date: string | null;
  purchase_price: number | null;
  status: BottleStatus;
  remaining_ml: number | null;
  location: string | null;
  photo_key: string | null;
  photo_url: string | null;
  barcode: string | null;
  source_url: string | null;
  /** Structured flavor tags (1 subtle – 3 prominent), saved as bottle data. */
  flavor_profile?: FlavorProfile | null;
  flavor_source?: string | null;
  flavor_source_url?: string | null;
  flavor_updated_at?: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  /** aggregate of taster ratings, present on list responses */
  avg_rating?: number | null;
  rating_count?: number | null;
}

/** A guest who signs up on the tasting site to keep their own notes. */
export interface Taster {
  id: number;
  username: string;
  display_name: string | null;
}

export interface TasterTasting {
  id: number;
  bottle_id: number;
  bottle_name: string;
  distillery: string | null;
  category: string | null;
  rating: number | null;
  nose: string | null;
  palate: string | null;
  finish: string | null;
  notes: string | null;
  created_at: string;
  request_id: number | null;
  pour_ml: number;
  approved_at?: string | null;
}

export interface TastingNoteInput {
  bottle_id: number;
  request_id: number;
  rating?: number | null;
  nose?: string | null;
  palate?: string | null;
  finish?: string | null;
  notes?: string | null;
}

/** Admin view: a per-taster summary + every note they've logged. */
export interface TasterSummary {
  id: number;
  username: string;
  display_name: string | null;
  created_at: string;
  note_count: number;
  avg_rating: number | null;
  last_at: string | null;
}

export interface AdminTasterNote {
  id: number;
  taster_id: number;
  taster: string;
  bottle_id: number;
  bottle_name: string;
  distillery: string | null;
  category: string | null;
  rating: number | null;
  nose: string | null;
  palate: string | null;
  finish: string | null;
  notes: string | null;
  created_at: string;
}

export interface WhiskeyDetail {
  id: number;
  name: string;
  distillery: string | null;
  category: string | null;
  age_years: number | null;
  abv: number | null;
  size_ml: number;
  status: BottleStatus;
  photo_url: string | null;
  avg_rating: number | null;
  rating_count: number;
  notes: {
    id: number;
    rating: number | null;
    nose: string | null;
    palate: string | null;
    finish: string | null;
    notes: string | null;
    created_at: string;
  }[];
  flavor_profile?: FlavorProfile | null;
  flavor_source?: string | null;
  flavor_source_url?: string | null;
}

export interface WhiskeyRecommendation {
  bottle: Pick<Bottle,
    "id" | "name" | "distillery" | "category" | "age_years" | "abv" | "size_ml" | "status"
    | "photo_url" | "flavor_profile" | "flavor_source" | "flavor_source_url" | "avg_rating" | "rating_count"
  >;
  score: number;
  reasons: string[];
}

/** A bottle suggestion from the online lookup. */
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

export interface TastingRequest {
  id: number;
  bottle_id: number | null;
  bottle_text: string | null;
  requester_name: string;
  note: string | null;
  status: RequestStatus;
  created_at: string;
  resolved_at: string | null;
  taster_id?: number | null;
  pour_ml?: number | null;
  approved_at?: string | null;
  cancelled_at?: string | null;
  tasting_id?: number | null;
}

export interface Tasting {
  id: number;
  bottle_id: number;
  request_id: number | null;
  taster_name: string | null;
  pour_ml: number;
  rating: number | null;
  nose: string | null;
  palate: string | null;
  finish: string | null;
  notes: string | null;
  created_at: string;
}

// Payloads
export type BottleInput = Partial<Omit<Bottle, "id" | "created_at" | "updated_at">> &
  Pick<Bottle, "name">;

export interface RequestInput {
  bottle_id?: number | null;
  bottle_text?: string | null;
  requester_name?: string;
  note?: string | null;
}

export interface TastingInput {
  bottle_id: number;
  request_id?: number | null;
  taster_name?: string | null;
  pour_ml?: number;
  rating?: number | null;
  nose?: string | null;
  palate?: string | null;
  finish?: string | null;
  notes?: string | null;
}

export interface ImportReviewRow {
  row: number;
  input: Record<string, string>;
  normalized: Record<string, string | number | null> | null;
  errors: string[];
  warnings: string[];
  ready: boolean;
}

export interface ImportReview {
  rows: ImportReviewRow[];
  ready: number;
  blocked: number;
  warnings: number;
}
