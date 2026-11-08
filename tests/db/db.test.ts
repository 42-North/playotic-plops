/**
 * Database tests: run the real migration on a disposable Postgres database and exercise the
 * rating model, uniqueness, concurrency, privilege boundaries and moderation exclusions.
 *
 *   PLOPS_TEST_PG=postgres://postgres@/postgres?host=/var/tmp&port=54329 npm run test:db
 */
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handle, type Deps } from '../../supabase/functions/plops/core';

const ADMIN_URL = process.env.PLOPS_TEST_PG;
const DB = `plops_vitest_${process.pid}`;
const root = resolve(__dirname, '../..');

const describeDb = ADMIN_URL ? describe : describe.skip;

let pool: pg.Pool;

function dbUrl(name: string) {
  const u = new URL(ADMIN_URL!);
  u.pathname = `/${name}`;
  return u.toString();
}

const hash = () => randomBytes(32).toString('hex');
const today = () => new Date().toISOString().slice(0, 10);

async function as<T = any>(role: 'anon' | 'authenticated' | 'service_role', sql: string, params: unknown[] = []): Promise<T[]> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(`set local role ${role}`);
    const r = await c.query(sql, params);
    await c.query('commit');
    return r.rows as T[];
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
const owner = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows;

const CRITERIA = ['very_clean', 'full_doors', 'no', 'hot_food', 'unspecified'];

async function createStop(who: string, opts: Partial<{ name: string; lat: number; lng: number; rating: number; confirm: boolean }> = {}) {
  const [row] = await as('service_role',
    `select public.api_create_stop($1,$2,'gas_station','123 Example Rd, Testville',$3,$4,$5,$6::smallint,$7,$8,$9,$10,$11,$12,$13::date) as r`,
    [who, opts.name ?? 'Test Stop', opts.lat ?? 31.55, opts.lng ?? -97.15, opts.confirm ?? false, opts.rating ?? 5, ...CRITERIA, 'Original comment', today()]);
  return row.r as { ok: boolean; stop_id?: string; code?: string; candidates?: unknown[] };
}

async function rate(who: string, stopId: string, rating: number, extra: Partial<{ cleanliness: string; privacy: string; comment: string | null; visit: string }> = {}) {
  const [row] = await as('service_role',
    `select public.api_submit_rating($1,$2,$3::smallint,$4,$5,'unknown','unknown','unspecified',$6,$7::date) as r`,
    [who, stopId, rating, extra.cleanliness ?? 'unknown', extra.privacy ?? 'unknown', extra.comment ?? null, extra.visit ?? today()]);
  return row.r as { ok: boolean; code?: string; updated?: boolean; rating_id?: string };
}

async function vote(who: string, stopId: string, v: 'agree' | 'disagree' | 'none') {
  const [row] = await as('service_role', `select public.api_set_agreement($1,$2,$3) as r`, [who, stopId, v]);
  return row.r as { ok: boolean; code?: string };
}

async function summary(stopId: string) {
  const [row] = await as('anon', `select public.stop_detail($1) as d`, [stopId]);
  return row.d as any;
}

let lngCursor = -97.0;
/** Each test gets its own spot so duplicate checks don't interfere. */
const spot = () => ({ lat: 31.0, lng: (lngCursor -= 0.05) });

describeDb('database rating model', () => {
  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`drop database if exists ${DB}`);
    await admin.query(`create database ${DB}`);
    await admin.end();
    pool = new pg.Pool({ connectionString: dbUrl(DB), max: 20 });
    await pool.query(readFileSync(resolve(root, 'tests/db/supabase-roles.sql'), 'utf8'));
    await pool.query(readFileSync(resolve(root, 'supabase/migrations/20261108000001_playotic_plops.sql'), 'utf8'));
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    const admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`drop database if exists ${DB}`);
    await admin.end();
  });

  it('excludes the original rating from the crowd average', async () => {
    const s = await createStop(hash(), { ...spot(), rating: 5 });
    expect(s.ok).toBe(true);
    let d = await summary(s.stop_id!);
    expect(d.original_rating).toBe(5);
    expect(d.crowd_count).toBe(0);
    expect(d.crowd_avg).toBeNull();

    await rate(hash(), s.stop_id!, 2);
    await rate(hash(), s.stop_id!, 3);
    d = await summary(s.stop_id!);
    expect(d.crowd_count).toBe(2);
    expect(Number(d.crowd_avg)).toBe(2.5); // not (5+2+3)/3
    expect(d.original_rating).toBe(5);
  });

  it('rounds the crowd average to one decimal', async () => {
    const s = await createStop(hash(), spot());
    for (const r of [5, 5, 4]) await rate(hash(), s.stop_id!, r);
    const d = await summary(s.stop_id!);
    expect(String(d.crowd_avg)).toBe('4.7');
    expect(d.crowd_count).toBe(3);
  });

  it('agreement votes never change the crowd score', async () => {
    const s = await createStop(hash(), spot());
    await rate(hash(), s.stop_id!, 3);
    const before = await summary(s.stop_id!);
    for (let i = 0; i < 5; i++) expect((await vote(hash(), s.stop_id!, 'disagree')).ok).toBe(true);
    expect((await vote(hash(), s.stop_id!, 'agree')).ok).toBe(true);
    const after = await summary(s.stop_id!);
    expect(after.crowd_avg).toEqual(before.crowd_avg);
    expect(after.crowd_count).toBe(before.crowd_count);
    expect(after.agree_count).toBe(1);
    expect(after.disagree_count).toBe(5);
  });

  it('one current crowd rating per identity; resubmitting edits it', async () => {
    const s = await createStop(hash(), spot());
    const me = hash();
    const a = await rate(me, s.stop_id!, 1);
    const b = await rate(me, s.stop_id!, 4, { comment: 'Changed my mind' });
    expect(a.ok && b.ok).toBe(true);
    expect(b.updated).toBe(true);
    expect(b.rating_id).toBe(a.rating_id);
    const d = await summary(s.stop_id!);
    expect(d.crowd_count).toBe(1);
    expect(Number(d.crowd_avg)).toBe(4);
  });

  it('concurrent duplicate submissions from one identity create one row', async () => {
    const s = await createStop(hash(), spot());
    const me = hash();
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => rate(me, s.stop_id!, (i % 5) + 1)));
    expect(results.every((r) => r.ok)).toBe(true);
    const rows = await owner(`select count(*)::int n from private.ratings where stop_id = $1 and not is_original`, [s.stop_id]);
    expect(rows[0].n).toBe(1);
  });

  it('concurrent creation of the same place yields one stop', async () => {
    const p = spot();
    const results = await Promise.all(Array.from({ length: 8 }, () => createStop(hash(), { ...p, name: 'Race Fuel' })));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok).every((r) => r.code === 'duplicate')).toBe(true);
  });

  it('original submitter cannot crowd-rate or vote on their own stop', async () => {
    const me = hash();
    const s = await createStop(me, spot());
    expect((await rate(me, s.stop_id!, 5)).code).toBe('own_original');
    expect((await vote(me, s.stop_id!, 'agree')).code).toBe('own_original');
    expect((await summary(s.stop_id!)).crowd_count).toBe(0);
  });

  it('agreement votes are changeable and removable, one active per identity', async () => {
    const s = await createStop(hash(), spot());
    const me = hash();
    await vote(me, s.stop_id!, 'agree');
    await vote(me, s.stop_id!, 'agree');
    let d = await summary(s.stop_id!);
    expect([d.agree_count, d.disagree_count]).toEqual([1, 0]);
    await vote(me, s.stop_id!, 'disagree');
    d = await summary(s.stop_id!);
    expect([d.agree_count, d.disagree_count]).toEqual([0, 1]);
    await vote(me, s.stop_id!, 'none');
    d = await summary(s.stop_id!);
    expect([d.agree_count, d.disagree_count]).toEqual([0, 0]);
    const concurrent = await Promise.all(Array.from({ length: 10 }, (_, i) => vote(me, s.stop_id!, i % 2 ? 'agree' : 'disagree')));
    expect(concurrent.every((r) => r.ok)).toBe(true);
    d = await summary(s.stop_id!);
    expect(d.agree_count + d.disagree_count).toBe(1);
  });

  it('warns about nearby duplicates and requires confirmation', async () => {
    const p = spot();
    const first = await createStop(hash(), { ...p, name: 'Quickway Fuel' });
    expect(first.ok).toBe(true);
    const sameName = await createStop(hash(), { lat: p.lat + 0.0002, lng: p.lng, name: 'QUICKWAY  fuel', confirm: true });
    expect(sameName.code).toBe('duplicate');
    const near = await createStop(hash(), { lat: p.lat + 0.0008, lng: p.lng, name: 'Other Corner Mart' }); // ~90 m
    expect(near.code).toBe('possible_duplicate');
    expect(near.candidates).toHaveLength(1);
    const confirmed = await createStop(hash(), { lat: p.lat + 0.0008, lng: p.lng, name: 'Other Corner Mart', confirm: true });
    expect(confirmed.ok).toBe(true);
    const far = await createStop(hash(), { lat: p.lat + 0.01, lng: p.lng, name: 'Faraway Gas' }); // ~1.1 km
    expect(far.ok).toBe(true);
    const near2 = await as('anon', `select * from public.stops_near($1,$2,300)`, [p.lat, p.lng]);
    expect(near2.map((r: any) => r.name)).toEqual(expect.arrayContaining(['Quickway Fuel', 'Other Corner Mart']));
    expect(near2.map((r: any) => r.name)).not.toContain('Faraway Gas');
  });

  it('hidden ratings, votes and stops stop influencing public aggregates', async () => {
    const s = await createStop(hash(), spot());
    const r1 = await rate(hash(), s.stop_id!, 1, { comment: 'spammy nonsense' });
    await rate(hash(), s.stop_id!, 5);
    const voter = hash();
    await vote(voter, s.stop_id!, 'disagree');
    let d = await summary(s.stop_id!);
    expect(Number(d.crowd_avg)).toBe(3);

    await owner(`select private.mod_hide_rating($1, 'abusive')`, [r1.rating_id]);
    await owner(`update private.agreement_votes set status = 'hidden' where voter_hash = decode($1,'hex')`, [voter]);
    d = await summary(s.stop_id!);
    expect(d.crowd_count).toBe(1);
    expect(Number(d.crowd_avg)).toBe(5);
    expect(d.disagree_count).toBe(0);
    expect(d.recent_ratings.map((r: any) => r.comment)).not.toContain('spammy nonsense');

    // Hidden author cannot resurrect their rating by "editing" it.
    const [{ h }] = await owner(`select encode(contributor_hash,'hex') h from private.ratings where id = $1`, [r1.rating_id]);
    expect((await rate(h, s.stop_id!, 2)).code).toBe('rating_removed');

    // Hiding the original removes it and its agreement tallies.
    const [{ id: origId }] = await owner(`select id from private.ratings where stop_id = $1 and is_original`, [s.stop_id]);
    await vote(hash(), s.stop_id!, 'agree');
    await owner(`select private.mod_hide_rating($1)`, [origId]);
    d = await summary(s.stop_id!);
    expect(d.original_rating).toBeNull();
    expect(d.agree_count).toBe(0);
    expect((await vote(hash(), s.stop_id!, 'agree')).code).toBe('no_original');

    await owner(`select private.mod_hide_stop($1)`, [s.stop_id]);
    expect(await summary(s.stop_id!)).toBeNull();
    const box = await as('anon', `select id from public.stops_in_bbox(30,-100,32,-90,true,300)`);
    expect(box.map((r: any) => r.id)).not.toContain(s.stop_id);
    expect((await rate(hash(), s.stop_id!, 4)).code).toBe('not_found');
  });

  it('closed stops are excluded from default search and refuse new ratings', async () => {
    const s = await createStop(hash(), spot());
    await owner(`select private.mod_mark_closed($1, 'Station demolished')`, [s.stop_id]);
    const open = await as('anon', `select id from public.stops_in_bbox(30,-100,32,-90)`);
    expect(open.map((r: any) => r.id)).not.toContain(s.stop_id);
    const all = await as('anon', `select id from public.stops_in_bbox(30,-100,32,-90,true,300)`);
    expect(all.map((r: any) => r.id)).toContain(s.stop_id);
    expect((await rate(hash(), s.stop_id!, 4)).code).toBe('stop_closed');
  });

  it('latest-visit criteria keep unknown distinct and use visit dates', async () => {
    const s = await createStop(hash(), spot()); // original: very_clean, full_doors, today
    const lastWeek = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
    await rate(hash(), s.stop_id!, 2, { cleanliness: 'dirty', privacy: 'gaps', visit: lastWeek });
    await rate(hash(), s.stop_id!, 3); // unknown criteria today: must not overwrite known values
    const d = await summary(s.stop_id!);
    expect(d.cleanliness).toBe('very_clean');
    expect(d.stall_privacy).toBe('full_doors');
    expect(d.tallies.cleanliness).toEqual({ very_clean: 1, dirty: 1 });
  });

  it('rejects invalid input via constraints and validation', async () => {
    const s = await createStop(hash(), spot());
    await expect(rate(hash(), s.stop_id!, 6)).rejects.toThrow();
    await expect(rate(hash(), s.stop_id!, 0)).rejects.toThrow();
    await expect(rate(hash(), s.stop_id!, 3, { comment: 'x'.repeat(281) })).rejects.toThrow();
    await expect(rate(hash(), s.stop_id!, 3, { visit: '2099-01-01' })).rejects.toThrow(/visit date/);
    await expect(rate('not-a-hash', s.stop_id!, 3)).rejects.toThrow(/identity hash/);
    await expect(as('service_role', `select public.api_set_agreement($1,$2,'maybe')`, [hash(), s.stop_id])).rejects.toThrow();
    await expect(
      as('service_role', `select public.api_create_stop($1,'Hotel Lobby','hotel','1 Main St',31,-97,true,5::smallint,null,null,null,null,null,null,current_date)`, [hash()]),
    ).rejects.toThrow(/check constraint/);
  });

  it('comments are stored as plain text with control characters collapsed', async () => {
    const s = await createStop(hash(), spot());
    await rate(hash(), s.stop_id!, 3, { comment: '  <script>alert(1)</script>\n\tnice  ' });
    const d = await summary(s.stop_id!);
    const c = d.recent_ratings.find((r: any) => !r.is_original).comment;
    expect(c).toBe('<script>alert(1)</script> nice'); // stored verbatim as text; UI renders as text
  });

  it('anon and authenticated cannot write, read private tables, or call service functions', async () => {
    const s = await createStop(hash(), spot());
    for (const role of ['anon', 'authenticated'] as const) {
      await expect(as(role, `select * from private.stops`)).rejects.toThrow(/permission denied/);
      await expect(as(role, `select * from private.ratings`)).rejects.toThrow(/permission denied/);
      await expect(as(role, `select * from private.reports`)).rejects.toThrow(/permission denied/);
      await expect(as(role, `select * from private.moderation_queue`)).rejects.toThrow(/permission denied/);
      await expect(as(role, `select public.api_submit_rating($1,$2,5::smallint,'unknown','unknown','unknown','unknown','unspecified',null,current_date)`, [hash(), s.stop_id])).rejects.toThrow(/permission denied/);
      await expect(as(role, `select public.api_create_stop($1,'X Stop','gas_station','1 Main',31,-97,true,5::smallint,null,null,null,null,null,null,current_date)`, [hash()])).rejects.toThrow(/permission denied/);
      await expect(as(role, `select public.api_set_agreement($1,$2,'agree')`, [hash(), s.stop_id])).rejects.toThrow(/permission denied/);
      await expect(as(role, `select public.api_my_state($1,$2)`, [hash(), s.stop_id])).rejects.toThrow(/permission denied/);
      await expect(as(role, `select public.api_rate_limit($1,'x',5,60)`, [hash()])).rejects.toThrow(/permission denied/);
      await expect(as(role, `select private.mod_hide_stop($1)`, [s.stop_id])).rejects.toThrow(/permission denied/);
    }
  });

  it('public read functions never expose identity hashes or report details', async () => {
    const creator = hash();
    const s = await createStop(creator, spot());
    await as('service_role', `select public.api_create_report($1,$2,null,'other','secret report text')`, [hash(), s.stop_id]);
    const d = await summary(s.stop_id!);
    const json = JSON.stringify(d);
    expect(json).not.toContain(creator);
    expect(json).not.toMatch(/hash|secret report text|reporter/);
    const rows = await as('anon', `select * from public.stops_in_bbox(30,-100,32,-90,true,300)`);
    expect(Object.keys(rows[0])).not.toEqual(expect.arrayContaining(['creator_hash']));
  });

  it('reports persist privately and duplicate open reports are idempotent', async () => {
    const s = await createStop(hash(), spot());
    const who = hash();
    for (let i = 0; i < 3; i++) {
      const [r] = await as('service_role', `select public.api_create_report($1,$2,null,'closed_or_not_public',null) as r`, [who, s.stop_id]);
      expect(r.r.ok).toBe(true);
    }
    const q = await owner(`select * from private.moderation_queue where stop_id = $1`, [s.stop_id]);
    expect(q).toHaveLength(1);
    await owner(`select private.mod_resolve_report($1, 'resolved', 'confirmed closed')`, [q[0].report_id]);
    expect(await owner(`select * from private.moderation_queue where stop_id = $1`, [s.stop_id])).toHaveLength(0);
    // a disagreement-heavy stop is never auto-removed
    for (let i = 0; i < 20; i++) await vote(hash(), s.stop_id!, 'disagree');
    expect(await summary(s.stop_id!)).not.toBeNull();
  });

  it('rate limiter enforces the window atomically', async () => {
    const bucket = hash();
    const results = await Promise.all(Array.from({ length: 10 }, () =>
      as('service_role', `select public.api_rate_limit($1,'rate',4,3600) as ok`, [bucket])));
    expect(results.filter((r) => r[0].ok)).toHaveLength(4);
  });

  it('corridor search returns stops inside any box only', async () => {
    const a = await createStop(hash(), { lat: 40.1, lng: -100.1, name: 'Box A' });
    const b = await createStop(hash(), { lat: 40.9, lng: -100.9, name: 'Box B' });
    const rows = await as('anon', `select id from public.stops_in_boxes($1::jsonb)`, [JSON.stringify([[40.0, -100.2, 40.2, -100.0]])]);
    const ids = rows.map((r: any) => r.id);
    expect(ids).toContain(a.stop_id);
    expect(ids).not.toContain(b.stop_id);
    await expect(as('anon', `select * from public.stops_in_boxes($1::jsonb)`, [JSON.stringify(Array(41).fill([0, 0, 1, 1]))])).rejects.toThrow();
  });

  describe('edge function wired to the real database', () => {
    const ORIGIN = 'https://plops.example';
    const pgRpc: Deps['rpc'] = async (fn, args) => {
      const keys = Object.keys(args);
      const sql = `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`;
      const [row] = await as('service_role', sql, keys.map((k) => (args[k] !== null && typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k])));
      return row.r;
    };
    const deps: Deps = { rpc: pgRpc, verifyChallenge: async () => true, hashSecret: 'x'.repeat(40), allowedOrigins: [ORIGIN], challengeRequired: true };
    const call = (body: Record<string, unknown>, ip = '198.51.100.7') =>
      handle(new Request('https://fn/plops', { method: 'POST', headers: { origin: ORIGIN, 'x-forwarded-for': ip }, body: JSON.stringify({ challenge: 'ok-challenge-token', ...body }) }), deps);
    const tok = () => randomBytes(32).toString('base64url');

    it('create, rate, edit, vote and read own state end to end', async () => {
      const creator = tok();
      const p = spot();
      const created = await call({ action: 'create_stop', token: creator, name: 'Edge Fuel', category: 'travel_center', address: '9 Edge Way', lat: p.lat, lng: p.lng, rating: 5, stall_privacy: 'full_doors', visit_date: today() });
      expect(created.status).toBe(200);
      const { stop_id } = (await created.json()) as { stop_id: string };

      expect((await call({ action: 'rate', token: creator, stop_id, rating: 5, visit_date: today() })).status).toBe(409);

      const rater = tok();
      expect((await call({ action: 'rate', token: rater, stop_id, rating: 2, visit_date: today() })).status).toBe(200);
      expect((await call({ action: 'rate', token: rater, stop_id, rating: 4, comment: 'Better today', visit_date: today() })).status).toBe(200);
      expect((await call({ action: 'vote', token: rater, stop_id, vote: 'agree' })).status).toBe(200);

      const me = (await (await call({ action: "me", token: rater, stop_id })).json()) as any;
      expect(me.state.rating.rating).toBe(4);
      expect(me.state.vote).toBe('agree');
      expect(me.state.is_creator).toBe(false);
      const mine = (await (await call({ action: "me", token: creator, stop_id })).json()) as any;
      expect(mine.state.is_creator).toBe(true);

      const d = await summary(stop_id);
      expect(d.crowd_count).toBe(1);
      expect(Number(d.crowd_avg)).toBe(4);
      expect(d.original_rating).toBe(5);
      expect(d.agree_count).toBe(1);

      // the database never sees the raw browser token
      const rows = await owner(`select encode(contributor_hash,'escape') h from private.ratings where stop_id = $1`, [stop_id]);
      expect(JSON.stringify(rows)).not.toContain(rater);
    });

    it('enforces per-identity rate limits server-side', async () => {
      const p = spot();
      const results: number[] = [];
      const t = tok();
      for (let i = 0; i < 6; i++) {
        const r = await call({ action: 'create_stop', token: t, name: `Limit Stop ${i}`, category: 'gas_station', address: '1 Limit Ln', lat: p.lat + i * 0.01, lng: p.lng, rating: 3, visit_date: today() }, `192.0.2.${i}`);
        results.push(r.status);
      }
      expect(results.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
      expect(results[5]).toBe(429);
      const raw = await owner(`select count(*)::int n from private.rate_events where encode(bucket,'escape') like '%192.0.2%'`);
      expect(raw[0].n).toBe(0);
    });
  });
});
