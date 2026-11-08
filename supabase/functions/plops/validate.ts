// Input validation for the plops Edge Function. Pure TypeScript (no Deno/Node APIs) so it
// can be unit-tested from Vitest and type-checked by Deno.

export const CATEGORIES = ['gas_station', 'travel_center', 'rest_area'] as const;
export const CLEANLINESS = ['dirty', 'okay', 'very_clean', 'unknown'] as const;
export const STALL_PRIVACY = ['gaps', 'full_doors', 'single_user', 'unknown'] as const;
export const KEY_REQUIRED = ['yes', 'no', 'unknown'] as const;
export const FOOD = ['none', 'snacks', 'hot_food', 'unknown'] as const;
export const RESTROOM = ['mens', 'womens', 'all_gender', 'unspecified'] as const;
export const REPORT_REASONS = ['fake_or_duplicate', 'closed_or_not_public', 'wrong_location', 'spam_or_abuse', 'personal_info', 'other'] as const;
export const VOTES = ['agree', 'disagree', 'none'] as const;

export const LIMITS = { name: 80, address: 200, comment: 280, details: 500 } as const;

export class ValidationError extends Error {
  field: string;
  constructor(field: string, message: string) {
    super(message);
    this.field = field;
  }
}

type Obj = Record<string, unknown>;

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Collapse whitespace and strip control characters. Returns null for blank input. */
export function cleanText(v: unknown, field: string, max: number, required = false, min = 1): string | null {
  if (v === undefined || v === null || v === '') {
    if (required) throw new ValidationError(field, `${field} is required.`);
    return null;
  }
  if (typeof v !== 'string') throw new ValidationError(field, `${field} must be text.`);
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim();
  if (!s) {
    if (required) throw new ValidationError(field, `${field} is required.`);
    return null;
  }
  if (s.length > max) throw new ValidationError(field, `${field} must be ${max} characters or fewer.`);
  if (s.length < min) throw new ValidationError(field, `${field} must be at least ${min} characters.`);
  return s;
}

function oneOf<T extends readonly string[]>(v: unknown, allowed: T, field: string, fallback?: T[number]): T[number] {
  if ((v === undefined || v === null) && fallback !== undefined) return fallback;
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
    throw new ValidationError(field, `${field} must be one of: ${allowed.join(', ')}.`);
  }
  return v as T[number];
}

export function token(v: unknown): string {
  if (typeof v !== 'string' || !TOKEN_RE.test(v)) throw new ValidationError('token', 'Missing or malformed browser token.');
  return v;
}

export function uuid(v: unknown, field: string): string {
  if (typeof v !== 'string' || !UUID_RE.test(v)) throw new ValidationError(field, `${field} must be an id.`);
  return v.toLowerCase();
}

function isoDay(d: Date) {
  return d.toISOString().slice(0, 10);
}

export function visitDate(v: unknown, now: Date = new Date()): string {
  if (typeof v !== 'string' || !DATE_RE.test(v)) throw new ValidationError('visit_date', 'Visit date must be YYYY-MM-DD.');
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || isoDay(d) !== v) throw new ValidationError('visit_date', 'Visit date is not a real date.');
  const max = new Date(now.getTime() + 864e5); // allow one day of timezone slack
  const min = new Date(now.getTime() - 730 * 864e5);
  if (d > max) throw new ValidationError('visit_date', 'Visit date cannot be in the future.');
  if (d < min) throw new ValidationError('visit_date', 'Visit date must be within the last two years.');
  return v;
}

export function plopRating(v: unknown): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 5) {
    throw new ValidationError('rating', 'Rating must be a whole number of plops from 1 to 5.');
  }
  return v;
}

export interface RatingFields {
  rating: number;
  cleanliness: string;
  stall_privacy: string;
  key_required: string;
  food: string;
  restroom: string;
  comment: string | null;
  visit_date: string;
}

export function ratingFields(b: Obj, now?: Date): RatingFields {
  return {
    rating: plopRating(b.rating),
    cleanliness: oneOf(b.cleanliness, CLEANLINESS, 'cleanliness', 'unknown'),
    stall_privacy: oneOf(b.stall_privacy, STALL_PRIVACY, 'stall_privacy', 'unknown'),
    key_required: oneOf(b.key_required, KEY_REQUIRED, 'key_required', 'unknown'),
    food: oneOf(b.food, FOOD, 'food', 'unknown'),
    restroom: oneOf(b.restroom, RESTROOM, 'restroom', 'unspecified'),
    comment: cleanText(b.comment, 'comment', LIMITS.comment),
    visit_date: visitDate(b.visit_date, now),
  };
}

export function stopFields(b: Obj) {
  const lat = b.lat, lng = b.lng;
  if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) throw new ValidationError('lat', 'Latitude is out of range.');
  if (typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180) throw new ValidationError('lng', 'Longitude is out of range.');
  return {
    name: cleanText(b.name, 'name', LIMITS.name, true, 2)!,
    category: oneOf(b.category, CATEGORIES, 'category'),
    address: cleanText(b.address, 'address', LIMITS.address, true, 3)!,
    lat,
    lng,
    confirm_distinct: b.confirm_distinct === true,
  };
}

export function voteValue(v: unknown) {
  return oneOf(v, VOTES, 'vote');
}

export function reportFields(b: Obj) {
  return {
    stop_id: uuid(b.stop_id, 'stop_id'),
    rating_id: b.rating_id == null ? null : uuid(b.rating_id, 'rating_id'),
    reason: oneOf(b.reason, REPORT_REASONS, 'reason'),
    details: cleanText(b.details, 'details', LIMITS.details),
  };
}
