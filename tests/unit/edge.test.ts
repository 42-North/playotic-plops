import { describe, expect, it, vi } from 'vitest';
import { handle, identityHash, postgrestRpc, RpcError, turnstileVerifier, type Deps } from '../../supabase/functions/plops/core';

const ORIGIN = 'https://example.github.io';
const TOKEN = 'A'.repeat(43);
const SECRET = 's'.repeat(40);
const STOP = '6f1c1c1e-1111-4222-8333-944444444444';
const today = new Date().toISOString().slice(0, 10);

function deps(over: Partial<Deps> = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const d: Deps = {
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (fn === 'api_rate_limit') return true;
      return { ok: true, rating_id: 'r1' };
    }),
    verifyChallenge: vi.fn(async () => true),
    hashSecret: SECRET,
    allowedOrigins: [ORIGIN],
    challengeRequired: true,
    ...over,
  };
  return { d, calls };
}

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request('https://x.supabase.co/functions/v1/plops', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-forwarded-for': '203.0.113.9, 10.0.0.1', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const rateBody = { action: 'rate', token: TOKEN, challenge: 'challenge-token-xyz', stop_id: STOP, rating: 4, visit_date: today };

describe('plops edge function', () => {
  it('accepts a valid rating and stores only keyed hashes', async () => {
    const { d, calls } = deps();
    const res = await handle(post(rateBody), d);
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    const all = JSON.stringify(calls);
    expect(all).not.toContain(TOKEN);
    expect(all).not.toContain('203.0.113.9');
    const write = calls.find((c) => c.fn === 'api_submit_rating')!;
    expect(write.args.p_contributor).toBe(await identityHash(SECRET, TOKEN));
    expect(write.args.p_contributor).toMatch(/^[0-9a-f]{64}$/);
    expect(write.args.p_cleanliness).toBe('unknown'); // unknown is the default, not a negative answer
  });

  it('rejects writes from other browser origins', async () => {
    const { d } = deps();
    const res = await handle(post(rateBody, { origin: 'https://evil.example' }), d);
    expect(res.status).toBe(403);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(d.rpc).not.toHaveBeenCalled();
  });

  it('answers CORS preflight for allowed origins', async () => {
    const { d } = deps();
    const res = await handle(new Request('https://x/plops', { method: 'OPTIONS', headers: { origin: ORIGIN } }), d);
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
  });

  it('requires and verifies a challenge for public writes', async () => {
    const { d } = deps();
    const missing = await handle(post({ ...rateBody, challenge: undefined }), d);
    expect(missing.status).toBe(403);
    const { d: d2 } = deps({ verifyChallenge: vi.fn(async () => false) });
    const failed = await handle(post(rateBody), d2);
    expect(failed.status).toBe(403);
    expect(d2.rpc).not.toHaveBeenCalled();
    expect(d2.verifyChallenge).toHaveBeenCalledWith('challenge-token-xyz', 'rate');
  });

  it('validates before spending challenges or rate-limit slots', async () => {
    for (const bad of [
      { ...rateBody, token: 'short' },
      { ...rateBody, rating: 6 },
      { ...rateBody, rating: 4.5 },
      { ...rateBody, cleanliness: 'sparkly' },
      { ...rateBody, comment: 'x'.repeat(281) },
      { ...rateBody, visit_date: '2999-01-01' },
      { ...rateBody, stop_id: 'nope' },
      { action: 'vote', token: TOKEN, challenge: 'challenge-token-xyz', stop_id: STOP, vote: 'maybe' },
      { action: 'create_stop', token: TOKEN, challenge: 'challenge-token-xyz', name: 'X', category: 'gas_station', address: '1 Main', lat: 31, lng: -97, rating: 3, visit_date: today },
      { action: 'create_stop', token: TOKEN, challenge: 'challenge-token-xyz', name: 'Hotel Lobby', category: 'hotel', address: '1 Main', lat: 31, lng: -97, rating: 3, visit_date: today },
    ]) {
      const { d } = deps();
      const res = await handle(post(bad), d);
      expect(res.status, JSON.stringify(bad).slice(0, 80)).toBe(400);
      expect(d.verifyChallenge).not.toHaveBeenCalled();
      expect(d.rpc).not.toHaveBeenCalled();
    }
  });

  it('returns 429 when either rate-limit bucket is exhausted', async () => {
    const { d } = deps({ rpc: vi.fn(async (fn: string) => (fn === 'api_rate_limit' ? false : { ok: true })) });
    const res = await handle(post(rateBody), d);
    expect(res.status).toBe(429);
  });

  it('maps business conflicts to 409 and missing stops to 404', async () => {
    const conflict = deps({ rpc: vi.fn(async (fn: string) => (fn === 'api_rate_limit' ? true : { ok: false, code: 'own_original', message: 'x' })) });
    expect((await handle(post(rateBody), conflict.d)).status).toBe(409);
    const missing = deps({ rpc: vi.fn(async (fn: string) => (fn === 'api_rate_limit' ? true : { ok: false, code: 'not_found', message: 'x' })) });
    expect((await handle(post(rateBody), missing.d)).status).toBe(404);
  });

  it('does not leak internal errors', async () => {
    const { d } = deps({ rpc: vi.fn(async () => { throw new Error('connection string postgres://secret'); }) });
    const res = await handle(post(rateBody), d);
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('secret');
    const db400 = deps({ rpc: vi.fn(async (fn: string) => { if (fn === 'api_rate_limit') return true; throw new RpcError(400, '23514', 'violates check'); }) });
    expect((await handle(post(rateBody), db400.d)).status).toBe(400);
  });

  it('does not require a challenge to read your own state', async () => {
    const { d, calls } = deps({ rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => { calls.push({ fn, args }); return fn === 'api_rate_limit' ? true : { is_creator: false, rating: null, vote: null }; }) });
    const res = await handle(post({ action: 'me', token: TOKEN, stop_id: STOP }), d);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, state: { is_creator: false, rating: null, vote: null } });
    expect(d.verifyChallenge).not.toHaveBeenCalled();
  });

  it('rejects non-POST, oversized and malformed bodies', async () => {
    const { d } = deps();
    expect((await handle(new Request('https://x/plops', { method: 'GET', headers: { origin: ORIGIN } }), d)).status).toBe(405);
    expect((await handle(post('x'.repeat(9000)), d)).status).toBe(413);
    expect((await handle(post('{nope'), d)).status).toBe(400);
    expect((await handle(post({ action: 'drop_tables', token: TOKEN }), d)).status).toBe(400);
  });
});

describe('Turnstile verification', () => {
  const fakeFetch = (out: unknown) => vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify(out)));

  it('passes only successful tokens for the expected action and hostname', async () => {
    expect(await turnstileVerifier('sec', [], fakeFetch({ success: true, action: 'rate' }) as any)('tok', 'rate')).toBe(true);
    expect(await turnstileVerifier('sec', [], fakeFetch({ success: false }) as any)('tok', 'rate')).toBe(false);
    expect(await turnstileVerifier('sec', [], fakeFetch({ success: true, action: 'vote' }) as any)('tok', 'rate')).toBe(false);
    expect(await turnstileVerifier('sec', ['me.github.io'], fakeFetch({ success: true, hostname: 'other.com' }) as any)('tok', 'rate')).toBe(false);
  });

  it('does not forward the visitor IP to Siteverify', async () => {
    const f = fakeFetch({ success: true });
    await turnstileVerifier('sec', [], f as any)('tok', 'rate');
    const body = JSON.parse(String(f.mock.calls[0][1]!.body));
    expect(body).toEqual({ secret: 'sec', response: 'tok' });
  });
});

describe('PostgREST RPC client', () => {
  it('sends the service key on the apikey header and surfaces SQL error codes', async () => {
    const f = vi.fn(async (_u: string | URL | Request, _i?: RequestInit) => new Response(JSON.stringify({ code: '23514', message: 'bad' }), { status: 400 }));
    const rpc = postgrestRpc('https://abc.supabase.co/', 'sb_secret_xyz', f as any);
    await expect(rpc('api_submit_rating', {})).rejects.toMatchObject({ code: '23514' });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://abc.supabase.co/rest/v1/rpc/api_submit_rating');
    expect((init!.headers as Record<string, string>).apikey).toBe('sb_secret_xyz');
    expect((init!.headers as Record<string, string>).Authorization).toBeUndefined();
  });
});
