// LOCAL TESTING ONLY. A tiny stand-in for Supabase so the live-mode frontend can be exercised
// end to end against a real Postgres running the real migration:
//   POST /rest/v1/rpc/<fn>     → runs public.<fn> as the `anon` role (like PostgREST)
//   POST /functions/v1/plops   → runs the real Edge Function handler (core.ts), whose RPCs run as `service_role`
// It is not part of production. Usage:
//   PLOPS_DB_URL=postgres://... node scripts/local-backend.mjs [port]
import { createServer } from 'node:http';
import pg from 'pg';
import { handle, RpcError } from '../supabase/functions/plops/core.ts';

const port = Number(process.argv[2] ?? 54321);
pg.types.setTypeParser(1082, (v) => v); // dates as YYYY-MM-DD, like PostgREST
const pool = new pg.Pool({ connectionString: process.env.PLOPS_DB_URL });
const READS = new Set(['stops_in_bbox', 'stops_in_boxes', 'stops_near', 'stop_detail']);
const SCALAR = new Set(['stop_detail']);

async function call(role, fn, args) {
  const keys = Object.keys(args);
  const params = keys.map((k) => (args[k] !== null && typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k]));
  const named = keys.map((k, i) => `${k} => $${i + 1}`).join(', ');
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(`set local role ${role}`);
    const sql = SCALAR.has(fn) || role === 'service_role' ? `select public.${fn}(${named}) as r` : `select * from public.${fn}(${named})`;
    const out = await c.query(sql, params);
    await c.query('commit');
    return SCALAR.has(fn) || role === 'service_role' ? out.rows[0].r : out.rows;
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, apikey, authorization', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local');
  const chunks = [];
  for await (const ch of req) chunks.push(ch);
  const body = Buffer.concat(chunks).toString('utf8');

  if (url.pathname === '/functions/v1/plops') {
    const r = await handle(new Request(`http://local${url.pathname}`, { method: req.method, headers: { ...req.headers, 'x-forwarded-for': '127.0.0.1' }, body: req.method === 'POST' ? body : undefined }), {
      rpc: async (fn, args) => {
        try { return await call('service_role', fn, args); } catch (e) { throw new RpcError(400, e.code ?? '500', e.message); }
      },
      verifyChallenge: async () => true,
      hashSecret: 'local-development-secret-not-for-production',
      allowedOrigins: (process.env.ALLOWED_ORIGINS ?? 'http://localhost:4317,http://localhost:5173').split(','),
      challengeRequired: false,
      log: console.error,
    });
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(await r.text());
    return;
  }

  const m = url.pathname.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/);
  if (req.method === 'OPTIONS') { res.writeHead(204, cors).end(); return; }
  if (m && req.method === 'POST') {
    if (!READS.has(m[1])) {
      res.writeHead(401, { ...cors, 'Content-Type': 'application/json' }).end(JSON.stringify({ code: '42501', message: `permission denied for function ${m[1]}` }));
      return;
    }
    try {
      const out = await call('anon', m[1], body ? JSON.parse(body) : {});
      res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }).end(JSON.stringify(out));
    } catch (e) {
      res.writeHead(400, { ...cors, 'Content-Type': 'application/json' }).end(JSON.stringify({ code: e.code, message: e.message }));
    }
    return;
  }
  res.writeHead(404, cors).end();
}).listen(port, () => console.log(`Local Supabase stand-in on http://localhost:${port}`));
