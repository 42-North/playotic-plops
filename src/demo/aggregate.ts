// In-memory mirror of the database's aggregate rules, used only by demo mode.
// The production numbers are computed in Postgres (see the migration); tests check both.
import type { PublicRating, StopDetail, StopSummary } from '../api/types';
import type { Category } from '../lib/rating';

export interface RecStop {
  id: string;
  name: string;
  category: Category;
  address: string;
  lat: number;
  lng: number;
  status: 'active' | 'closed' | 'hidden';
  creator: string;
  created_at: string;
}

export interface RecRating extends PublicRating {
  stop_id: string;
  who: string;
  status: 'visible' | 'hidden';
}

export interface RecVote {
  stop_id: string;
  who: string;
  agrees: boolean;
  status: 'visible' | 'hidden';
}

const byLatest = (a: RecRating, b: RecRating) =>
  b.visit_date.localeCompare(a.visit_date) || b.updated_at.localeCompare(a.updated_at);

/** Round half away from zero to one decimal, like Postgres numeric round(x, 1). */
export function roundOne(sum: number, count: number): number {
  return Math.round((sum * 10) / count) / 10;
}

function latest<K extends 'cleanliness' | 'stall_privacy' | 'key_required' | 'food'>(rs: RecRating[], k: K) {
  const r = rs.filter((x) => x[k] !== 'unknown').sort(byLatest)[0];
  return r ? { value: r[k], date: r.visit_date } : { value: null, date: null };
}

export function summarize(stop: RecStop, allRatings: RecRating[], allVotes: RecVote[]): StopSummary {
  const rs = allRatings.filter((r) => r.stop_id === stop.id && r.status === 'visible');
  const original = rs.find((r) => r.is_original) ?? null;
  const crowd = rs.filter((r) => !r.is_original);
  const votes = original ? allVotes.filter((v) => v.stop_id === stop.id && v.status === 'visible') : [];
  const sum = crowd.reduce((a, r) => a + r.rating, 0);
  const c = latest(rs, 'cleanliness'), p = latest(rs, 'stall_privacy'), k = latest(rs, 'key_required'), f = latest(rs, 'food');
  return {
    id: stop.id, name: stop.name, category: stop.category, address: stop.address, lat: stop.lat, lng: stop.lng,
    status: stop.status === 'closed' ? 'closed' : 'active',
    created_at: stop.created_at,
    original_rating: original?.rating ?? null,
    original_visit_date: original?.visit_date ?? null,
    agree_count: votes.filter((v) => v.agrees).length,
    disagree_count: votes.filter((v) => !v.agrees).length,
    crowd_count: crowd.length,
    crowd_avg: crowd.length ? roundOne(sum, crowd.length) : null,
    last_visit_date: rs.map((r) => r.visit_date).sort().pop() ?? null,
    last_rated_at: rs.map((r) => r.updated_at).sort().pop() ?? null,
    cleanliness: c.value, cleanliness_visit_date: c.date,
    stall_privacy: p.value, stall_privacy_visit_date: p.date,
    key_required: k.value, key_required_visit_date: k.date,
    food: f.value, food_visit_date: f.date,
  } as StopSummary;
}

export function detailOf(stop: RecStop, allRatings: RecRating[], allVotes: RecVote[]): StopDetail {
  const rs = allRatings.filter((r) => r.stop_id === stop.id && r.status === 'visible');
  const tally = <K extends 'cleanliness' | 'stall_privacy' | 'key_required' | 'food'>(k: K) => {
    const out: Record<string, number> = {};
    for (const r of rs) if (r[k] !== 'unknown') out[r[k]] = (out[r[k]] ?? 0) + 1;
    return out;
  };
  return {
    ...summarize(stop, allRatings, allVotes),
    tallies: { cleanliness: tally('cleanliness'), stall_privacy: tally('stall_privacy'), key_required: tally('key_required'), food: tally('food') },
    recent_ratings: [...rs].sort(byLatest).slice(0, 25).map(({ stop_id: _s, who: _w, status: _st, ...pub }) => pub),
  };
}
