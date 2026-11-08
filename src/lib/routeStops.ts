import type { StopSummary } from '../api/types';
import type { GeoProvider, Route } from '../geo/provider';
import { cumulativeDistances, projectOntoRoute, thin, type LatLng } from './geo';

export type Detour =
  | { status: 'calculated'; extraS: number }
  | { status: 'pending' }
  | { status: 'not_calculated'; reason: string };

export interface RouteStop {
  stop: StopSummary;
  /** Straight-line distance from the stop to the nearest point of the route line. */
  offRouteM: number;
  /** Distance along the route line from the start to the stop's nearest point. */
  aheadM: number;
  detour: Detour;
}

/** Keep stops within `corridorM` of the route geometry, ordered by distance ahead. */
export function matchStopsToRoute(stops: StopSummary[], route: Route, corridorM: number): RouteStop[] {
  const line = thin(route.coords, 3000);
  const cum = cumulativeDistances(line);
  const reason = route.source === 'sample' ? 'Sample route: driving time not calculated' : 'Detour not calculated yet';
  return stops
    .map((stop) => {
      const p = projectOntoRoute(stop, line, cum);
      return { stop, offRouteM: p.offRouteM, aheadM: p.alongM, detour: { status: 'not_calculated', reason } as Detour };
    })
    .filter((s) => s.offRouteM <= corridorM)
    .sort((a, b) => a.aheadM - b.aheadM);
}

/**
 * Real added driving time: duration(origin → stop → destination) − duration(origin → destination).
 * Only possible when the provider returns travel times. Bounded to `max` routing calls.
 */
export async function calculateDetour(geo: GeoProvider, base: Route, origin: LatLng, dest: LatLng, stop: LatLng): Promise<Detour> {
  if (!geo.calculatesTravelTime || base.durationS == null || base.source !== 'routing') {
    return { status: 'not_calculated', reason: 'Driving time not available' };
  }
  try {
    const via = await geo.route([origin, { lat: stop.lat, lng: stop.lng }, dest]);
    if (via.durationS == null) return { status: 'not_calculated', reason: 'Driving time not available' };
    return { status: 'calculated', extraS: Math.max(0, via.durationS - base.durationS) };
  } catch {
    return { status: 'not_calculated', reason: 'Detour could not be calculated' };
  }
}

/** Free routing servers ask for under 1 request/second, so only a few detours are checked automatically. */
export const MAX_AUTO_DETOURS = 3;
