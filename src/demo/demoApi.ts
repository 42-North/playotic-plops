// Demo mode backend: fictional fixtures in memory. Writes live only in this tab and are
// discarded on reload. Every write result reports `shared: false` so the UI can say so.
import { ApiError, type Api, type MyState, type NearbyStop, type StopSummary } from '../api/types';
import { haversineM, type BBox } from '../lib/geo';
import { detailOf, summarize, type RecRating, type RecStop, type RecVote } from './aggregate';
import { buildFixtures } from './fixtures';

const DEMO_ME = 'demo-visitor-this-tab';
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
const inBox = (b: BBox, lat: number, lng: number) => lat >= b.south && lat <= b.north && lng >= b.west && lng <= b.east;

export function createDemoApi(now = () => new Date()): Api {
  const db = buildFixtures(now());
  let seq = 0;
  const nextId = () => `d1000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
  const visible = () => db.stops.filter((s) => s.status !== 'hidden');
  const sum = (s: RecStop) => summarize(s, db.ratings, db.votes);
  const delay = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 120));

  function near(lat: number, lng: number, radiusM: number): NearbyStop[] {
    return visible()
      .map((s) => ({ id: s.id, name: s.name, category: s.category, address: s.address, lat: s.lat, lng: s.lng, status: s.status, distance_m: haversineM({ lat, lng }, s) }))
      .filter((s) => s.distance_m <= radiusM)
      .sort((a, b) => a.distance_m - b.distance_m);
  }

  function activeStop(id: string): RecStop {
    const s = db.stops.find((x) => x.id === id && x.status !== 'hidden');
    if (!s) throw new ApiError('not_found', 'That stop could not be found.', 404);
    if (s.status !== 'active') throw new ApiError('stop_closed', 'This stop is marked closed.', 409);
    return s;
  }

  return {
    mode: 'demo',
    async stopsInBox(b, includeClosed = false) {
      const c = { lat: (b.south + b.north) / 2, lng: (b.west + b.east) / 2 };
      return delay(
        visible()
          .filter((s) => (includeClosed || s.status === 'active') && inBox(b, s.lat, s.lng))
          .map(sum)
          .sort((x, y) => haversineM(c, x) - haversineM(c, y)),
      );
    },
    async stopsInBoxes(boxes) {
      return delay(visible().filter((s) => s.status === 'active' && boxes.some((b) => inBox(b, s.lat, s.lng))).map(sum));
    },
    async stopsNear(lat, lng, radiusM) {
      return delay(near(lat, lng, radiusM));
    },
    async stopDetail(id) {
      const s = visible().find((x) => x.id === id);
      return delay(s ? detailOf(s, db.ratings, db.votes) : null);
    },
    async myState(stopId): Promise<MyState> {
      const s = db.stops.find((x) => x.id === stopId);
      const r = db.ratings.find((x) => x.stop_id === stopId && x.who === DEMO_ME && !x.is_original);
      const v = db.votes.find((x) => x.stop_id === stopId && x.who === DEMO_ME);
      return delay({
        is_creator: s?.creator === DEMO_ME,
        rating: r ? { id: r.id, rating: r.rating, cleanliness: r.cleanliness, stall_privacy: r.stall_privacy, key_required: r.key_required, food: r.food, restroom: r.restroom, comment: r.comment, visit_date: r.visit_date, status: r.status } : null,
        vote: v ? (v.agrees ? 'agree' : 'disagree') : null,
      });
    },
    async createStop(input) {
      const dupes = near(input.lat, input.lng, 60).filter((n) => norm(n.name) === norm(input.name));
      if (dupes.length) throw new ApiError('duplicate', 'This stop already exists. Rate the existing stop instead.', 409, dupes);
      const close = near(input.lat, input.lng, 150);
      if (close.length && !input.confirm_distinct) {
        throw new ApiError('possible_duplicate', 'There are stops within 150 m. Confirm this is a different place, or rate the existing stop.', 409, close);
      }
      const id = nextId();
      const t = now().toISOString();
      db.stops.push({ id, name: input.name.trim(), category: input.category, address: input.address.trim(), lat: input.lat, lng: input.lng, status: 'active', creator: DEMO_ME, created_at: t });
      db.ratings.push(rec(id, true, input, t));
      return delay({ shared: false, stopId: id });
    },
    async submitRating(stopId, input) {
      const s = activeStop(stopId);
      if (s.creator === DEMO_ME) throw new ApiError('own_original', 'You submitted the original rating for this stop, so you cannot also add a crowd rating to it.', 409);
      const t = now().toISOString();
      const i = db.ratings.findIndex((x) => x.stop_id === stopId && x.who === DEMO_ME && !x.is_original);
      if (i >= 0) db.ratings[i] = { ...rec(stopId, false, input, t), id: db.ratings[i].id, created_at: db.ratings[i].created_at };
      else db.ratings.push(rec(stopId, false, input, t));
      return delay({ shared: false, updated: i >= 0 });
    },
    async setAgreement(stopId, vote) {
      const s = activeStop(stopId);
      if (s.creator === DEMO_ME) throw new ApiError('own_original', 'You cannot vote on your own original rating.', 409);
      db.votes = db.votes.filter((v) => !(v.stop_id === stopId && v.who === DEMO_ME));
      if (vote !== 'none') db.votes.push({ stop_id: stopId, who: DEMO_ME, agrees: vote === 'agree', status: 'visible' } satisfies RecVote);
      return delay({ shared: false });
    },
    async report() {
      return delay({ shared: false });
    },
  };

  function rec(stopId: string, isOriginal: boolean, input: Parameters<Api['submitRating']>[1], t: string): RecRating {
    const comment = input.comment.replace(/\s+/g, ' ').trim();
    return {
      id: nextId(), stop_id: stopId, who: DEMO_ME, is_original: isOriginal, rating: input.rating,
      cleanliness: input.cleanliness, stall_privacy: input.stall_privacy, key_required: input.key_required, food: input.food,
      restroom: input.restroom, comment: comment || null, visit_date: input.visit_date, created_at: t, updated_at: t, status: 'visible',
    };
  }
}

export type { StopSummary };
