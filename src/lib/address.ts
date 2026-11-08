// Small helpers for US address search. Pure functions, unit-tested.

/** "2800 S Interstate 35 E, ..." — starts with a house number followed by a street. */
export function looksLikeStreetAddress(q: string): boolean {
  return /^\s*\d+[A-Za-z]?(-\d+)?\s+[A-Za-z0-9]/.test(q);
}

const UNIT = /\s*,?\s*\b(?:ste|suite|unit|apt|apartment|bldg|building|fl|floor|rm|room|spc|space|lot)\b\.?\s*#?\s*[A-Za-z0-9-]+|\s*#\s*[A-Za-z0-9-]+/gi;

/** Remove suite/unit/apartment designators, which many geocoders can't match. */
export function stripUnit(q: string): string {
  return q.replace(UNIT, '').replace(/\s+,/g, ',').replace(/,\s*,/g, ',').replace(/\s{2,}/g, ' ').trim();
}

export interface UsAddress {
  houseNumber?: string;
  street?: string;
  city?: string;
  state?: string;
  postcode?: string;
}

/** Parse "number street, city, ST 12345" (state/ZIP optional). Returns null if it doesn't look like that. */
export function parseUsAddress(q: string): UsAddress | null {
  const parts = stripUnit(q).split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const out: UsAddress = {};
  const tail = parts[parts.length - 1];
  const sz = tail.match(/^([A-Za-z]{2}|[A-Za-z][A-Za-z ]+?)\s*(\d{5})?(?:-\d{4})?$/);
  let rest = parts;
  if (sz && (sz[2] || sz[1].length === 2 || parts.length >= 3)) {
    out.state = sz[1].trim();
    if (sz[2]) out.postcode = sz[2];
    rest = parts.slice(0, -1);
  } else if (/^\d{5}$/.test(tail)) {
    out.postcode = tail;
    rest = parts.slice(0, -1);
  }
  const m = rest[0].match(/^(\d+[A-Za-z]?(?:-\d+)?)\s+(.+)$/);
  if (m) {
    out.houseNumber = m[1];
    out.street = m[2];
  } else {
    out.street = rest[0];
  }
  if (rest.length > 1) out.city = rest[rest.length - 1];
  return out.street || out.city ? out : null;
}
