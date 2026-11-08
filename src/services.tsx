import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { Api } from './api/types';
import type { AppConfig } from './config';
import type { GeoProvider } from './geo/provider';
import type { LatLng, BBox } from './lib/geo';
import type { RouteStop } from './lib/routeStops';
import type { Place, Route } from './geo/provider';
import type { StopSummary } from './api/types';

export interface Services {
  config: AppConfig;
  api: Api;
  geo: GeoProvider;
}

const Ctx = createContext<Services | null>(null);

export function ServicesProvider({ value, children }: { value: Services; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useServices(): Services {
  const v = useContext(Ctx);
  if (!v) throw new Error('ServicesProvider missing');
  return v;
}

/** Explore state lives in memory only, so returning from a stop restores the view. Never persisted. */
export interface Filters {
  crowd4: boolean;
  fullDoors: boolean;
  noKey: boolean;
  food: boolean;
}

export interface NearbyState {
  /** Reference point for sorting/distances, and what it is. */
  origin: (LatLng & { kind: 'you' | 'place' | 'map'; label: string }) | null;
  area: BBox | null;
  results: StopSummary[] | null;
  view: { center: LatLng; zoom: number } | null;
  query: string;
  loading: boolean;
  error: string | null;
}

export interface RouteState {
  from: Place | null;
  to: Place | null;
  fromText: string;
  toText: string;
  corridorMi: number;
  route: Route | null;
  stops: RouteStop[] | null;
  under10: boolean;
}

export interface ExploreState {
  mode: 'nearby' | 'route';
  display: 'map' | 'list';
  filters: Filters;
  nearby: NearbyState;
  route: RouteState;
}

const initialExplore: ExploreState = {
  mode: 'nearby',
  display: 'list',
  filters: { crowd4: false, fullDoors: false, noKey: false, food: false },
  nearby: { origin: null, area: null, results: null, view: null, query: '', loading: false, error: null },
  route: { from: null, to: null, fromText: '', toText: '', corridorMi: 2, route: null, stops: null, under10: false },
};

const ExploreCtx = createContext<[ExploreState, (fn: (s: ExploreState) => ExploreState) => void] | null>(null);

export function ExploreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(initialExplore);
  const value = useMemo(() => [state, (fn: (s: ExploreState) => ExploreState) => setState(fn)] as const, [state]);
  return <ExploreCtx.Provider value={value as any}>{children}</ExploreCtx.Provider>;
}

export function useExplore() {
  const v = useContext(ExploreCtx);
  if (!v) throw new Error('ExploreProvider missing');
  return v;
}

export function applyFilters(s: StopSummary, f: Filters): boolean {
  if (f.crowd4 && !(s.crowd_count > 0 && (s.crowd_avg ?? 0) >= 4)) return false;
  if (f.fullDoors && !(s.stall_privacy === 'full_doors' || s.stall_privacy === 'single_user')) return false;
  if (f.noKey && s.key_required !== 'no') return false;
  if (f.food && !(s.food === 'snacks' || s.food === 'hot_food')) return false;
  return true;
}
