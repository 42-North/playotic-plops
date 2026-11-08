// Loads a MapLibre style and recolours it to the cocoa palette so the basemap matches the app.
import type { StyleSpecification, LayerSpecification } from 'maplibre-gl';

export const FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#2a1b15' } }],
};

const has = (id: string, ...words: string[]) => words.some((w) => id.includes(w));

export function recolor(style: StyleSpecification): StyleSpecification {
  const layers = style.layers.map((l): LayerSpecification => {
    const id = l.id.toLowerCase();
    const paint: Record<string, unknown> = { ...((l as { paint?: Record<string, unknown> }).paint ?? {}) };
    switch (l.type) {
      case 'background':
        paint['background-color'] = '#2a1b15';
        break;
      case 'fill':
        delete paint['fill-pattern'];
        delete paint['fill-outline-color'];
        paint['fill-color'] = has(id, 'water', 'ocean', 'lake', 'river')
          ? '#1f2b2b'
          : has(id, 'park', 'wood', 'forest', 'grass', 'landcover', 'scrub', 'farmland', 'wetland')
            ? '#33301e'
            : has(id, 'building')
              ? '#3a281f'
              : has(id, 'ice', 'glacier', 'sand') ? '#3b2c21' : '#2f1f19';
        if (has(id, 'park', 'wood', 'landcover')) paint['fill-opacity'] = 0.75;
        break;
      case 'fill-extrusion':
        paint['fill-extrusion-color'] = '#3a281f';
        break;
      case 'line': {
        delete paint['line-pattern'];
        let c = '#4b3329';
        if (has(id, 'water', 'river', 'stream', 'canal')) c = '#24393a';
        else if (has(id, 'casing', 'outline')) c = '#1e130f';
        else if (has(id, 'motorway', 'trunk', 'highway_major', 'major_road')) c = '#b77a43';
        else if (has(id, 'primary')) c = '#8a5c3b';
        else if (has(id, 'secondary', 'tertiary')) c = '#664532';
        else if (has(id, 'rail', 'transit')) c = '#3f2c24';
        else if (has(id, 'boundary', 'admin')) c = '#7b5a48';
        paint['line-color'] = c;
        break;
      }
      case 'symbol':
        paint['text-color'] = has(id, 'water', 'ocean', 'lake') ? '#9fb5b0' : '#ead5b7';
        paint['text-halo-color'] = '#1d120f';
        paint['text-halo-width'] = 1.4;
        if ('icon-color' in paint) paint['icon-color'] = '#d9a464';
        break;
      default:
        break;
    }
    return { ...l, paint } as LayerSpecification;
  });
  return { ...style, layers };
}

let cached: Promise<{ style: StyleSpecification; ok: boolean }> | null = null;

export function loadMapStyle(url: string, shouldRecolor: boolean): Promise<{ style: StyleSpecification; ok: boolean }> {
  if (!cached) {
    cached = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json() as Promise<StyleSpecification>;
      })
      .then((s) => ({ style: shouldRecolor ? recolor(s) : s, ok: true }))
      .catch(() => {
        cached = null; // allow a retry on next map mount
        return { style: FALLBACK_STYLE, ok: false };
      });
  }
  return cached;
}
