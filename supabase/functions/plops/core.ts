// Request handling for the `plops` Edge Function. Runtime-agnostic: dependencies (database
// RPC, challenge verification, secret) are injected so this file runs under Deno in
// production and under Node/Vitest in tests.

import { ValidationError, cleanText, ratingFields, reportFields, stopFields, token as parseToken, uuid, voteValue } from './validate.ts';

export type Action = 'create_stop' | 'rate' | 'vote' | 'report' | 'me';

export class RpcError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface Deps {
  /** Calls a Postgres function as service_role and returns its JSON result. */
  rpc: (fn: string, args: Record<string, unknown>) => Promise<unknown>;
  /** Verifies a challenge token server-side. Returns true when valid for the expected action. */
  verifyChallenge: (token: string, expectedAction: string) => Promise<boolean>;
  /** Secret used to derive keyed hashes. Never leaves the backend. */
  hashSecret: string;
  allowedOrigins: string[];
  /** When false (local development only), challenge verification is skipped. */
  challengeRequired: boolean;
  now?: () => Date;
  log?: (msg: string) => void;
  /** Used for the US Census address lookup. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/** Address lookups: no browser identity needed (browsing never creates one), limited per network. */
export const GEOCODE_LIMIT: [number, number] = [300, 3_600];

export interface GeocodedPlace { lat: number; lng: number; label: string; detail?: string }

const titleCase = (s: string) =>
  s.toLowerCase().replace(/\b([a-z])([a-z]*)/g, (_m, a: string, b: string) => a.toUpperCase() + b);

/**
 * US Census Bureau geocoder (free, no key). It does not allow browser (CORS) requests,
 * so the backend asks on the visitor's behalf. The address is not stored.
 */
export async function censusLookup(address: string, fetchImpl: typeof fetch = fetch): Promise<GeocodedPlace[]> {
  const p = new URLSearchParams({ address, benchmark: 'Public_AR_Current', format: 'json' });
  const res = await fetchImpl(`https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?${p}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`census ${res.status}`);
  const out = (await res.json()) as { result?: { addressMatches?: { matchedAddress?: string; coordinates?: { x?: number; y?: number } }[] } };
  return (out.result?.addressMatches ?? [])
    .filter((m) => Number.isFinite(m.coordinates?.x) && Number.isFinite(m.coordinates?.y))
    .slice(0, 5)
    .map((m) => {
      const parts = String(m.matchedAddress ?? '').split(',').map((x) => x.trim());
      const [street = '', city = '', state = '', zip = ''] = parts;
      return {
        lat: m.coordinates!.y!,
        lng: m.coordinates!.x!,
        label: titleCase(street),
        detail: [titleCase(city), state.toUpperCase(), zip].filter(Boolean).join(', ') || undefined,
      };
    });
}

/** Per-action limits. Each write is checked against the browser identity AND the network bucket. */
export const RATE_LIMITS: Record<Action, { identity: [number, number]; network: [number, number] }> = {
  create_stop: { identity: [5, 86_400], network: [15, 86_400] },
  rate: { identity: [30, 3_600], network: [60, 3_600] },
  vote: { identity: [60, 3_600], network: [150, 3_600] },
  report: { identity: [10, 86_400], network: [30, 86_400] },
  me: { identity: [600, 3_600], network: [1_200, 3_600] },
};

const CHALLENGED: ReadonlySet<Action> = new Set(['create_stop', 'rate', 'vote', 'report']);
const MAX_BODY = 8 * 1024;

const CONFLICT_CODES = new Set(['duplicate', 'possible_duplicate', 'own_original', 'rating_removed', 'vote_removed', 'no_original', 'stop_closed']);

const enc = new TextEncoder();

export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The pseudonymous identity stored in the database: HMAC of the browser token. */
export const identityHash = (secret: string, token: string) => hmacHex(secret, `identity:v1:${token}`);

/**
 * Transient network bucket for rate limiting. Keyed and salted with the UTC day so buckets
 * cannot be linked across days or reversed to an IP address without the secret.
 */
export const networkBucket = (secret: string, ip: string, now: Date) =>
  hmacHex(secret, `network:v1:${now.toISOString().slice(0, 10)}:${ip}`);

export function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('cf-connecting-ip') ?? req.headers.get('x-real-ip') ?? 'unknown';
}

function corsHeaders(origin: string | null): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    Vary: 'Origin',
  };
  if (origin) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    h['Access-Control-Allow-Headers'] = 'content-type, apikey, authorization, x-client-info';
    h['Access-Control-Max-Age'] = '600';
  }
  return h;
}

function json(status: number, body: unknown, origin: string | null) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(origin) });
}

function fail(status: number, code: string, message: string, origin: string | null, extra: Record<string, unknown> = {}) {
  return json(status, { ok: false, code, message, ...extra }, origin);
}

function originAllowed(origin: string, allowed: string[]) {
  return allowed.includes(origin);
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  const origin = req.headers.get('origin');
  if (origin && !originAllowed(origin, deps.allowedOrigins)) {
    return new Response(JSON.stringify({ ok: false, code: 'origin_not_allowed', message: 'This origin may not write to Playotic Plops.' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const allowOrigin = origin ?? null;

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(allowOrigin) });
  if (req.method !== 'POST') return fail(405, 'method_not_allowed', 'Use POST.', allowOrigin);

  const raw = await req.text();
  if (raw.length > MAX_BODY) return fail(413, 'too_large', 'Request is too large.', allowOrigin);
  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    body = parsed;
  } catch {
    return fail(400, 'bad_json', 'Request body must be a JSON object.', allowOrigin);
  }

  const now = deps.now?.() ?? new Date();

  if (body.action === 'geocode') {
    try {
      const q = cleanText(body.q, 'q', 200, true, 3)!;
      const net = await networkBucket(deps.hashSecret, clientIp(req), now);
      const ok = await deps.rpc('api_rate_limit', { p_bucket: net, p_action: 'geocode:net', p_max: GEOCODE_LIMIT[0], p_window_seconds: GEOCODE_LIMIT[1] });
      if (!ok) return fail(429, 'rate_limited', 'Too many searches for now. Please try again later.', allowOrigin);
      try {
        return json(200, { ok: true, places: await censusLookup(q, deps.fetchImpl ?? fetch) }, allowOrigin);
      } catch (e) {
        deps.log?.(`census lookup failed: ${e instanceof Error ? e.message : String(e)}`);
        return fail(502, 'geocoder_unavailable', 'The address lookup service is unavailable right now.', allowOrigin);
      }
    } catch (e) {
      if (e instanceof ValidationError) return fail(400, 'invalid', e.message, allowOrigin, { field: e.field });
      deps.log?.(`plops geocode error: ${e instanceof Error ? e.message : String(e)}`);
      return fail(500, 'server_error', 'Something went wrong on our side. Please try again.', allowOrigin);
    }
  }

  const action = body.action as Action;
  if (!(action in RATE_LIMITS)) return fail(400, 'unknown_action', 'Unknown action.', allowOrigin);

  try {
    const browserToken = parseToken(body.token);
    // Validate everything before spending a challenge or a rate-limit slot.
    const payload = parsePayload(action, body, now);

    if (CHALLENGED.has(action) && deps.challengeRequired) {
      const ch = body.challenge;
      if (typeof ch !== 'string' || ch.length < 10 || ch.length > 2048) {
        return fail(403, 'challenge_required', 'Please complete the quick check and try again.', allowOrigin);
      }
      if (!(await deps.verifyChallenge(ch, action))) {
        return fail(403, 'challenge_failed', 'The quick check did not pass. Please try again.', allowOrigin);
      }
    }

    const who = await identityHash(deps.hashSecret, browserToken);
    const net = await networkBucket(deps.hashSecret, clientIp(req), now);
    const lim = RATE_LIMITS[action];
    const okNet = await deps.rpc('api_rate_limit', { p_bucket: net, p_action: `${action}:net`, p_max: lim.network[0], p_window_seconds: lim.network[1] });
    const okId = okNet && (await deps.rpc('api_rate_limit', { p_bucket: who, p_action: `${action}:id`, p_max: lim.identity[0], p_window_seconds: lim.identity[1] }));
    if (!okNet || !okId) {
      return fail(429, 'rate_limited', 'Too many submissions for now. Please try again later.', allowOrigin);
    }

    const result = (await dispatch(action, who, payload, deps)) as { ok?: boolean; code?: string; message?: string };
    if (result && result.ok === false) {
      const status = result.code === 'not_found' ? 404 : result.code && CONFLICT_CODES.has(result.code) ? 409 : 400;
      return json(status, result, allowOrigin);
    }
    return json(200, action === 'me' ? { ok: true, state: result } : result, allowOrigin);
  } catch (e) {
    if (e instanceof ValidationError) return fail(400, 'invalid', e.message, allowOrigin, { field: e.field });
    if (e instanceof RpcError && ['22023', '23514', '22P02', '22007', '22008', '23502'].includes(e.code)) {
      return fail(400, 'invalid', 'Some of the submitted values were not accepted.', allowOrigin);
    }
    deps.log?.(`plops error: ${e instanceof Error ? e.message : String(e)}`);
    return fail(500, 'server_error', 'Something went wrong on our side. Please try again.', allowOrigin);
  }
}

type Payload = Record<string, unknown>;

function parsePayload(action: Action, b: Record<string, unknown>, now: Date): Payload {
  switch (action) {
    case 'create_stop':
      return { ...stopFields(b), ...ratingFields(b, now) };
    case 'rate':
      return { stop_id: uuid(b.stop_id, 'stop_id'), ...ratingFields(b, now) };
    case 'vote':
      return { stop_id: uuid(b.stop_id, 'stop_id'), vote: voteValue(b.vote) };
    case 'report':
      return reportFields(b);
    case 'me':
      return { stop_id: uuid(b.stop_id, 'stop_id') };
  }
}

function dispatch(action: Action, who: string, p: Payload, deps: Deps) {
  switch (action) {
    case 'create_stop':
      return deps.rpc('api_create_stop', {
        p_contributor: who,
        p_name: p.name, p_category: p.category, p_address: p.address, p_lat: p.lat, p_lng: p.lng,
        p_confirm_distinct: p.confirm_distinct,
        p_rating: p.rating, p_cleanliness: p.cleanliness, p_stall_privacy: p.stall_privacy,
        p_key_required: p.key_required, p_food: p.food, p_restroom: p.restroom,
        p_comment: p.comment, p_visit_date: p.visit_date,
      });
    case 'rate':
      return deps.rpc('api_submit_rating', {
        p_contributor: who, p_stop_id: p.stop_id,
        p_rating: p.rating, p_cleanliness: p.cleanliness, p_stall_privacy: p.stall_privacy,
        p_key_required: p.key_required, p_food: p.food, p_restroom: p.restroom,
        p_comment: p.comment, p_visit_date: p.visit_date,
      });
    case 'vote':
      return deps.rpc('api_set_agreement', { p_voter: who, p_stop_id: p.stop_id, p_vote: p.vote });
    case 'report':
      return deps.rpc('api_create_report', {
        p_reporter: who, p_stop_id: p.stop_id, p_rating_id: p.rating_id, p_reason: p.reason, p_details: p.details,
      });
    case 'me':
      return deps.rpc('api_my_state', { p_contributor: who, p_stop_id: p.stop_id });
  }
}

/** Cloudflare Turnstile Siteverify. Raw IPs are not forwarded (optional per Cloudflare docs). */
export function turnstileVerifier(secret: string, expectedHostnames: string[], fetchImpl: typeof fetch = fetch) {
  return async (token: string, expectedAction: string) => {
    const res = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, response: token }),
    });
    if (!res.ok) return false;
    const out = (await res.json()) as { success?: boolean; action?: string; hostname?: string };
    if (!out.success) return false;
    if (out.action && out.action !== expectedAction) return false;
    if (expectedHostnames.length && out.hostname && !expectedHostnames.includes(out.hostname)) return false;
    return true;
  };
}

/** PostgREST RPC with the service key on the apikey header (works for new secret keys and legacy JWT keys). */
export function postgrestRpc(supabaseUrl: string, serviceKey: string, fetchImpl: typeof fetch = fetch) {
  return async (fn: string, args: Record<string, unknown>) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', apikey: serviceKey };
    if (serviceKey.startsWith('eyJ')) headers.Authorization = `Bearer ${serviceKey}`;
    const res = await fetchImpl(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(args),
    });
    const text = await res.text();
    if (!res.ok) {
      let code = String(res.status);
      let message = text;
      try {
        const j = JSON.parse(text);
        code = j.code ?? code;
        message = j.message ?? message;
      } catch { /* keep raw */ }
      throw new RpcError(res.status, code, message);
    }
    return text ? JSON.parse(text) : null;
  };
}
