import type { BBox } from '../lib/geo';
import type { Category, Cleanliness, Food, KeyRequired, ReportReason, Restroom, StallPrivacy } from '../lib/rating';

/** Public summary of a stop. Aggregates are computed by the backend from visible records. */
export interface StopSummary {
  id: string;
  name: string;
  category: Category;
  address: string;
  lat: number;
  lng: number;
  status: 'active' | 'closed';
  created_at: string;
  original_rating: number | null;
  original_visit_date: string | null;
  agree_count: number;
  disagree_count: number;
  crowd_count: number;
  /** Mean of later independent ratings (original excluded), rounded to one decimal; null when none. */
  crowd_avg: number | null;
  last_visit_date: string | null;
  last_rated_at: string | null;
  /** Latest visit that reported each criterion (unknown answers are skipped). */
  cleanliness: Cleanliness | null;
  cleanliness_visit_date: string | null;
  stall_privacy: StallPrivacy | null;
  stall_privacy_visit_date: string | null;
  key_required: KeyRequired | null;
  key_required_visit_date: string | null;
  food: Food | null;
  food_visit_date: string | null;
}

export interface PublicRating {
  id: string;
  is_original: boolean;
  rating: number;
  cleanliness: Cleanliness;
  stall_privacy: StallPrivacy;
  key_required: KeyRequired;
  food: Food;
  restroom: Restroom;
  comment: string | null;
  visit_date: string;
  created_at: string;
  updated_at: string;
}

export interface StopDetail extends StopSummary {
  tallies: {
    cleanliness: Partial<Record<Cleanliness, number>>;
    stall_privacy: Partial<Record<StallPrivacy, number>>;
    key_required: Partial<Record<KeyRequired, number>>;
    food: Partial<Record<Food, number>>;
  };
  recent_ratings: PublicRating[];
}

export interface RatingInput {
  rating: number;
  cleanliness: Cleanliness;
  stall_privacy: StallPrivacy;
  key_required: KeyRequired;
  food: Food;
  restroom: Restroom;
  comment: string;
  visit_date: string;
}

export interface NewStopInput extends RatingInput {
  name: string;
  category: Category;
  address: string;
  lat: number;
  lng: number;
  confirm_distinct: boolean;
}

export interface NearbyStop {
  id: string;
  name: string;
  category: Category;
  address: string;
  lat: number;
  lng: number;
  status: string;
  distance_m: number;
}

export interface MyState {
  is_creator: boolean;
  rating: (Omit<RatingInput, 'comment'> & { id: string; comment: string | null; status: string }) | null;
  vote: 'agree' | 'disagree' | 'removed' | null;
}

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 0,
    public candidates?: NearbyStop[],
  ) {
    super(message);
  }
}

export interface WriteResult {
  /** True when the write was stored in the shared database. Demo writes are never shared. */
  shared: boolean;
}

export interface Api {
  readonly mode: 'demo' | 'live';
  stopsInBox(box: BBox, includeClosed?: boolean): Promise<StopSummary[]>;
  stopsInBoxes(boxes: BBox[]): Promise<StopSummary[]>;
  stopsNear(lat: number, lng: number, radiusM: number): Promise<NearbyStop[]>;
  stopDetail(id: string): Promise<StopDetail | null>;
  myState(stopId: string): Promise<MyState | null>;
  createStop(input: NewStopInput, challenge: string): Promise<WriteResult & { stopId: string }>;
  submitRating(stopId: string, input: RatingInput, challenge: string): Promise<WriteResult & { updated: boolean }>;
  setAgreement(stopId: string, vote: 'agree' | 'disagree' | 'none', challenge: string): Promise<WriteResult>;
  report(stopId: string, ratingId: string | null, reason: ReportReason, details: string, challenge: string): Promise<WriteResult>;
  /** Exact US street-address lookup through the backend (live mode only). */
  lookupAddress?(address: string): Promise<{ lat: number; lng: number; label: string; detail?: string }[]>;
}
