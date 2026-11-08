import { DEMO_PLACES, SAMPLE_I35_LINE } from '../demo/fixtures';
import { haversineM, type LatLng } from '../lib/geo';
import { GeoError, type GeoProvider, type Place } from './provider';

/**
 * Demo geography: a small list of real city centres and one hand-drawn sample line.
 * It never produces travel times, so the UI never shows added driving time in demo mode.
 */
export function createDemoGeo(): GeoProvider {
  const line = SAMPLE_I35_LINE.map(([lat, lng]) => ({ lat, lng }));
  const nearestIdx = (p: LatLng) => {
    let best = 0, bestD = Infinity;
    line.forEach((q, i) => {
      const d = haversineM(p, q);
      if (d < bestD) { bestD = d; best = i; }
    });
    return { idx: best, d: bestD };
  };
  return {
    name: 'Demo places',
    attribution: null,
    calculatesTravelTime: false,
    async geocode(query) {
      const q = query.trim().toLowerCase();
      if (!q) return [];
      return DEMO_PLACES.filter((p) => p.name.toLowerCase().includes(q)).map<Place>((p) => ({ lat: p.lat, lng: p.lng, label: p.name, detail: 'Demo city list' }));
    },
    async reverse() {
      return null;
    },
    async route(points) {
      if (points.length !== 2) throw new GeoError('unsupported', 'Demo mode cannot calculate detours.');
      const a = nearestIdx(points[0]), b = nearestIdx(points[1]);
      if (a.d > 25_000 || b.d > 25_000 || a.idx === b.idx) {
        throw new GeoError('unsupported', 'Demo mode only has a sample line for the I-35 corridor between Dallas and Austin. Try “Dallas” to “Austin”.');
      }
      const seg = a.idx < b.idx ? line.slice(a.idx, b.idx + 1) : line.slice(b.idx, a.idx + 1).reverse();
      return { coords: seg, distanceM: null, durationS: null, source: 'sample' };
    },
  };
}
