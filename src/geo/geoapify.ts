// Geoapify geocoding + routing (https://apidocs.geoapify.com). Calls go directly from the
// browser with an origin-restricted key. Results are cached in memory only (never persisted),
// so precise origins/destinations are not written to browser storage.
import type { LatLng } from '../lib/geo';
import { GeoError, type GeoProvider, type Place, type Route } from './provider';

const BASE = 'https://api.geoapify.com/v1';

class Lru<V> {
  private m = new Map<string, V>();
  constructor(private max: number) {}
  get(k: string) {
    const v = this.m.get(k);
    if (v !== undefined) {
      this.m.delete(k);
      this.m.set(k, v);
    }
    return v;
  }
  set(k: string, v: V) {
    this.m.set(k, v);
    if (this.m.size > this.max) this.m.delete(this.m.keys().next().value!);
  }
}

const r5 = (n: number) => n.toFixed(5);

export function createGeoapify(apiKey: string, fetchImpl: typeof fetch = (...a) => fetch(...a)): GeoProvider {
  const geoCache = new Lru<Place[]>(50);
  const routeCache = new Lru<Route>(40);
  // Free tier allows ~5 requests/second; space requests out a little.
  let last = 0;
  async function get(url: string) {
    const wait = Math.max(0, last + 250 - Date.now());
    last = Date.now() + wait;
    if (wait) await new Promise((r) => setTimeout(r, wait));
    let res: Response;
    try {
      res = await fetchImpl(url);
    } catch {
      throw new GeoError('network', 'Could not reach the map search service. Check your connection.');
    }
    if (res.status === 429) throw new GeoError('quota', 'The map search service is busy or over its daily quota. Try again later.');
    if (!res.ok) throw new GeoError('network', 'The map search service returned an error.');
    return res.json();
  }

  return {
    name: 'Geoapify',
    attribution: { text: 'Powered by Geoapify', href: 'https://www.geoapify.com/' },
    calculatesTravelTime: true,

    async geocode(query, near) {
      const q = query.trim();
      if (q.length < 2) return [];
      const key = `${q.toLowerCase()}|${near ? `${near.lat.toFixed(1)},${near.lng.toFixed(1)}` : ''}`;
      const hit = geoCache.get(key);
      if (hit) return hit;
      const p = new URLSearchParams({ text: q, format: 'json', limit: '5', filter: 'countrycode:us', apiKey });
      if (near) p.set('bias', `proximity:${near.lng},${near.lat}`);
      const out = await get(`${BASE}/geocode/search?${p}`);
      const places: Place[] = (out.results ?? []).map((r: any) => ({
        lat: r.lat, lng: r.lon,
        label: r.address_line1 ?? r.formatted,
        detail: r.address_line2 ?? undefined,
      }));
      geoCache.set(key, places);
      return places;
    },

    async reverse(pt) {
      const p = new URLSearchParams({ lat: r5(pt.lat), lon: r5(pt.lng), format: 'json', apiKey });
      const out = await get(`${BASE}/geocode/reverse?${p}`);
      return out.results?.[0]?.formatted ?? null;
    },

    async route(points: LatLng[]) {
      const wp = points.map((p) => `${r5(p.lat)},${r5(p.lng)}`).join('|');
      const hit = routeCache.get(wp);
      if (hit) return hit;
      const p = new URLSearchParams({ waypoints: wp, mode: 'drive', apiKey });
      const out = await get(`${BASE}/routing?${p}`);
      const f = out.features?.[0];
      if (!f) throw new GeoError('no_route', 'No driving route was found between those places.');
      const geom = f.geometry;
      const lines: number[][][] = geom.type === 'MultiLineString' ? geom.coordinates : [geom.coordinates];
      const coords: LatLng[] = [];
      for (const line of lines) for (const [lng, lat] of line) coords.push({ lat, lng });
      const route: Route = { coords, distanceM: f.properties.distance, durationS: f.properties.time, source: 'routing' };
      routeCache.set(wp, route);
      return route;
    },
  };
}
