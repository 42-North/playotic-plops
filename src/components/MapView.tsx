import { useEffect, useRef, useState } from 'react';
import type { Map as MlMap, Marker as MlMarker, GeoJSONSource } from 'maplibre-gl';
import { useServices } from '../services';
import type { BBox, LatLng } from '../lib/geo';
import { loadMapStyle } from '../lib/mapStyle';

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  /** Text inside the pin, e.g. "4.6". */
  text?: string;
  tone?: 'great' | 'good' | 'meh' | 'none';
  ariaLabel: string;
  selected?: boolean;
  kind?: 'stop' | 'you' | 'endpoint';
}

export interface MapViewProps {
  center: LatLng;
  zoom: number;
  markers?: MapMarker[];
  route?: LatLng[] | null;
  /** Change `key` to fit the map to `points`. */
  fit?: { key: string; points: LatLng[]; zoom?: number } | null;
  onMarkerClick?: (id: string) => void;
  onMoveEnd?: (bounds: BBox, center: LatLng, zoom: number, byUser: boolean) => void;
  onMapClick?: (p: LatLng) => void;
  draggablePin?: { lat: number; lng: number; onMove: (p: LatLng) => void } | null;
  interactive?: boolean;
  label: string;
  className?: string;
}

/** MapLibre map, loaded lazily so the list view and tests do not need WebGL. */
export default function MapView(props: MapViewProps) {
  const { config } = useServices();
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const lib = useRef<typeof import('maplibre-gl') | null>(null);
  const markers = useRef(new Map<string, { m: MlMarker; el: HTMLButtonElement }>());
  const pin = useRef<MlMarker | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const [ready, setReady] = useState(false);
  const [tilesOk, setTilesOk] = useState(true);
  const [failed, setFailed] = useState(false);
  const programmatic = useRef(false);

  useEffect(() => {
    let disposed = false;
    (async () => {
      try {
        const [ml] = await Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl.css')]);
        const { style, ok } = await loadMapStyle(config.mapStyleUrl, config.recolorMap);
        if (disposed || !el.current) return;
        lib.current = ml;
        setTilesOk(ok);
        const m = new ml.Map({
          container: el.current,
          style,
          center: [props.center.lng, props.center.lat],
          zoom: props.zoom,
          attributionControl: false,
          interactive: props.interactive !== false,
          dragRotate: false,
          pitchWithRotate: false,
        });
        m.touchZoomRotate.disableRotation();
        m.addControl(
          new ml.AttributionControl({
            compact: true,
            customAttribution: config.mode === 'live' ? '<a href="https://www.geoapify.com/" target="_blank" rel="noopener">Search &amp; routes: Geoapify</a>' : undefined,
          }),
          'bottom-right',
        );
        if (props.interactive !== false) m.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right');
        m.on('load', () => {
          m.addSource('route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
          m.addLayer({ id: 'route-casing', type: 'line', source: 'route', paint: { 'line-color': '#1d120f', 'line-width': 9 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
          m.addLayer({ id: 'route-line', type: 'line', source: 'route', paint: { 'line-color': '#f2b65a', 'line-width': 5 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
          setReady(true);
        });
        m.on('moveend', (e) => {
          const b = m.getBounds();
          const c = m.getCenter();
          // Only gestures carry an originalEvent; fitBounds/jumpTo do not.
          const byUser = !programmatic.current && !!(e as { originalEvent?: unknown }).originalEvent;
          programmatic.current = false;
          propsRef.current.onMoveEnd?.({ south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() }, { lat: c.lat, lng: c.lng }, m.getZoom(), byUser);
        });
        m.on('click', (e) => propsRef.current.onMapClick?.({ lat: e.lngLat.lat, lng: e.lngLat.lng }));
        map.current = m;
      } catch {
        if (!disposed) setFailed(true);
      }
    })();
    return () => {
      disposed = true;
      map.current?.remove();
      map.current = null;
      markers.current.clear();
      pin.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Markers
  useEffect(() => {
    const m = map.current, ml = lib.current;
    if (!m || !ml || !ready) return;
    const want = new Map((props.markers ?? []).map((k) => [k.id, k]));
    for (const [id, rec] of markers.current) {
      if (!want.has(id)) {
        rec.m.remove();
        markers.current.delete(id);
      }
    }
    for (const mk of want.values()) {
      let rec = markers.current.get(mk.id);
      if (!rec) {
        // MapLibre owns the wrapper's classes and transform; our pin is a button inside it.
        const wrap = document.createElement('div');
        const b = document.createElement('button');
        b.type = 'button';
        b.addEventListener('click', (ev) => {
          ev.stopPropagation();
          propsRef.current.onMarkerClick?.(mk.id);
        });
        wrap.appendChild(b);
        const marker = new ml.Marker({ element: wrap, anchor: mk.kind === 'stop' || !mk.kind ? 'bottom' : 'center' }).setLngLat([mk.lng, mk.lat]).addTo(m);
        rec = { m: marker, el: b };
        markers.current.set(mk.id, rec);
      }
      rec.m.setLngLat([mk.lng, mk.lat]);
      rec.el.className = `map-pin kind-${mk.kind ?? 'stop'} tone-${mk.tone ?? 'none'}${mk.selected ? ' selected' : ''}`;
      rec.el.setAttribute('aria-label', mk.ariaLabel);
      rec.el.tabIndex = mk.kind === 'stop' || !mk.kind ? 0 : -1;
      if (mk.kind && mk.kind !== 'stop') rec.el.setAttribute('aria-hidden', 'true');
      rec.el.textContent = '';
      const span = document.createElement('span');
      span.textContent = mk.text ?? '';
      rec.el.appendChild(span);
      rec.m.getElement().style.zIndex = mk.selected ? '5' : '';
    }
  }, [props.markers, ready]);

  // Route line
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const src = m.getSource('route') as GeoJSONSource | undefined;
    src?.setData({
      type: 'FeatureCollection',
      features: props.route?.length ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: props.route.map((p) => [p.lng, p.lat]) } }] : [],
    });
  }, [props.route, ready]);

  // Fit
  useEffect(() => {
    const m = map.current, ml = lib.current;
    if (!m || !ml || !ready || !props.fit || props.fit.points.length === 0) return;
    const b = new ml.LngLatBounds();
    props.fit.points.forEach((p) => b.extend([p.lng, p.lat]));
    programmatic.current = true;
    if (props.fit.points.length === 1) m.jumpTo({ center: [props.fit.points[0].lng, props.fit.points[0].lat], zoom: props.fit.zoom ?? Math.max(m.getZoom(), 12) });
    else m.fitBounds(b, { padding: 48, maxZoom: 13, duration: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.fit?.key, ready]);

  // Draggable pin
  useEffect(() => {
    const m = map.current, ml = lib.current;
    if (!m || !ml || !ready) return;
    if (!props.draggablePin) {
      pin.current?.remove();
      pin.current = null;
      return;
    }
    if (!pin.current) {
      const e = document.createElement('div');
      e.className = 'drop-pin';
      e.setAttribute('aria-hidden', 'true');
      pin.current = new ml.Marker({ element: e, draggable: true, anchor: 'bottom' }).setLngLat([props.draggablePin.lng, props.draggablePin.lat]).addTo(m);
      pin.current.on('dragend', () => {
        const ll = pin.current!.getLngLat();
        propsRef.current.draggablePin?.onMove({ lat: ll.lat, lng: ll.lng });
      });
    } else {
      pin.current.setLngLat([props.draggablePin.lng, props.draggablePin.lat]);
    }
  }, [props.draggablePin?.lat, props.draggablePin?.lng, ready, props.draggablePin]);

  return (
    <div className={`map-shell ${props.className ?? ''}`}>
      <div ref={el} className="map-canvas" role="region" aria-label={props.label} />
      {failed && <div className="map-note">The map could not load in this browser. Use the list instead.</div>}
      {!failed && !tilesOk && <div className="map-note">Map background unavailable right now. Pins and routes still work.</div>}
    </div>
  );
}
