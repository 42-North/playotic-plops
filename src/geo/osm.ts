// Free, keyless OpenStreetMap services:
//   - Address search: Nominatim public instance (nominatim.openstreetmap.org)
//   - Driving routes: FOSSGIS OSRM server (routing.openstreetmap.de)
// Both are community-run with no fees, no keys and no SLA. Their policies require
// under 1 request per second, no autocomplete, identification (browser Referer) and attribution.
// So: searches run only on submit, results are cached in memory, and requests are spaced out.
// Nothing is written to browser storage.
import { looksLikeStreetAddress, parseUsAddress, stripUnit } from '../lib/address';
import type { LatLng } from '../lib/geo';
import { GeoError, type GeoProvider, type Place, type Route } from './provider';

export const NOMINATIM = 'https://nominatim.openstreetmap.org';
export const FOSSGIS_ROUTING = 'https://routing.openstreetmap.de/routed-car';

const r5 = (n: number) => n.toFixed(5);

/** Optional exact-address lookup (US Census geocoder, via the Playotic Plops backend). */
export type AddressLookup = (address: string) => Promise<Place[]>;

export function createOsmGeo(fetchImpl: typeof fetch = (...a) => fetch(...a), minGapMs = 1100, addressLookup?: AddressLookup): GeoProvider {
  const geoCache = new Map<string, Place[]>();
  const routeCache = new Map<string, Route>();
  let queue: Promise<unknown> = Promise.resolve();
  let last = 0;

  /** Serialize all requests and keep at least `minGapMs` between them. */
  function throttled<T>(fn: () => Promise<T>): Promise<T> {
    const run = queue.then(async () => {
      const wait = Math.max(0, last + minGapMs - Date.now());
      if (wait) await new Promise((r) => setTimeout(r, wait));
      last = Date.now();
      return fn();
    });
    queue = run.catch(() => {});
    return run;
  }

  async function getJson(url: string): Promise<any> {
    return throttled(async () => {
      let res: Response;
      try {
        res = await fetchImpl(url, { headers: { Accept: 'application/json' } });
      } catch {
        throw new GeoError('network', 'Could not reach the free OpenStreetMap service. Check your connection and try again.');
      }
      if (res.status === 429 || res.status === 503) {
        throw new GeoError('quota', 'The free OpenStreetMap service is busy right now. Wait a moment and try again.');
      }
      if (!res.ok) throw new GeoError('network', 'The OpenStreetMap service returned an error.');
      return res.json();
    });
  }

  function remember<V>(m: Map<string, V>, k: string, v: V) {
    m.set(k, v);
    if (m.size > 60) m.delete(m.keys().next().value!);
  }

  return {
    name: 'OpenStreetMap',
    attribution: { text: 'Search: Nominatim · Routes: OSRM/FOSSGIS · © OpenStreetMap contributors', href: 'https://www.openstreetmap.org/copyright' },
    calculatesTravelTime: true,

    async geocode(query, near) {
      const q = query.trim();
      if (q.length < 2) return [];
      const key = q.toLowerCase();
      const hit = geoCache.get(key);
      if (hit) return hit;

      const viewbox = near ? `${near.lng - 1.5},${near.lat + 1.5},${near.lng + 1.5},${near.lat - 1.5}` : undefined; // a hint, not a filter
      const search = async (params: Record<string, string>, approximate?: Place['approximate']) => {
        const p = new URLSearchParams({ ...params, format: 'jsonv2', limit: '5', countrycodes: 'us' });
        if (viewbox) p.set('viewbox', viewbox);
        const out = await getJson(`${NOMINATIM}/search?${p}`);
        return (Array.isArray(out) ? out : []).map((r: any): Place => {
          const parts = String(r.display_name ?? '').split(', ');
          return { lat: Number(r.lat), lng: Number(r.lon), label: parts.slice(0, 2).join(', '), detail: parts.slice(2, 5).join(', ') || undefined, approximate };
        });
      };

      const stripped = stripUnit(q);
      const parsed = parseUsAddress(stripped);
      let places: Place[] = [];

      // 1. Exact US street addresses: the Census geocoder knows nearly every address range.
      if (addressLookup && looksLikeStreetAddress(stripped)) {
        places = await addressLookup(stripped).catch(() => []);
      }
      // 2. OpenStreetMap, as typed, then without suite/unit numbers.
      if (!places.length) places = await search({ q });
      if (!places.length && stripped !== q) places = await search({ q: stripped });
      // 3. Structured search with the parts named.
      if (!places.length && parsed?.street && (parsed.city || parsed.postcode)) {
        const sp: Record<string, string> = { street: [parsed.houseNumber, parsed.street].filter(Boolean).join(' ') };
        if (parsed.city) sp.city = parsed.city;
        if (parsed.state) sp.state = parsed.state;
        if (parsed.postcode) sp.postalcode = parsed.postcode;
        places = await search(sp);
      }
      // 4. Fall back to the street, then the town: close enough to drag the pin into place.
      if (!places.length && parsed?.houseNumber && parsed.street && parsed.city) {
        places = await search({ q: [parsed.street, parsed.city, parsed.state].filter(Boolean).join(', ') }, 'street');
      }
      if (!places.length && parsed && (parsed.city || parsed.postcode)) {
        places = await search({ q: [parsed.city, parsed.state, parsed.postcode].filter(Boolean).join(', ') }, 'town');
      }
      remember(geoCache, key, places);
      return places;
    },

    async reverse(pt) {
      const p = new URLSearchParams({ lat: r5(pt.lat), lon: r5(pt.lng), format: 'jsonv2', zoom: '18' });
      const out = await getJson(`${NOMINATIM}/reverse?${p}`);
      return typeof out?.display_name === 'string' ? out.display_name.split(', ').slice(0, 4).join(', ') : null;
    },

    async route(points: LatLng[]) {
      const coords = points.map((p) => `${r5(p.lng)},${r5(p.lat)}`).join(';');
      const hit = routeCache.get(coords);
      if (hit) return hit;
      const out = await getJson(`${FOSSGIS_ROUTING}/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false`);
      const r = out?.routes?.[0];
      if (out?.code !== 'Ok' || !r) throw new GeoError('no_route', 'No driving route was found between those places.');
      const route: Route = {
        coords: (r.geometry?.coordinates ?? []).map(([lng, lat]: [number, number]) => ({ lat, lng })),
        distanceM: r.distance,
        durationS: r.duration,
        source: 'routing',
      };
      remember(routeCache, coords, route);
      return route;
    },
  };
}
