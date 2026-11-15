// Loads a MapLibre style and recolours it to the cream & caramel palette so the basemap matches the app.
import type { StyleSpecification, LayerSpecification } from 'maplibre-gl';

export const FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#f3ebde' } }],
};

const has = (id: string, ...words: string[]) => words.some((w) => id.includes(w));

export function recolor(style: StyleSpecification): StyleSpecification {
  const layers = style.layers.map((l): LayerSpecification => {
    const id = l.id.toLowerCase();
    const paint: Record<string, unknown> = { ...((l as { paint?: Record<string, unknown> }).paint ?? {}) };
    switch (l.type) {
      case 'background':
        paint['background-color'] = '#f3ebde';
        break;
      case 'fill':
        delete paint['fill-pattern'];
        delete paint['fill-outline-color'];
        paint['fill-color'] = has(id, 'water', 'ocean', 'lake', 'river')
          ? '#cfe2e3'
          : has(id, 'park', 'wood', 'forest', 'grass', 'landcover', 'scrub', 'farmland', 'wetland')
            ? '#e2e6cc'
            : has(id, 'building')
              ? '#e8dccb'
              : has(id, 'ice', 'glacier', 'sand') ? '#efe5d2' : '#f0e7d9';
        if (has(id, 'park', 'wood', 'landcover')) paint['fill-opacity'] = 0.75;
        break;
      case 'fill-extrusion':
        paint['fill-extrusion-color'] = '#e8dccb';
        break;
      case 'line': {
        delete paint['line-pattern'];
        let c = '#ffffff';
        if (has(id, 'water', 'river', 'stream', 'canal')) c = '#a9cdd0';
        else if (has(id, 'casing', 'outline')) c = '#dccab0';
        else if (has(id, 'motorway', 'trunk', 'highway_major', 'major_road')) c = '#f0b860';
        else if (has(id, 'primary')) c = '#f7d9a8';
        else if (has(id, 'secondary', 'tertiary')) c = '#fffaf2';
        else if (has(id, 'rail', 'transit')) c = '#d6c8b4';
        else if (has(id, 'boundary', 'admin')) c = '#b9a58c';
        paint['line-color'] = c;
        break;
      }
      case 'symbol':
        paint['text-color'] = has(id, 'water', 'ocean', 'lake') ? '#4f7a7d' : '#5b4433';
        paint['text-halo-color'] = '#faf5ec';
        paint['text-halo-width'] = 1.4;
        if ('icon-color' in paint) paint['icon-color'] = '#9a6232';
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
