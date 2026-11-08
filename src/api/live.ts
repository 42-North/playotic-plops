import type { AppConfig } from '../config';
import { clampBBox, type BBox } from '../lib/geo';
import { getOrCreateToken, peekToken } from '../lib/identity';
import { ApiError, type Api, type MyState, type NearbyStop, type StopDetail, type StopSummary } from './types';

type FetchLike = typeof fetch;

/** Talks to Supabase: public reads via PostgREST RPC (publishable key), writes via the `plops` Edge Function. */
export function createLiveApi(cfg: Pick<AppConfig, 'supabaseUrl' | 'supabaseKey'>, fetchImpl: FetchLike = (...a) => fetch(...a)): Api {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', apikey: cfg.supabaseKey };
  if (cfg.supabaseKey.startsWith('eyJ')) headers.Authorization = `Bearer ${cfg.supabaseKey}`; // legacy anon JWT

  async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    let res: Response;
    try {
      res = await fetchImpl(`${cfg.supabaseUrl}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(args) });
    } catch {
      throw new ApiError('network', 'Could not reach the Playotic Plops server. Check your connection and try again.');
    }
    if (!res.ok) throw new ApiError('server', 'The server could not load stops right now. Please try again.', res.status);
    return (await res.json()) as T;
  }

  async function write<T>(body: Record<string, unknown>): Promise<T> {
    let res: Response;
    try {
      res = await fetchImpl(`${cfg.supabaseUrl}/functions/v1/plops`, { method: 'POST', headers, body: JSON.stringify(body) });
    } catch {
      throw new ApiError('network', 'Could not reach the Playotic Plops server. Your submission was not saved.');
    }
    let out: any = null;
    try {
      out = await res.json();
    } catch {
      /* non-JSON error */
    }
    if (!res.ok || !out || out.ok === false) {
      throw new ApiError(out?.code ?? 'server', out?.message ?? 'Your submission was not saved. Please try again.', res.status, out?.candidates);
    }
    return out as T;
  }

  const num = (s: StopSummary): StopSummary => ({ ...s, crowd_avg: s.crowd_avg == null ? null : Number(s.crowd_avg) });

  return {
    mode: 'live',
    async stopsInBox(b: BBox, includeClosed = false) {
      const c = clampBBox(b);
      const rows = await rpc<StopSummary[]>('stops_in_bbox', {
        p_south: c.south, p_west: c.west, p_north: c.north, p_east: c.east, p_include_closed: includeClosed, p_limit: 200,
      });
      return rows.map(num);
    },
    async stopsInBoxes(boxes: BBox[]) {
      const rows = await rpc<StopSummary[]>('stops_in_boxes', { p_boxes: boxes.slice(0, 40).map((b) => [b.south, b.west, b.north, b.east]) });
      return rows.map(num);
    },
    stopsNear(lat, lng, radiusM) {
      return rpc<NearbyStop[]>('stops_near', { p_lat: lat, p_lng: lng, p_radius_m: Math.round(radiusM) });
    },
    async stopDetail(id) {
      const d = await rpc<StopDetail | null>('stop_detail', { p_stop_id: id });
      return d ? ({ ...num(d), ...d, crowd_avg: d.crowd_avg == null ? null : Number(d.crowd_avg) } as StopDetail) : null;
    },
    async myState(stopId) {
      const token = peekToken(); // never create an identity just to look
      if (!token) return null;
      const out = await write<{ state: MyState }>({ action: 'me', token, stop_id: stopId });
      return out.state;
    },
    async createStop(input, challenge) {
      const out = await write<{ stop_id: string }>({ action: 'create_stop', token: getOrCreateToken(), challenge, ...input });
      return { shared: true, stopId: out.stop_id };
    },
    async submitRating(stopId, input, challenge) {
      const out = await write<{ updated: boolean }>({ action: 'rate', token: getOrCreateToken(), challenge, stop_id: stopId, ...input });
      return { shared: true, updated: out.updated };
    },
    async setAgreement(stopId, vote, challenge) {
      await write({ action: 'vote', token: getOrCreateToken(), challenge, stop_id: stopId, vote });
      return { shared: true };
    },
    async report(stopId, ratingId, reason, details, challenge) {
      await write({ action: 'report', token: getOrCreateToken(), challenge, stop_id: stopId, rating_id: ratingId, reason, details });
      return { shared: true };
    },
  };
}
