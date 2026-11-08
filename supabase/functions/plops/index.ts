// Supabase Edge Function entry point: `plops`.
// Deploy: supabase functions deploy plops --no-verify-jwt   (also set in supabase/config.toml)
//
// Required secrets (supabase secrets set ...):
//   PLOPS_HASH_SECRET      long random string; keys identity hashes and rate-limit buckets
//   ALLOWED_ORIGINS        comma-separated, e.g. https://you.github.io,http://localhost:5173
//   TURNSTILE_SECRET_KEY   Cloudflare Turnstile secret key
// Optional:
//   TURNSTILE_HOSTNAMES    comma-separated hostnames the challenge must have been solved on
//   CHALLENGE_MODE=off     local development only; disables challenge verification
// Provided by Supabase automatically: SUPABASE_URL, SUPABASE_SECRET_KEYS (or legacy SUPABASE_SERVICE_ROLE_KEY)

import { handle, postgrestRpc, turnstileVerifier } from './core.ts';

const env = (k: string) => Deno.env.get(k)?.trim() ?? '';
const list = (k: string) => env(k).split(',').map((s) => s.trim()).filter(Boolean);

function serviceKey(): string {
  const keys = env('SUPABASE_SECRET_KEYS');
  if (keys) {
    try {
      const parsed = JSON.parse(keys) as Record<string, string>;
      const k = parsed['default'] ?? Object.values(parsed)[0];
      if (k) return k;
    } catch { /* fall through to legacy key */ }
  }
  return env('SUPABASE_SERVICE_ROLE_KEY');
}

const supabaseUrl = env('SUPABASE_URL');
const key = serviceKey();
const hashSecret = env('PLOPS_HASH_SECRET');
const turnstileSecret = env('TURNSTILE_SECRET_KEY');
const challengeOff = env('CHALLENGE_MODE') === 'off';

const misconfigured: string[] = [];
if (!supabaseUrl) misconfigured.push('SUPABASE_URL');
if (!key) misconfigured.push('SUPABASE_SECRET_KEYS');
if (hashSecret.length < 32) misconfigured.push('PLOPS_HASH_SECRET (32+ chars)');
if (!turnstileSecret && !challengeOff) misconfigured.push('TURNSTILE_SECRET_KEY');
if (!list('ALLOWED_ORIGINS').length) misconfigured.push('ALLOWED_ORIGINS');

Deno.serve((req) => {
  if (misconfigured.length) {
    console.error(`plops is missing configuration: ${misconfigured.join(', ')}`);
    return new Response(JSON.stringify({ ok: false, code: 'not_configured', message: 'Submissions are not configured on this server yet.' }), {
      status: 503,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': list('ALLOWED_ORIGINS').includes(req.headers.get('origin') ?? '') ? req.headers.get('origin')! : 'null',
      },
    });
  }
  return handle(req, {
    rpc: postgrestRpc(supabaseUrl, key),
    verifyChallenge: turnstileVerifier(turnstileSecret, list('TURNSTILE_HOSTNAMES')),
    hashSecret,
    allowedOrigins: list('ALLOWED_ORIGINS'),
    challengeRequired: !challengeOff,
    log: (m) => console.error(m),
  });
});
