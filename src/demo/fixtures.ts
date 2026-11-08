// FICTIONAL demo data. Names, addresses, ratings and comments are invented for demo mode.
// Positions sit near real Texas towns along I-35 only so the sample route has something to find.
import type { Cleanliness, Food, KeyRequired, StallPrivacy } from '../lib/rating';
import type { RecRating, RecStop, RecVote } from './aggregate';

type C = { c?: Cleanliness; p?: StallPrivacy; k?: KeyRequired; f?: Food };

interface FixtureStop {
  stop: Omit<RecStop, 'creator' | 'created_at'>;
  original: { rating: number; daysAgo: number; comment?: string } & C;
  /** Crowd ratings: [plops, daysAgo, criteria?, comment?] */
  crowd: [number, number, C?, string?][];
  votes: [agree: number, disagree: number];
}

const S = (id: string, name: string, category: RecStop['category'], address: string, lat: number, lng: number) =>
  ({ id, name, category, address, lat, lng, status: 'active' as const });

const many = (n: number, plops: number, startDay: number, c: C = {}): [number, number, C][] =>
  Array.from({ length: n }, (_, i) => [plops, startDay + i * 3, c]);

const FIXTURES: FixtureStop[] = [
  {
    stop: S('d0000000-0000-4000-8000-000000000001', 'Lone Star Travel Stop', 'travel_center', '123 Example Rd, Waco, TX (fictional)', 31.61, -97.105),
    original: { rating: 5, daysAgo: 60, c: 'very_clean', p: 'full_doors', k: 'no', f: 'hot_food', comment: 'Spotless. Full-height stall doors. Kolaches by the register.' },
    crowd: [
      [5, 2, { c: 'very_clean', p: 'full_doors', k: 'no', f: 'hot_food' }, 'A solid 5-plopper. Clean stalls and proper doors.'],
      [4, 5, { c: 'okay', p: 'full_doors' }, 'Busy at lunch, still decent.'],
      ...many(10, 5, 8, { c: 'very_clean' }),
      ...many(6, 4, 11),
    ],
    votes: [21, 3],
  },
  {
    stop: S('d0000000-0000-4000-8000-000000000002', 'Quickway Fuel', 'gas_station', '45 Sample Ave, Waco, TX (fictional)', 31.52, -97.17),
    original: { rating: 3, daysAgo: 40, c: 'okay', p: 'gaps', k: 'no', f: 'snacks' },
    crowd: [[3, 4, { c: 'okay', p: 'gaps' }, 'Fine. Nothing special.'], [4, 12], [2, 20, { c: 'dirty' }, 'Out of paper towels.'], [3, 33]],
    votes: [6, 2],
  },
  {
    stop: S('d0000000-0000-4000-8000-000000000003', 'Bluebonnet Rest Area', 'rest_area', 'I-35 southbound, mile 315 (fictional)', 31.33, -97.255),
    original: { rating: 4, daysAgo: 90, c: 'very_clean', p: 'full_doors', k: 'no', f: 'none' },
    crowd: [[5, 1, { c: 'very_clean', p: 'full_doors' }, 'Recently renovated. Picnic tables too.'], [5, 9], [5, 14], [4, 18], [4, 25], [4, 30], [4, 41], [4, 52], [3, 70, { c: 'okay' }]],
    votes: [9, 1],
  },
  {
    stop: S('d0000000-0000-4000-8000-000000000004', 'Pecan Grove Gas & Go', 'gas_station', '9 Placeholder St, Temple, TX (fictional)', 31.09, -97.36),
    original: { rating: 2, daysAgo: 21, c: 'dirty', p: 'gaps', k: 'yes', f: 'snacks', comment: 'Had to ask for the key at the counter.' },
    crowd: [[2, 6, { c: 'dirty', k: 'yes' }], [3, 15, { c: 'okay' }]],
    votes: [3, 0],
  },
  {
    stop: S('d0000000-0000-4000-8000-000000000005', 'Armadillo Junction Travel Plaza', 'travel_center', '700 Demo Pkwy, Salado, TX (fictional)', 30.945, -97.53),
    original: { rating: 4, daysAgo: 120, c: 'very_clean', p: 'full_doors', k: 'no', f: 'hot_food' },
    crowd: [[5, 3, { c: 'very_clean', p: 'full_doors', k: 'no', f: 'hot_food' }, 'Huge, clean, and the brisket counter is open late.'], ...many(13, 5, 7), ...many(20, 4, 9)],
    votes: [14, 5],
  },
  {
    stop: S('d0000000-0000-4000-8000-000000000006', 'Red Oak Rest Stop', 'rest_area', 'I-35 northbound, mile 262 (fictional)', 30.65, -97.68),
    original: { rating: 4, daysAgo: 3, c: 'very_clean', p: 'single_user', k: 'no', f: 'none', comment: 'Family rooms with locking doors.' },
    crowd: [],
    votes: [0, 0],
  },
  {
    stop: S('d0000000-0000-4000-8000-000000000007', 'Hillside Corner Store', 'gas_station', '2 Sample Loop, Hillsboro, TX (fictional)', 32.01, -97.13),
    original: { rating: 1, daysAgo: 30, c: 'dirty', p: 'gaps', k: 'yes', f: 'snacks' },
    crowd: [[2, 8, { c: 'dirty' }], [2, 16], [1, 26, { k: 'yes' }, 'Door would not lock.']],
    votes: [4, 1],
  },
  {
    stop: S('d0000000-0000-4000-8000-000000000008', 'Prairie Wind Fuel Center', 'travel_center', '1 Example Hwy, Waxahachie, TX (fictional)', 32.41, -96.84),
    original: { rating: 5, daysAgo: 75, c: 'very_clean', p: 'full_doors', k: 'no', f: 'hot_food' },
    crowd: [[5, 2, { c: 'very_clean', p: 'full_doors' }], ...many(9, 5, 6), [4, 40], [4, 55]],
    votes: [10, 0],
  },
  {
    stop: S('d0000000-0000-4000-8000-000000000009', 'Bosque Bend Gas', 'gas_station', '88 Fictional Rd, Waco, TX (fictional)', 31.65, -97.26),
    original: { rating: 3, daysAgo: 50, c: 'okay', p: 'gaps', f: 'snacks' },
    crowd: [[4, 10, { c: 'okay', p: 'full_doors' }], [4, 17], [3, 24], [3, 31], [3, 38]],
    votes: [2, 2],
  },
];

const isoDay = (daysAgo: number, now: Date) => new Date(now.getTime() - daysAgo * 864e5).toISOString().slice(0, 10);
const isoTime = (daysAgo: number, now: Date) => new Date(now.getTime() - daysAgo * 864e5 + 3_600_000).toISOString();

export function buildFixtures(now = new Date()) {
  const stops: RecStop[] = [];
  const ratings: RecRating[] = [];
  const votes: RecVote[] = [];
  for (const fx of FIXTURES) {
    const creator = `fixture-creator-${fx.stop.id}`;
    stops.push({ ...fx.stop, creator, created_at: isoTime(fx.original.daysAgo, now) });
    const mk = (i: number, who: string, isOriginal: boolean, plops: number, days: number, c: C = {}, comment?: string): RecRating => ({
      id: `${fx.stop.id.slice(0, 24)}${String(i).padStart(12, '0')}`,
      stop_id: fx.stop.id, who, is_original: isOriginal, rating: plops,
      cleanliness: c.c ?? 'unknown', stall_privacy: c.p ?? 'unknown', key_required: c.k ?? 'unknown', food: c.f ?? 'unknown',
      restroom: 'unspecified', comment: comment ?? null,
      visit_date: isoDay(days, now), created_at: isoTime(days, now), updated_at: isoTime(days, now), status: 'visible',
    });
    const o = fx.original;
    ratings.push(mk(0, creator, true, o.rating, o.daysAgo, o, o.comment));
    fx.crowd.forEach(([plops, days, c, comment], i) => ratings.push(mk(i + 1, `fixture-rater-${fx.stop.id}-${i}`, false, plops, days, c, comment)));
    for (let i = 0; i < fx.votes[0] + fx.votes[1]; i++) {
      votes.push({ stop_id: fx.stop.id, who: `fixture-voter-${i}`, agrees: i < fx.votes[0], status: 'visible' });
    }
  }
  return { stops, ratings, votes };
}

/** Real city centres (public geographic facts) used by demo search and the sample route. */
export const DEMO_PLACES = [
  { name: 'Dallas, TX', lat: 32.7767, lng: -96.797 },
  { name: 'Waxahachie, TX', lat: 32.3866, lng: -96.8483 },
  { name: 'Hillsboro, TX', lat: 32.0110, lng: -97.1300 },
  { name: 'Waco, TX', lat: 31.5493, lng: -97.1467 },
  { name: 'Temple, TX', lat: 31.0982, lng: -97.3428 },
  { name: 'Salado, TX', lat: 30.9471, lng: -97.5386 },
  { name: 'Georgetown, TX', lat: 30.6333, lng: -97.6770 },
  { name: 'Round Rock, TX', lat: 30.5083, lng: -97.6789 },
  { name: 'Austin, TX', lat: 30.2672, lng: -97.7431 },
  { name: 'Fort Worth, TX', lat: 32.7555, lng: -97.3308 },
  { name: 'Houston, TX', lat: 29.7604, lng: -95.3698 },
  { name: 'San Antonio, TX', lat: 29.4241, lng: -98.4936 },
];

/** Hand-drawn sample line roughly following I-35E/I-35 from Dallas to Austin. NOT a routing result. */
export const SAMPLE_I35_LINE: [number, number][] = [
  [32.7767, -96.797], [32.70, -96.82], [32.60, -96.86], [32.47, -96.87], [32.3866, -96.8483], [32.25, -96.93],
  [32.10, -97.05], [32.011, -97.12], [31.85, -97.10], [31.70, -97.11], [31.60, -97.12], [31.5493, -97.14],
  [31.45, -97.19], [31.33, -97.26], [31.20, -97.33], [31.0982, -97.35], [31.03, -97.43], [30.9471, -97.53],
  [30.80, -97.61], [30.6333, -97.68], [30.5083, -97.68], [30.40, -97.69], [30.30, -97.72], [30.2672, -97.7431],
];
