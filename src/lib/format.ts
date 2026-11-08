const M_PER_MI = 1609.344;

export function miles(m: number): string {
  const mi = m / M_PER_MI;
  if (mi < 0.1) return '<0.1 mi';
  if (mi < 10) return `${mi.toFixed(1)} mi`;
  return `${Math.round(mi)} mi`;
}

/** Distances that were NOT computed along roads must always say so. */
export const straightLine = (m: number) => `${miles(m)} straight-line`;

export function minutes(s: number): string {
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

export function detourLabel(extraS: number): string {
  const min = Math.round(extraS / 60);
  if (min <= 0) return 'Adds under 1 min';
  return `Adds ${min} min`;
}

export function crowdScore(avg: number | null | undefined): string {
  return avg == null ? '–' : Number(avg).toFixed(1);
}

export function ratingCount(n: number): string {
  return `${n} crowd rating${n === 1 ? '' : 's'}`;
}

/** How settled the crowd average is. Counts are always shown alongside. */
export function confidence(n: number): string | null {
  if (n === 0) return null;
  if (n < 5) return 'Early read';
  if (n < 20) return null;
  return 'Well established';
}

export function todayLocalISO(d = new Date()): string {
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 10);
}

/** "today", "yesterday", "5 days ago", "3 weeks ago", "Mar 2025". Dates are calendar days. */
export function daysAgo(isoDate: string, today = todayLocalISO()): string {
  const a = Date.parse(`${isoDate.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  const days = Math.round((b - a) / 864e5);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return new Date(a).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function shortDate(isoDate: string): string {
  return new Date(`${isoDate.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}
