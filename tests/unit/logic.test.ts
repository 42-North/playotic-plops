import { describe, expect, it, vi } from 'vitest';
import { createLiveApi } from '../../src/api/live';
import { ApiError, type RatingInput, type StopSummary } from '../../src/api/types';
import { resolveConfig } from '../../src/config';
import { createDemoApi } from '../../src/demo/demoApi';
import { roundOne } from '../../src/demo/aggregate';
import { createDemoGeo } from '../../src/geo/demoGeo';
import { createOsmGeo } from '../../src/geo/osm';
import type { GeoProvider, Route } from '../../src/geo/provider';
import { corridorBoxes, haversineM, projectOntoRoute } from '../../src/lib/geo';
import { detourLabel, straightLine } from '../../src/lib/format';
import { calculateDetour, matchStopsToRoute } from '../../src/lib/routeStops';
import { applyFilters } from '../../src/services';

const today = new Date().toISOString().slice(0, 10);
const rating = (n: number, extra: Partial<RatingInput> = {}): RatingInput => ({
  rating: n, cleanliness: 'unknown', stall_privacy: 'unknown', key_required: 'unknown', food: 'unknown', restroom: 'unspecified', comment: '', visit_date: today, ...extra,
});

describe('configuration', () => {
  it('uses demo mode only when explicitly requested or when no backend is configured', () => {
    expect(resolveConfig({}).mode).toBe('demo');
    expect(resolveConfig({ VITE_DATA_MODE: 'demo', VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x' }).mode).toBe('demo');
  });
  it('never silently falls back to demo when live mode is requested', () => {
    const c = resolveConfig({ VITE_DATA_MODE: 'live' });
    expect(c.mode).toBe('live');
    expect(c.configError).toMatch(/VITE_SUPABASE_URL/);
  });
  it('accepts a complete live configuration and rejects secret keys in the browser', () => {
    const base = { VITE_DATA_MODE: 'live', VITE_SUPABASE_URL: 'https://abc.supabase.co', VITE_TURNSTILE_SITE_KEY: '0x4AAA' };
    const ok = resolveConfig({ ...base, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc' });
    expect(ok.configError).toBeNull();
    expect(ok.geoProvider).toBe('osm'); // free, keyless search and routing by default
    expect(resolveConfig({ ...base, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc', VITE_GEO_PROVIDER: 'geoapify' }).configError).toMatch(/GEOAPIFY_KEY/);
    expect(resolveConfig({ ...base, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_abc' }).configError).toMatch(/secret/);
    const jwt = `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify({ role: 'service_role' }))}.sig`;
    expect(resolveConfig({ ...base, VITE_SUPABASE_PUBLISHABLE_KEY: jwt }).configError).toMatch(/secret/);
  });
});

describe('geometry', () => {
  const line = [{ lat: 30, lng: -97 }, { lat: 31, lng: -97 }, { lat: 32, lng: -97 }];
  it('measures straight-line distance', () => {
    expect(haversineM({ lat: 30, lng: -97 }, { lat: 31, lng: -97 })).toBeCloseTo(111_195, -2);
  });
  it('projects points onto the route for along and off-route distance', () => {
    const p = projectOntoRoute({ lat: 31.5, lng: -96.99 }, line);
    expect(p.offRouteM).toBeGreaterThan(900);
    expect(p.offRouteM).toBeLessThan(1000);
    expect(p.alongM / 1000).toBeCloseTo(166.8, 0);
  });
  it('covers the whole route with bounded corridor boxes', () => {
    const long = Array.from({ length: 500 }, (_, i) => ({ lat: 25 + i * 0.04, lng: -100 + i * 0.03 }));
    const boxes = corridorBoxes(long, 3000);
    expect(boxes.length).toBeLessThanOrEqual(40);
    for (const p of long) expect(boxes.some((b) => p.lat >= b.south && p.lat <= b.north && p.lng >= b.west && p.lng <= b.east)).toBe(true);
  });
});

describe('route stops and detours', () => {
  const s = (id: string, lat: number, lng: number) => ({ id, lat, lng }) as StopSummary;
  const route: Route = { coords: [{ lat: 30, lng: -97 }, { lat: 32, lng: -97 }], distanceM: 222_000, durationS: 7200, source: 'routing' };

  it('keeps only stops inside the corridor, ordered along the route', () => {
    const out = matchStopsToRoute([s('far', 31, -96.8), s('b', 31.5, -97.005), s('a', 30.5, -97.001)], route, 3000);
    expect(out.map((x) => x.stop.id)).toEqual(['a', 'b']);
    expect(out.every((x) => x.detour.status === 'not_calculated')).toBe(true);
  });

  it('calculates added time by routing through the stop', async () => {
    const geo = { calculatesTravelTime: true, route: vi.fn(async () => ({ ...route, durationS: 7200 + 240 })) } as unknown as GeoProvider;
    const d = await calculateDetour(geo, route, route.coords[0], route.coords[1], { lat: 31, lng: -97 });
    expect(d).toEqual({ status: 'calculated', extraS: 240 });
    expect(detourLabel(240)).toBe('Adds 4 min');
  });

  it('never invents travel time for sample geometry or providers without times', async () => {
    const geo = { calculatesTravelTime: true, route: vi.fn() } as unknown as GeoProvider;
    const d = await calculateDetour(geo, { ...route, source: 'sample', durationS: null }, route.coords[0], route.coords[1], { lat: 31, lng: -97 });
    expect(d.status).toBe('not_calculated');
    expect(geo.route).not.toHaveBeenCalled();
    expect(straightLine(1609.344 * 2.4)).toBe('2.4 mi straight-line');
  });

  it('demo geography returns a sample line with no distance or time', async () => {
    const g = createDemoGeo();
    expect(g.calculatesTravelTime).toBe(false);
    const r = await g.route([{ lat: 32.7767, lng: -96.797 }, { lat: 30.2672, lng: -97.7431 }]);
    expect(r.source).toBe('sample');
    expect(r.durationS).toBeNull();
    expect(r.distanceM).toBeNull();
    await expect(g.route([{ lat: 29.76, lng: -95.37 }, { lat: 30.27, lng: -97.74 }])).rejects.toThrow(/sample line/);
  });
});

describe('demo backend mirrors the rating model', () => {
  const LONE_STAR = 'd0000000-0000-4000-8000-000000000001';
  const RED_OAK = 'd0000000-0000-4000-8000-000000000006';

  it('rounds like Postgres', () => {
    expect(roundOne(89, 20)).toBe(4.5);
    expect(roundOne(83, 18)).toBe(4.6);
  });

  it('reports crowd score excluding the original and null when there are no crowd ratings', async () => {
    const api = createDemoApi();
    const d = (await api.stopDetail(LONE_STAR))!;
    expect(d.original_rating).toBe(5);
    expect(d.crowd_avg).toBe(4.6);
    expect(d.crowd_count).toBe(18);
    expect([d.agree_count, d.disagree_count]).toEqual([21, 3]);
    const empty = (await api.stopDetail(RED_OAK))!;
    expect(empty.crowd_count).toBe(0);
    expect(empty.crowd_avg).toBeNull();
  });

  it('agreement votes do not move the crowd score; one editable rating per identity', async () => {
    const api = createDemoApi();
    await api.setAgreement(RED_OAK, 'disagree', 'x');
    let d = (await api.stopDetail(RED_OAK))!;
    expect(d.disagree_count).toBe(1);
    expect(d.crowd_avg).toBeNull();
    const w1 = await api.submitRating(RED_OAK, rating(2), 'x');
    const w2 = await api.submitRating(RED_OAK, rating(4), 'x');
    expect(w1.shared).toBe(false); // demo writes are never presented as shared
    expect(w2.updated).toBe(true);
    d = (await api.stopDetail(RED_OAK))!;
    expect(d.crowd_count).toBe(1);
    expect(d.crowd_avg).toBe(4);
    await api.setAgreement(RED_OAK, 'none', 'x');
    expect((await api.stopDetail(RED_OAK))!.disagree_count).toBe(0);
  });

  it('blocks rating your own original and warns about duplicates', async () => {
    const api = createDemoApi();
    const base = { ...rating(5), name: 'Brand New Fuel', category: 'gas_station' as const, address: '1 Test Rd', lat: 31.61, lng: -97.1052, confirm_distinct: false };
    await expect(api.createStop(base, 'x')).rejects.toMatchObject({ code: 'possible_duplicate' });
    await expect(api.createStop({ ...base, name: 'lone star travel stop', confirm_distinct: true }, 'x')).rejects.toMatchObject({ code: 'duplicate' });
    const { stopId } = await api.createStop({ ...base, confirm_distinct: true }, 'x');
    await expect(api.submitRating(stopId, rating(5), 'x')).rejects.toBeInstanceOf(ApiError);
    expect((await api.myState(stopId))!.is_creator).toBe(true);
  });

  it('filters use the latest reported criteria', async () => {
    const api = createDemoApi();
    const all = await api.stopsInBox({ south: 29, north: 33, west: -99, east: -96 });
    const keyless = all.filter((s) => applyFilters(s, { crowd4: false, fullDoors: false, noKey: true, food: false }));
    expect(keyless.map((s) => s.name)).not.toContain('Pecan Grove Gas & Go');
    const top = all.filter((s) => applyFilters(s, { crowd4: true, fullDoors: true, noKey: false, food: false }));
    expect(top.every((s) => (s.crowd_avg ?? 0) >= 4 && s.crowd_count > 0)).toBe(true);
    expect(top.map((s) => s.name)).not.toContain('Red Oak Rest Stop'); // no crowd ratings → not "4+"
  });
});

describe('live API client', () => {
  const cfg = { supabaseUrl: 'https://abc.supabase.co', supabaseKey: 'sb_publishable_abc' };

  it('reads through RPC with the publishable key only', async () => {
    const f = vi.fn(async (_u: RequestInfo | URL, _i?: RequestInit) => new Response(JSON.stringify([{ id: '1', crowd_avg: '4.6' }])));
    const api = createLiveApi(cfg, f as typeof fetch);
    const rows = await api.stopsInBox({ south: 30, north: 31, west: -98, east: -97 });
    expect(rows[0].crowd_avg).toBe(4.6);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://abc.supabase.co/rest/v1/rpc/stops_in_bbox');
    expect((init!.headers as Record<string, string>).apikey).toBe('sb_publishable_abc');
  });

  it('does not create an identity or call the server just to check "my state"', async () => {
    localStorage.clear();
    const f = vi.fn();
    const api = createLiveApi(cfg, f as unknown as typeof fetch);
    expect(await api.myState('x')).toBeNull();
    expect(f).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
  });

  it('surfaces server errors instead of substituting any data', async () => {
    const api = createLiveApi(cfg, (async () => new Response('oops', { status: 503 })) as typeof fetch);
    await expect(api.stopsInBox({ south: 30, north: 31, west: -98, east: -97 })).rejects.toBeInstanceOf(ApiError);
    const down = createLiveApi(cfg, (async () => { throw new TypeError('offline'); }) as typeof fetch);
    await expect(down.stopDetail('x')).rejects.toMatchObject({ code: 'network' });
  });

  it('sends a challenge and a browser token with writes, and reports them as shared', async () => {
    localStorage.clear();
    const f = vi.fn(async (_u: RequestInfo | URL, _i?: RequestInit) => new Response(JSON.stringify({ ok: true, updated: false })));
    const api = createLiveApi(cfg, f as typeof fetch);
    const r = await api.submitRating('stop-1', rating(4), 'turnstile-token');
    expect(r.shared).toBe(true);
    const body = JSON.parse(String(f.mock.calls[0][1]!.body));
    expect(body).toMatchObject({ action: 'rate', challenge: 'turnstile-token', stop_id: 'stop-1', rating: 4 });
    expect(body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(String(f.mock.calls[0][0])).toBe('https://abc.supabase.co/functions/v1/plops');
  });
});

describe('free OpenStreetMap provider', () => {
  it('geocodes via Nominatim on request, caches, and needs no key', async () => {
    const f = vi.fn(async (_u: RequestInfo | URL, _i?: RequestInit) => new Response(JSON.stringify([{ lat: '31.5493', lon: '-97.1467', display_name: 'Waco, McLennan County, Texas, United States' }])));
    const g = createOsmGeo(f as typeof fetch, 0);
    const r = await g.geocode('Waco');
    expect(r[0]).toMatchObject({ lat: 31.5493, lng: -97.1467, label: 'Waco, McLennan County' });
    await g.geocode('waco');
    expect(f).toHaveBeenCalledTimes(1); // cached
    const url = new URL(String(f.mock.calls[0][0]));
    expect(url.origin).toBe('https://nominatim.openstreetmap.org');
    expect(url.searchParams.get('countrycodes')).toBe('us');
    expect([...url.searchParams.keys()]).not.toContain('apiKey');
  });

  it('routes via the FOSSGIS OSRM server and returns real distance and duration', async () => {
    const f = vi.fn(async (_u: RequestInfo | URL) => new Response(JSON.stringify({ code: 'Ok', routes: [{ geometry: { coordinates: [[-97, 30], [-97, 31]] }, distance: 111_000, duration: 4000 }] })));
    const g = createOsmGeo(f as typeof fetch, 0);
    const route = await g.route([{ lat: 30, lng: -97 }, { lat: 31, lng: -97 }]);
    expect(route).toMatchObject({ distanceM: 111_000, durationS: 4000, source: 'routing' });
    expect(route.coords[1]).toEqual({ lat: 31, lng: -97 });
    expect(String(f.mock.calls[0][0])).toMatch(/^https:\/\/routing\.openstreetmap\.de\/routed-car\/route\/v1\/driving\/-97\.00000,30\.00000;-97\.00000,31\.00000\?/);
  });

  it('spaces requests at least ~1 second apart, as the free services require', async () => {
    const times: number[] = [];
    const f = vi.fn(async () => { times.push(Date.now()); return new Response('[]'); });
    const g = createOsmGeo(f as unknown as typeof fetch, 300);
    await Promise.all([g.geocode('aa'), g.geocode('bb'), g.geocode('cc')]);
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(290);
    expect(times[2] - times[1]).toBeGreaterThanOrEqual(290);
  });

  it('reports busy servers plainly', async () => {
    const g = createOsmGeo((async () => new Response('', { status: 429 })) as typeof fetch, 0);
    await expect(g.geocode('Waco')).rejects.toThrow(/busy/);
  });
});
