# Verification environment

A second Supabase project used for running the app locally — clicking through
screens, driving the browser, checking a change actually works. Nothing here can
reach production, a parent, or a paid API.

## Why

On 2026-08-21 a dev server started with `apps/web/.env.local` — which points at
**production** — loaded `/transport` without a session. The desk API returned 401,
the client hydrated as empty, and the sync path treated the missing slices as
deletions. The live transport routes and assignments were hard-deleted.

The repo had no staging environment, so every local check ran against the school's
real data. This is that missing environment.

## The two projects

| | Project ref | Used by |
|---|---|---|
| Production | `ymamhlcrjsuilzdonkzl` | Cloud Run, `apps/web/.env.local` |
| Verification | `tmgtivjwelxgxajkcvmx` | `apps/web/.env.verify.local`, `npm run dev:verify` |

Both sit in the same Supabase org. The verification project is on the free tier.

## First-time setup

**1. Apply the schema.** Get the connection URI from the Supabase dashboard —
*BHB School — verification* → Project Settings → Database → Connection string →
URI — and run:

```bash
VERIFY_DB_URL='postgresql://postgres:<password>@db.tmgtivjwelxgxajkcvmx.supabase.co:5432/postgres' bash scripts/setup-verify-db.sh
```

The script refuses to run if the URL points anywhere other than the verification
project. Re-running is safe; only unapplied migrations are pushed.

**2. Paste the service-role key.** From the same dashboard, Project Settings →
API → `service_role`. Put it in `apps/web/.env.verify.local`:

```
SUPABASE_SERVICE_ROLE_KEY=<the verification project's service_role key>
```

`DATABASE_URL` and `DIRECT_URL` in that file are only needed if you exercise the
BigQuery sync or the direct Postgres pool; leave the placeholders otherwise.

## Running it

```bash
npm run dev:verify
```

Or start the `web-verify` configuration from `.claude/launch.json`.

`.env.verify.local` is loaded with `dotenv-cli -o`, so it overrides `.env.local`
rather than merging with it. To confirm which project a running server is talking
to, grep the served client bundle:

```bash
curl -s http://localhost:3000/login | grep -oE '/_next/static/chunks/[^"]+\.js' | sort -u | head -40 | xargs -I{} curl -s "http://localhost:3000{}" | grep -ohE 'https://[a-z0-9]{20}\.supabase\.co' | sort -u
```

It must print `tmgtivjwelxgxajkcvmx` and nothing else.

## What is deliberately broken here

`scripts/make-verify-env.py` regenerates `.env.verify.local` from `.env.local` and
blanks every outbound credential: WhatsApp token and secrets, VAPID push keys,
OpenAI / Gemini / Sarvam keys, BigQuery, Google OAuth and service-account
credentials, the cron and mirror secrets, Redis, and the Fleet Edge SOS number.
Features that depend on them will fail in this environment. That is the point —
a verification run must not be able to message a parent or spend credit.

`GOOGLE_MAPS_API_KEY` is kept, because stop geocoding and road distance are
read-only lookups that verification needs to exercise for real.

Regenerate after changing `.env.local`:

```bash
python3 scripts/make-verify-env.py
```

## Data

The verification project starts empty. Seed it through the app rather than copying
production data across — the production tables hold student names, guardian mobile
numbers and fee records, and there is no reason for a second copy of that to exist.

## Rule

Do not point a dev server at `.env.local` to check UI work. `.env.local` is
production. Use `npm run dev:verify`.
