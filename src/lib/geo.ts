export interface LatLng {
  lat: number;
  lng: number;
}

export interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

const R = 6371008.8;
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle ("straight-line") distance in metres. */
export function haversineM(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function bboxAround(c: LatLng, radiusM: number): BBox {
  const dLat = radiusM / 111_000;
  const dLng = radiusM / (111_000 * Math.max(Math.cos(rad(c.lat)), 0.01));
  return { south: c.lat - dLat, north: c.lat + dLat, west: c.lng - dLng, east: c.lng + dLng };
}

export function bboxCenter(b: BBox): LatLng {
  return { lat: (b.south + b.north) / 2, lng: (b.west + b.east) / 2 };
}

/** Clamp a bbox to the backend's 30° latitude window. */
export function clampBBox(b: BBox): BBox {
  if (b.north - b.south <= 30) return b;
  const c = bboxCenter(b);
  return { ...b, south: c.lat - 15, north: c.lat + 15 };
}

export interface RouteProjection {
  /** Straight-line distance from the point to the nearest point on the route. */
  offRouteM: number;
  /** Distance along the route geometry from its start to the nearest point. */
  alongM: number;
}

/**
 * Project a point onto a polyline using a local equirectangular approximation per segment.
 * Accurate to well under 1% for corridor widths of a few miles.
 */
export function projectOntoRoute(p: LatLng, line: LatLng[], cumulative?: number[]): RouteProjection {
  const cum = cumulative ?? cumulativeDistances(line);
  let best: RouteProjection = { offRouteM: Infinity, alongM: 0 };
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], b = line[i + 1];
    const kx = 111_320 * Math.cos(rad((a.lat + b.lat) / 2));
    const ky = 110_540;
    const bx = (b.lng - a.lng) * kx, by = (b.lat - a.lat) * ky;
    const px = (p.lng - a.lng) * kx, py = (p.lat - a.lat) * ky;
    const len2 = bx * bx + by * by;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / len2));
    const dx = px - t * bx, dy = py - t * by;
    const d = Math.hypot(dx, dy);
    if (d < best.offRouteM) best = { offRouteM: d, alongM: cum[i] + t * (cum[i + 1] - cum[i]) };
  }
  if (line.length === 1) best = { offRouteM: haversineM(p, line[0]), alongM: 0 };
  return best;
}

export function cumulativeDistances(line: LatLng[]): number[] {
  const out = [0];
  for (let i = 1; i < line.length; i++) out.push(out[i - 1] + haversineM(line[i - 1], line[i]));
  return out;
}

/**
 * Cover a route with at most `maxBoxes` boxes padded by `padM`, for the corridor query.
 * Each box spans an equal share of the route's length.
 */
export function corridorBoxes(line: LatLng[], padM: number, maxBoxes = 40): BBox[] {
  if (line.length === 0) return [];
  const cum = cumulativeDistances(line);
  const total = cum[cum.length - 1];
  // aim for boxes of ~40 km, capped by maxBoxes
  const n = Math.max(1, Math.min(maxBoxes, Math.ceil(total / 40_000)));
  const step = total / n || 1;
  const boxes: BBox[] = [];
  let idx = 0;
  for (let k = 0; k < n; k++) {
    const end = k === n - 1 ? Infinity : (k + 1) * step;
    let s = Infinity, w = Infinity, no = -Infinity, e = -Infinity;
    const take = (q: LatLng) => {
      s = Math.min(s, q.lat); no = Math.max(no, q.lat);
      w = Math.min(w, q.lng); e = Math.max(e, q.lng);
    };
    if (idx > 0) take(line[idx - 1]); // overlap so segments crossing a boundary are covered
    while (idx < line.length && cum[idx] <= end) take(line[idx++]);
    if (idx < line.length) take(line[idx]);
    if (s === Infinity) continue;
    const padLat = padM / 111_000;
    const padLng = padM / (111_000 * Math.max(Math.cos(rad((s + no) / 2)), 0.01));
    boxes.push({ south: s - padLat, north: no + padLat, west: w - padLng, east: e + padLng });
  }
  return boxes;
}

/** Downsample long geometries for rendering and projection (keeps first and last). */
export function thin(line: LatLng[], max = 2000): LatLng[] {
  if (line.length <= max) return line;
  const step = (line.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => line[Math.round(i * step)]);
}
