import { describe, expect, it, vi } from 'vitest';
import { censusLookup, handle, type Deps } from '../../supabase/functions/plops/core';
import { createOsmGeo } from '../../src/geo/osm';
import { looksLikeStreetAddress, parseUsAddress, stripUnit } from '../../src/lib/address';

const DENTON = '2800 S Interstate 35 E, Denton, TX 76210';
const CARROLLTON = '2550 Midway Rd Ste 100, Carrollton, TX 75006';

describe('address parsing', () => {
  it('strips suite and unit designators', () => {
    expect(stripUnit(CARROLLTON)).toBe('2550 Midway Rd, Carrollton, TX 75006');
    expect(stripUnit('100 Main St #4B, Waco, TX')).toBe('100 Main St, Waco, TX');
    expect(stripUnit('12 Oak Ave, Suite 210, Austin, TX')).toBe('12 Oak Ave, Austin, TX');
    expect(stripUnit(DENTON)).toBe(DENTON);
  });
  it('recognises street addresses vs place names', () => {
    expect(looksLikeStreetAddress(DENTON)).toBe(true);
    expect(looksLikeStreetAddress('Denton, TX')).toBe(false);
    expect(looksLikeStreetAddress('I-35 exit 330')).toBe(false);
  });
  it('parses number, street, city, state and ZIP', () => {
    expect(parseUsAddress(DENTON)).toEqual({ houseNumber: '2800', street: 'S Interstate 35 E', city: 'Denton', state: 'TX', postcode: '76210' });
    expect(parseUsAddress(CARROLLTON)).toEqual({ houseNumber: '2550', street: 'Midway Rd', city: 'Carrollton', state: 'TX', postcode: '75006' });
    expect(parseUsAddress('Waco')).toBeNull();
  });
});

// Shape of a real Census response (fields used by the app).
const censusJson = {
  result: {
    input: { address: { address: DENTON } },
    addressMatches: [{ matchedAddress: '2800 S INTERSTATE 35 E, DENTON, TX, 76210', coordinates: { x: -97.1015, y: 33.1772 }, tigerLine: { side: 'L', tigerLineId: '1' } }],
  },
};

describe('US Census lookup (backend)', () => {
  it('maps matches to places with readable labels', async () => {
    const f = vi.fn(async (_u: RequestInfo | URL, _i?: RequestInit) => new Response(JSON.stringify(censusJson)));
    const places = await censusLookup(DENTON, f as typeof fetch);
    expect(places).toEqual([{ lat: 33.1772, lng: -97.1015, label: '2800 S Interstate 35 E', detail: 'Denton, TX, 76210' }]);
    const url = new URL(String(f.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe('https://geocoding.geo.census.gov/geocoder/locations/onelineaddress');
    expect(url.searchParams.get('benchmark')).toBe('Public_AR_Current');
    expect(url.searchParams.get('format')).toBe('json');
  });

  it('is a plops action that needs no browser identity or challenge, but is rate limited', async () => {
    const rpc = vi.fn(async () => true);
    const deps: Deps = { rpc, verifyChallenge: vi.fn(), hashSecret: 'x'.repeat(40), allowedOrigins: ['https://me.github.io'], challengeRequired: true,
      fetchImpl: (async () => new Response(JSON.stringify(censusJson))) as typeof fetch };
    const req = (body: unknown) => new Request('https://f/plops', { method: 'POST', headers: { origin: 'https://me.github.io' }, body: JSON.stringify(body) });
    const res = await handle(req({ action: 'geocode', q: DENTON }), deps);
    expect(res.status).toBe(200);
    expect((await res.json()).places[0].label).toBe('2800 S Interstate 35 E');
    expect(rpc).toHaveBeenCalledWith('api_rate_limit', expect.objectContaining({ p_action: 'geocode:net' }));
    expect(deps.verifyChallenge).not.toHaveBeenCalled();
    rpc.mockResolvedValue(false);
    expect((await handle(req({ action: 'geocode', q: DENTON }), deps)).status).toBe(429);
    expect((await handle(req({ action: 'geocode', q: '' }), deps)).status).toBe(400);
    const down = { ...deps, rpc: vi.fn(async () => true), fetchImpl: (async () => new Response('', { status: 500 })) as typeof fetch };
    expect((await handle(req({ action: 'geocode', q: DENTON }), down)).status).toBe(502);
  });
});

describe('address search cascade (browser)', () => {
  const nominatim = (handler: (u: URL) => unknown[]) =>
    vi.fn(async (u: RequestInfo | URL) => new Response(JSON.stringify(handler(new URL(String(u))))));

  it('uses the exact Census match for street addresses when available', async () => {
    const f = nominatim(() => []);
    const lookup = vi.fn(async () => [{ lat: 33.1772, lng: -97.1015, label: '2800 S Interstate 35 E', detail: 'Denton, TX, 76210' }]);
    const g = createOsmGeo(f as typeof fetch, 0, lookup);
    const r = await g.geocode(DENTON);
    expect(r[0].approximate).toBeUndefined();
    expect(lookup).toHaveBeenCalledWith(DENTON);
    expect(f).not.toHaveBeenCalled();
  });

  it('drops the suite before asking the Census', async () => {
    const lookup = vi.fn(async () => [{ lat: 32.98, lng: -96.84, label: '2550 Midway Rd' }]);
    await createOsmGeo(nominatim(() => []) as typeof fetch, 0, lookup).geocode(CARROLLTON);
    expect(lookup).toHaveBeenCalledWith('2550 Midway Rd, Carrollton, TX 75006');
  });

  it('without an exact match, falls back to the street, then the town, marked approximate', async () => {
    const seen: string[] = [];
    const f = nominatim((u) => {
      seen.push(u.searchParams.get('q') ?? `structured:${u.searchParams.get('street')}`);
      if (u.searchParams.get('q') === 'Midway Rd, Carrollton, TX') return [{ lat: '32.98', lon: '-96.84', display_name: 'Midway Road, Carrollton, Dallas County, Texas, United States' }];
      return [];
    });
    const r = await createOsmGeo(f as typeof fetch, 0, async () => []).geocode(CARROLLTON);
    expect(seen).toEqual([CARROLLTON, '2550 Midway Rd, Carrollton, TX 75006', 'structured:2550 Midway Rd', 'Midway Rd, Carrollton, TX']);
    expect(r[0]).toMatchObject({ label: 'Midway Road, Carrollton', approximate: 'street' });

    const town = nominatim((u) => (u.searchParams.get('q') === 'Denton, TX, 76210' ? [{ lat: '33.2', lon: '-97.1', display_name: 'Denton, Denton County, Texas, United States' }] : []));
    const t = await createOsmGeo(town as typeof fetch, 0).geocode(DENTON);
    expect(t[0].approximate).toBe('town');
  });

  it('keeps working when the Census lookup fails', async () => {
    const f = nominatim(() => [{ lat: '33.17', lon: '-97.10', display_name: '2800, South Interstate 35 East, Denton, Texas, United States' }]);
    const r = await createOsmGeo(f as typeof fetch, 0, async () => { throw new Error('down'); }).geocode(DENTON);
    expect(r).toHaveLength(1);
    expect(r[0].approximate).toBeUndefined();
  });
});
