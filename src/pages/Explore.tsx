import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { StopSummary } from '../api/types';
import { Icon, Mascot } from '../components/Art';
import { PlaceSearch, useGeolocation } from '../components/Forms';
import { Notice, Spinner } from '../components/Shell';
import { PinText, StopCard, pinAria } from '../components/StopBits';
import type { MapMarker } from '../components/MapView';
import { bboxAround, bboxCenter, corridorBoxes, haversineM, type BBox, type LatLng } from '../lib/geo';
import { detourLabel, miles, minutes, straightLine } from '../lib/format';
import { calculateDetour, matchStopsToRoute, MAX_AUTO_DETOURS, type RouteStop } from '../lib/routeStops';
import { applyFilters, useExplore, useServices, type ExploreState, type Filters } from '../services';
import { useMediaQuery } from '../lib/useMediaQuery';

const MapView = lazy(() => import('../components/MapView'));

const NEARBY_RADIUS_M = 40_000;
const US_BOX: BBox = { south: 24, north: 50, west: -125, east: -66 };

export default function Explore() {
  const [state, update] = useExplore();
  const { config } = useServices();
  const desktop = useMediaQuery('(min-width: 960px)');
  const showMap = desktop || state.display === 'map';

  return (
    <div className="explore" data-display={state.display}>
      <section className="explore-panel" aria-label="Search and results">
        <h1 className="explore-title">{state.mode === 'nearby' ? 'Find your next good plop.' : 'Plan your next pit stop.'}</h1>
        <div className="mode-tabs" role="group" aria-label="Search mode">
          <button type="button" aria-pressed={state.mode === 'nearby'} onClick={() => update((s) => ({ ...s, mode: 'nearby' }))}>Nearby</button>
          <button type="button" aria-pressed={state.mode === 'route'} onClick={() => update((s) => ({ ...s, mode: 'route' }))}>Along a route</button>
        </div>
        {state.mode === 'nearby' ? <NearbyControls /> : <RouteControls />}
        <FilterChips />
        {!desktop && (
          <div className="view-toggle" role="group" aria-label="View">
            <button type="button" aria-pressed={state.display === 'list'} onClick={() => update((s) => ({ ...s, display: 'list' }))}><Icon name="list" /> List</button>
            <button type="button" aria-pressed={state.display === 'map'} onClick={() => update((s) => ({ ...s, display: 'map' }))}><Icon name="map" /> Map</button>
          </div>
        )}
        {(desktop || state.display === 'list') && (state.mode === 'nearby' ? <NearbyResults /> : <RouteResults />)}
      </section>
      {showMap && (
        <section className="explore-map" aria-label="Map">
          <Suspense fallback={<div className="map-shell"><Spinner label="Loading map" /></div>}>
            <ExploreMap key={config.mode} desktop={desktop} />
          </Suspense>
        </section>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- Nearby */

function useNearbySearch() {
  const [, update] = useExplore();
  const { api } = useServices();
  return useCallback(
    async (area: BBox, origin: ExploreState['nearby']['origin'], view?: { center: LatLng; zoom: number }) => {
      update((s) => ({ ...s, nearby: { ...s.nearby, area, origin, view: view ?? s.nearby.view, loading: true, error: null } }));
      try {
        const results = await api.stopsInBox(area);
        update((s) => ({ ...s, nearby: { ...s.nearby, results, loading: false } }));
      } catch (e) {
        // Live mode never substitutes demo data on failure.
        const error = e instanceof Error ? e.message : 'Could not load stops.';
        update((s) => ({ ...s, nearby: { ...s.nearby, results: [], loading: false, error } }));
      }
    },
    [api, update],
  );
}

function NearbyControls() {
  const [state, update] = useExplore();
  const { config } = useServices();
  const run = useNearbySearch();
  const geo = useGeolocation();

  // First visit: show stops for the default area. No location is requested.
  useEffect(() => {
    if (state.nearby.results === null && state.nearby.area === null) {
      const area = config.mode === 'demo' ? bboxAround(config.defaultCenter, 80_000) : US_BOX;
      run(area, null, { center: config.defaultCenter, zoom: config.defaultZoom });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function useMyLocation() {
    const p = await geo.locate();
    if (!p) return;
    run(bboxAround(p, NEARBY_RADIUS_M), { ...p, kind: 'you', label: 'you' }, { center: p, zoom: 10 });
  }

  return (
    <div className="controls">
      <PlaceSearch
        label="City, address, or highway"
        placeholder="City, address, or highway"
        value={state.nearby.query}
        onText={(t) => update((s) => ({ ...s, nearby: { ...s.nearby, query: t } }))}
        onPick={(p) => {
          update((s) => ({ ...s, nearby: { ...s.nearby, query: p.label } }));
          run(bboxAround(p, NEARBY_RADIUS_M), { lat: p.lat, lng: p.lng, kind: 'place', label: p.label }, { center: p, zoom: 10 });
        }}
        actions={
          <button type="button" className="icon-btn locate-btn" onClick={useMyLocation} disabled={geo.busy} aria-label="Use my location" title="Use my location">
            <Icon name="locate" />
          </button>
        }
      />
      {geo.busy && <p className="muted small">Asking your browser for location…</p>}
      {geo.error && <Notice tone="warn">{geo.error}</Notice>}
    </div>
  );
}

function sortByOrigin(results: StopSummary[], ref: LatLng) {
  return results
    .map((s) => ({ s, d: haversineM(ref, s) }))
    .sort((a, b) => a.d - b.d);
}

function NearbyResults() {
  const [state] = useExplore();
  const { results, origin, area, loading, error } = state.nearby;
  if (results === null || (loading && results.length === 0)) return <Spinner label="Finding stops" />;
  const ref = origin ?? (area ? bboxCenter(area) : null);
  const visible = results.filter((s) => applyFilters(s, state.filters));
  const sorted = ref ? sortByOrigin(visible, ref) : visible.map((s) => ({ s, d: NaN }));
  const fromLabel = origin?.kind === 'you' ? 'you' : origin?.kind === 'place' ? origin.label : 'the map center';

  return (
    <div className="results" aria-busy={loading}>
      <div className="results-head">
        <h2>Good plops nearby</h2>
        <p className="muted small">
          {origin ? <>Sorted by straight-line distance from {fromLabel}. </> : <>Search a place or use your location to sort by distance. </>}
          Driving distance is not calculated here.
        </p>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {!error && sorted.length === 0 && <EmptyState filtered={results.length > 0} />}
      <ul className="card-list">
        {sorted.map(({ s, d }) => (
          <li key={s.id}>
            <StopCard s={s} distance={origin && Number.isFinite(d) ? straightLine(d) : undefined} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="empty">
      <Mascot size={64} mood="wink" />
      <h3>{filtered ? 'No stops match those filters' : 'No rated stops here yet'}</h3>
      <p>{filtered ? 'Try turning a filter off.' : 'Know a clean gas station, travel center or rest area around here? Be the first to rate it.'}</p>
      <Link className="btn btn-primary" to="/add"><Icon name="plus" /> Add a stop</Link>
    </div>
  );
}

/* ---------------------------------------------------------------- Filters */

function FilterChips() {
  const [state, update] = useExplore();
  const { geo } = useServices();
  const f = state.filters;
  const toggle = (k: keyof Filters) => update((s) => ({ ...s, filters: { ...s.filters, [k]: !s.filters[k] } }));
  const routeMode = state.mode === 'route';
  const canDetour = geo.calculatesTravelTime && state.route.route?.source === 'routing';
  return (
    <div className="filters" role="group" aria-label="Filters">
      <button type="button" className="chip" aria-pressed={f.crowd4} onClick={() => toggle('crowd4')}>4+ crowd score</button>
      <button type="button" className="chip" aria-pressed={f.fullDoors} onClick={() => toggle('fullDoors')} title="Latest visit reported full doors or a single-user room">Full doors</button>
      <button type="button" className="chip" aria-pressed={f.noKey} onClick={() => toggle('noKey')}>No key</button>
      <button type="button" className="chip" aria-pressed={f.food} onClick={() => toggle('food')}>Food</button>
      {routeMode && (
        <button type="button" className="chip" aria-pressed={state.route.under10} disabled={!canDetour}
          onClick={() => update((s) => ({ ...s, route: { ...s.route, under10: !s.route.under10 } }))}
          title={canDetour ? 'Only stops whose calculated detour is under 10 minutes' : 'Needs calculated driving times'}>
          Under 10 min extra
        </button>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- Route */

function RouteControls() {
  const [state, update] = useExplore();
  const { api, geo } = useServices();
  const r = state.route;
  const geoLoc = useGeolocation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setR = (patch: Partial<ExploreState['route']>) => update((s) => ({ ...s, route: { ...s.route, ...patch } }));

  async function find() {
    if (!r.from || !r.to) {
      setError('Choose both a starting point and a destination from the search results.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const route = await geo.route([r.from, r.to]);
      const corridorM = r.corridorMi * 1609.344;
      const found = await api.stopsInBoxes(corridorBoxes(route.coords, corridorM));
      const stops = matchStopsToRoute(found, route, corridorM);
      setR({ route, stops });
      if (route.source === 'routing' && geo.calculatesTravelTime) {
        const first = stops.slice(0, MAX_AUTO_DETOURS);
        for (const rs of first) await calcOne(rs, route);
      }
    } catch (ex) {
      setR({ route: null, stops: null });
      setError(ex instanceof Error ? ex.message : 'Could not plan that route.');
    } finally {
      setBusy(false);
    }
  }

  async function calcOne(rs: RouteStop, route = r.route!) {
    update((s) => ({ ...s, route: { ...s.route, stops: s.route.stops?.map((x) => (x.stop.id === rs.stop.id ? { ...x, detour: { status: 'pending' } } : x)) ?? null } }));
    const d = await calculateDetour(geo, route, r.from!, r.to!, rs.stop);
    update((s) => ({ ...s, route: { ...s.route, stops: s.route.stops?.map((x) => (x.stop.id === rs.stop.id ? { ...x, detour: d } : x)) ?? null } }));
  }
  routeCalc.current = calcOne;

  async function fromMyLocation() {
    const p = await geoLoc.locate();
    if (p) setR({ from: { ...p, label: 'My location' }, fromText: 'My location' });
  }

  return (
    <div className="controls route-form">
      <div className="route-fields">
        <div className="rf-dots" aria-hidden="true"><span /><i /><span /></div>
        <div className="rf-inputs">
          <PlaceSearch label="From" placeholder="From: city or address" value={r.fromText}
            onText={(t) => setR({ fromText: t, from: null })}
            onPick={(p) => setR({ from: p, fromText: p.label })}
            actions={<button type="button" className="icon-btn" onClick={fromMyLocation} aria-label="Start from my location" title="Start from my location"><Icon name="locate" /></button>} />
          <PlaceSearch label="To" placeholder="To: city or address" value={r.toText}
            onText={(t) => setR({ toText: t, to: null })}
            onPick={(p) => setR({ to: p, toText: p.label })} />
        </div>
        <button type="button" className="icon-btn swap-btn" aria-label="Swap start and destination"
          onClick={() => setR({ from: r.to, to: r.from, fromText: r.toText, toText: r.fromText, route: null, stops: null })}>
          <Icon name="swap" />
        </button>
      </div>
      <div className="route-opts">
        <label className="inline-field">
          <span>Within</span>
          <select value={r.corridorMi} onChange={(e) => setR({ corridorMi: Number(e.target.value) })}>
            <option value={1}>1 mi</option>
            <option value={2}>2 mi</option>
            <option value={5}>5 mi</option>
          </select>
          <span>of the route</span>
        </label>
        <button type="button" onClick={() => find()} className="btn btn-primary" disabled={busy}>{busy ? 'Planning…' : <><Icon name="route" /> Find stops</>}</button>
      </div>
      <p className="muted small">Your start and destination are sent to the routing service to draw the route. They are not saved by Playotic Plops.</p>
      {geoLoc.error && <Notice tone="warn">{geoLoc.error}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}

const routeCalc: { current: ((rs: RouteStop) => Promise<void>) | null } = { current: null };

function RouteResults() {
  const [state] = useExplore();
  const { geo } = useServices();
  const r = state.route;
  if (!r.route || !r.stops) {
    return (
      <div className="empty subtle">
        <Mascot size={56} />
        <p>Enter a start and destination to find rated stops along the way.</p>
      </div>
    );
  }
  const sample = r.route.source === 'sample';
  let list = r.stops.filter((x) => applyFilters(x.stop, state.filters));
  const unchecked = list.filter((x) => x.detour.status !== 'calculated').length;
  if (r.under10) list = list.filter((x) => x.detour.status === 'calculated' && x.detour.extraS < 600);

  return (
    <div className="results">
      <div className="route-summary">
        {sample ? (
          <Notice tone="warn"><strong>Sample route (demo).</strong> This line is hand-drawn along I-35. It is not a driving calculation, so no driving times or detours are shown. Distances are measured along the sample line.</Notice>
        ) : (
          <p>
            <strong>{miles(r.route.distanceM ?? 0)}</strong> · about <strong>{minutes(r.route.durationS ?? 0)}</strong> driving without stops.{' '}
            {geo.attribution && <a className="powered" href={geo.attribution.href} target="_blank" rel="noopener">{geo.attribution.text}</a>}
          </p>
        )}
      </div>
      <div className="results-head">
        <h2>{list.length ? 'Good plops ahead' : 'No stops match'}</h2>
        <p className="muted small">
          Within {r.corridorMi} mi (straight-line) of the route, in order along it.
          {!sample && ' Added time is calculated by routing through the stop.'}
        </p>
        {r.under10 && unchecked > 0 && <p className="muted small">{unchecked} stop{unchecked === 1 ? '' : 's'} hidden because the detour is not calculated yet. Turn off “Under 10 min extra” to see them.</p>}
      </div>
      {list.length === 0 && <EmptyState filtered={r.stops.length > 0} />}
      <ul className="card-list">
        {list.map((x) => (
          <li key={x.stop.id}>
            <StopCard s={x.stop} extra={<RouteLine x={x} sample={sample} />} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function RouteLine({ x, sample }: { x: RouteStop; sample: boolean }) {
  return (
    <div className="route-line">
      <span>{miles(x.aheadM)} ahead along {sample ? 'sample line' : 'route'}</span>
      <span>{miles(x.offRouteM)} off route (straight-line)</span>
      {x.detour.status === 'calculated' && <span className="detour ok">{detourLabel(x.detour.extraS)} (calculated)</span>}
      {x.detour.status === 'pending' && <span className="detour">Calculating detour…</span>}
      {x.detour.status === 'not_calculated' && (
        <span className="detour none">
          {x.detour.reason}
          {!sample && (
            <button type="button" className="link-btn" onClick={() => routeCalc.current?.(x)}>Calculate</button>
          )}
        </span>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- Map */

function ExploreMap({ desktop }: { desktop: boolean }) {
  const [state] = useExplore();
  const { config } = useServices();
  const run = useNearbySearch();
  const [selected, setSelected] = useState<string | null>(null);
  const [moved, setMoved] = useState<{ bounds: BBox; center: LatLng } | null>(null);
  const initial = useRef(state.nearby.view ?? { center: config.defaultCenter, zoom: config.defaultZoom });
  const routeMode = state.mode === 'route';

  const stops: StopSummary[] = useMemo(() => {
    const base = routeMode ? (state.route.stops ?? []).map((x) => x.stop) : (state.nearby.results ?? []);
    return base.filter((s) => applyFilters(s, state.filters));
  }, [routeMode, state.route.stops, state.nearby.results, state.filters]);

  const markers: MapMarker[] = useMemo(() => {
    const m: MapMarker[] = stops.map((s) => ({ id: s.id, lat: s.lat, lng: s.lng, ...PinText(s), ariaLabel: pinAria(s), selected: s.id === selected, kind: 'stop' }));
    const o = state.nearby.origin;
    if (!routeMode && o?.kind === 'you') m.push({ id: '__you', lat: o.lat, lng: o.lng, kind: 'you', ariaLabel: 'Your location' });
    if (routeMode && state.route.from) m.push({ id: '__from', ...state.route.from, kind: 'endpoint', ariaLabel: 'Start' });
    if (routeMode && state.route.to) m.push({ id: '__to', ...state.route.to, kind: 'endpoint', ariaLabel: 'Destination' });
    return m;
  }, [stops, selected, state.nearby.origin, routeMode, state.route.from, state.route.to]);

  const fit = useMemo(() => {
    if (routeMode && state.route.route) return { key: `route-${state.route.route.coords.length}-${state.route.from?.lat}`, points: [state.route.route.coords[0], state.route.route.coords[state.route.route.coords.length - 1]] };
    if (!routeMode && state.nearby.view) return { key: `view-${state.nearby.view.center.lat}-${state.nearby.view.center.lng}-${state.nearby.view.zoom}`, points: [state.nearby.view.center], zoom: state.nearby.view.zoom };
    return null;
  }, [routeMode, state.route.route, state.route.from, state.nearby.view]);

  const sel = stops.find((s) => s.id === selected) ?? null;
  const o = state.nearby.origin;

  return (
    <>
      <MapView
        center={initial.current.center}
        zoom={initial.current.zoom}
        markers={markers}
        route={routeMode ? state.route.route?.coords ?? null : null}
        fit={fit}
        label={routeMode ? 'Map of the route and stops along it' : 'Map of nearby stops'}
        onMarkerClick={(id) => !id.startsWith('__') && setSelected(id)}
        onMapClick={() => setSelected(null)}
        onMoveEnd={(bounds, center, _zoom, byUser) => { if (byUser) setMoved({ bounds, center }); }}
      />
      {!routeMode && moved && (
        <button type="button" className="btn search-area-btn" onClick={() => {
          const keepYou = o?.kind === 'you' && haversineM(o, moved.center) < 80_000 ? o : null;
          run(moved.bounds, keepYou ?? { ...moved.center, kind: 'map', label: 'the map center' });
          setMoved(null);
        }}>
          <Icon name="refresh" size={18} /> Search this area
        </button>
      )}
      {sel && (
        <div className="map-card">
          <button type="button" className="icon-btn map-card-close" aria-label="Close" onClick={() => setSelected(null)}><Icon name="close" /></button>
          <StopCard s={sel} distance={!routeMode && o ? straightLine(haversineM(o, sel)) : undefined} />
        </div>
      )}
      {!desktop && !sel && stops.length === 0 && !routeMode && state.nearby.results && (
        <div className="map-card"><EmptyState filtered={(state.nearby.results ?? []).length > 0} /></div>
      )}
    </>
  );
}
