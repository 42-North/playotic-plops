import type { LatLng } from '../lib/geo';

export interface Place extends LatLng {
  label: string;
  /** Second line, e.g. city and state. */
  detail?: string;
  /** Set when only the street or town matched, not the exact address. */
  approximate?: 'street' | 'town';
}

export interface Route {
  coords: LatLng[];
  /** Road distance in metres from the routing engine; null when the line is not a real route. */
  distanceM: number | null;
  /** Driving time in seconds from the routing engine; null when not calculated. */
  durationS: number | null;
  /** 'routing' = provider-calculated road route. 'sample' = hand-drawn demo line. */
  source: 'routing' | 'sample';
}

export interface GeoProvider {
  readonly name: string;
  readonly attribution: { text: string; href: string } | null;
  /** True when route() returns real driving times, so detours can be calculated. */
  readonly calculatesTravelTime: boolean;
  geocode(query: string, near?: LatLng): Promise<Place[]>;
  reverse(p: LatLng): Promise<string | null>;
  route(points: LatLng[]): Promise<Route>;
}

export class GeoError extends Error {
  constructor(public code: 'not_configured' | 'network' | 'no_route' | 'quota' | 'unsupported', message: string) {
    super(message);
  }
}
