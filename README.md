# Playotic Plops

*Find a place worth plopping.* A mobile-first, crowdsourced bathroom finder for travelers: gas stations, travel centers and public rest areas, rated in **plops** (1–5). No accounts, no emails, no photos, no trackers.

- **Frontend:** React + TypeScript + Vite, MapLibre GL, hash routing. Static, hosted on GitHub Pages.
- **Backend:** Supabase Postgres (schema, RLS, functions) and one Supabase Edge Function (`plops`) for all writes.
- **Providers, all $0 with no credits or metered tokens:** OpenFreeMap tiles, Nominatim address search, FOSSGIS OSRM driving routes (all keyless OpenStreetMap services), Cloudflare Turnstile spam check (free, unlimited), Supabase Free plan, GitHub Pages.
- **Demo mode:** fictional stops in memory, clearly labelled. Used when no backend is configured. A build set to live mode never falls back to demo data; it shows a configuration error instead.

---

## Go live: the short checklist

1. **Supabase:** create a project → `supabase link` → `supabase db push` (applies the migration).
2. **Turnstile:** create a widget for `YOUR-USER.github.io` (and `localhost`) → note site key + secret key.
3. **Edge Function:** set secrets (`PLOPS_HASH_SECRET`, `ALLOWED_ORIGINS`, `TURNSTILE_SECRET_KEY`) → `supabase functions deploy plops --no-verify-jwt`.
4. **GitHub:** push the repo (public) → Settings → Pages → Source: **GitHub Actions** → Settings → Secrets and variables → Actions → **Variables**: `PLOPS_DATA_MODE=live`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_TURNSTILE_SITE_KEY` → re-run the workflow.
5. Open `https://YOUR-USER.github.io/REPO/`, add a test stop, rate it from a private window, then hide it with the moderation SQL below.

Details for each step follow.

---

## Local development

Requirements: Node 22+, npm. Optional: Deno 2 (to type-check the Edge Function), PostgreSQL 15+ (database tests), Supabase CLI (deployment).

```bash
npm install
npm run dev            # http://localhost:5173 — demo mode with fictional stops
```

Copy `.env.example` to `.env.local` to point a local build at a real project. Only public values belong in `VITE_*` variables.

Checks:

```bash
npm run typecheck
npm test               # unit + component tests (jsdom)
PLOPS_TEST_PG='postgres://postgres@localhost:5432/postgres' npm run test:db   # real migration on Postgres
npm run check:functions                                                        # deno check of the Edge Function
npm run build && npx playwright test   # browser tests of the demo build served under /playotic-plops/
```

Full live-mode browser test (uses `scripts/local-backend.mjs`, a **test-only** stand-in for Supabase that runs the real migration on local Postgres and the real Edge Function handler; Turnstile, Nominatim and the routing server are stubbed):

```bash
createdb plops_e2e && psql plops_e2e -f tests/db/supabase-roles.sql -f supabase/migrations/*.sql
VITE_DATA_MODE=live VITE_SUPABASE_URL=http://localhost:54321 VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_local \
  VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA npx vite build --outDir dist-live
PLOPS_E2E_LIVE=1 PLOPS_DB_URL='postgres://postgres@localhost/plops_e2e' npx playwright test
```

---

## Supabase setup

1. Create a project at supabase.com (free plan is fine to start).
2. Install the CLI and link:
   ```bash
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase db push        # applies supabase/migrations/20261108000001_playotic_plops.sql
   ```
   (Alternative: paste the migration file into the Dashboard SQL Editor and run it.)
3. In **Project Settings → API Keys**, copy the **publishable** key (`sb_publishable_…`) for the frontend. Do **not** use the secret key anywhere outside Supabase; the Edge Function receives it automatically.

What the migration creates:

| Thing | Exposed to visitors? |
|---|---|
| `private.stops`, `private.ratings`, `private.agreement_votes`, `private.reports`, `private.rate_events` | No. `private` schema is not exposed; RLS on, no policies, all grants revoked. |
| `public.stops_in_bbox`, `stops_in_boxes`, `stops_near`, `stop_detail` | Yes (execute granted to `anon`). Return only public columns; aggregates computed from visible rows. |
| `public.api_*` (create stop, rate, vote, report, my state, rate limit) | No. Execute granted to `service_role` only, i.e. the Edge Function. |
| `private.mod_*` helpers, `private.moderation_queue` view | Owner only (SQL Editor). |

Uniqueness is enforced by the database: one original rating per stop, one crowd rating per browser identity per stop (edits update it), one agreement vote per identity per stop, and creators cannot rate or vote on their own original. Concurrent duplicates are tested.

---

## Edge Function (`plops`)

All writes go through `supabase/functions/plops`. It validates input, checks the browser origin, verifies Turnstile server-side, applies rate limits per browser identity and per network bucket, then calls the service-only SQL functions.

```bash
cp supabase/functions/.env.example supabase/functions/.env   # fill in, never commit
#   PLOPS_HASH_SECRET   → openssl rand -base64 48
#   ALLOWED_ORIGINS     → https://YOUR-USER.github.io  (plus http://localhost:5173 if you develop locally)
#   TURNSTILE_SECRET_KEY → from Cloudflare
npx supabase secrets set --env-file supabase/functions/.env
npx supabase functions deploy plops --no-verify-jwt
```

`verify_jwt = false` is also set in `supabase/config.toml`: the browser sends the publishable key, which is not a JWT, and the function authorizes requests itself. If any required secret is missing the function returns `503 not_configured` instead of accepting writes.

Rate limits (in `core.ts`, `RATE_LIMITS`): new stops 5/day per identity and 15/day per network; ratings 30/hour and 60/hour; votes 60/hour and 150/hour; reports 10/day and 30/day.

---

## Cost: everything is $0

Checked against the providers' own pages in November 2026. Policies change; nothing here is a promise of permanent free hosting. None of these services meter usage in credits or tokens, and none needs a payment method.

| Service | What it does | Cost / account | Limits that matter |
|---|---|---|---|
| **GitHub Pages** | hosts the site | free for public repos | soft bandwidth limit |
| **Supabase Free plan** | database + Edge Function | free, no payment method needed | 500 MB database, 500,000 function calls/month, 5 GB egress. **Projects pause after about a week of low activity** (un-pause in the dashboard). Going over quota leads to restrictions (read-only, paused), not charges, as long as you stay on the Free plan. Don't upgrade or add a card. |
| **Cloudflare Turnstile** | spam check on submissions | free, unlimited challenges; needs a free Cloudflare account | 20 widgets per account |
| **OpenFreeMap** | map tiles | free, no key, no account | no stated limits, no SLA |
| **Nominatim** (nominatim.openstreetmap.org) | address search | free, no key, no account | **under 1 request/second for the whole app**, no autocomplete, attribution required |
| **FOSSGIS OSRM** (routing.openstreetmap.de) | driving routes and detour times | free, no key, no account | **max 1 request/second**, no heavy use; route requests are logged by the server |

How the app stays within the free services' rules: address search runs only when you press Search (no type-ahead), results are cached in memory, each browser spaces requests at least 1.1 seconds apart, at most 3 detours are checked automatically per route (more on tap), and attribution is shown beside results and on the map.

The honest catch: Nominatim's limit applies to all of your visitors combined, and the community servers can block heavy users. That's fine for a small project. If the site ever gets busy, switch search/routing with `VITE_GEO_PROVIDER` (Geoapify support is still built in: free daily credits, key required), or self-host Nominatim/OSRM. Browsing, ratings and the database keep working either way; only search and route planning depend on these services.

---

## GitHub Pages publishing

1. Push to a GitHub repository (any name). The workflow `.github/workflows/deploy.yml` runs typecheck, unit tests, database tests on a Postgres service, `deno check`, and Playwright tests of a subpath build, then builds and deploys.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
3. **Settings → Secrets and variables → Actions → Variables** (these are public values, so Variables is fine):
   - `PLOPS_DATA_MODE` = `live` (leave unset or `demo` for a demo site)
   - `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_TURNSTILE_SITE_KEY`
4. Re-run the workflow. The site is at `https://YOUR-USER.github.io/REPO/`.

Assets use relative paths and routes use hash URLs (`…/REPO/#/stop/<id>`), so the site works under any repository subpath and direct links/refreshes work. A Content-Security-Policy meta tag limits scripts and connections to the services above.

---

## Moderation (owner)

Use the Supabase Dashboard → **SQL Editor**:

```sql
select * from private.moderation_queue;                                   -- open reports (private)
select private.mod_hide_rating('RATING_ID', 'abusive comment');           -- hide one rating
select private.mod_restore_rating('RATING_ID');
select private.mod_hide_stop('STOP_ID', 'fake location');                 -- hide a stop entirely
select private.mod_mark_closed('STOP_ID', 'station closed');              -- keep, but mark closed
select private.mod_reopen_stop('STOP_ID');
select private.mod_move_stop('STOP_ID', 31.5501, -97.1402, 'pin fix');
select private.mod_hide_identity_of_rating('RATING_ID', 'spam burst');    -- hide everything from that identity
select private.mod_resolve_report('REPORT_ID', 'resolved', 'note');       -- or 'dismissed'
```

You can also edit `status` columns in **Table Editor** (schema `private`). Aggregates are computed on read from visible rows only, so hiding takes effect immediately everywhere. Nothing is removed automatically: disagreement is not a moderation verdict.

---

## Rating model

- **Original rating** — the first submitter's 1–5 plops, kept as submitted.
- **Agreement** — agree/disagree votes about the original rating only. They never change the crowd score.
- **Crowd rating** — mean of later independent ratings (original excluded), one decimal, always with its count. "No crowd ratings yet" when there are none; an "Early read" label under 5 ratings.

Criteria (cleanliness, stall privacy, key, food) keep "unknown" separate from "no" and show the latest visit that reported them, with its visit date and all-report tallies. Food never affects the score. Visit dates are separate from submission times.

## Privacy and abuse prevention

See the in-app Privacy page (`#/privacy`). In short: no accounts; a random browser token is created only at first contribution and only its keyed HMAC is stored; network addresses are kept only as daily-rotated keyed hashes for rate limiting and deleted within two days; no raw IPs in the database; precise route endpoints and location are never stored by the app. Browser-based limits can be bypassed by clearing storage or switching browsers — the app says so.

## Project layout

```
src/                     React app (pages/, components/, api/, geo/, demo/, lib/)
src/demo/fixtures.ts     fictional demo data (separate from everything else)
supabase/migrations/     schema, constraints, indexes, RLS, functions, grants, moderation helpers
supabase/functions/plops Edge Function (index.ts entry, core.ts handler, validate.ts)
tests/unit               unit + component tests       tests/db  migration tests on Postgres
tests/e2e                Playwright (demo + live)     scripts/  subpath server, test-only Supabase stand-in
```
