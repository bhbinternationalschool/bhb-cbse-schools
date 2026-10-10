#!/usr/bin/env bash
# Apply every migration to a throwaway Postgres 17, from empty.
#
# There is no staging environment: migrations go straight to production, and
# this is the safety net. It catches the class of fault production hides by
# construction — a migration that only works because of state an earlier,
# since-edited migration happened to leave behind. Prod has that state; a
# fresh database does not.
#
# Usage:  bash scripts/rehearse-migrations.sh
# Leaves the cluster running for inspection; prints how to stop it.
set -euo pipefail

PGBIN="${PGBIN:-/opt/homebrew/opt/postgresql@17/bin}"
PORT="${PORT:-55437}"

# Walk to a free port rather than failing on a cluster someone left running
# — including one of ours from an earlier run.
while nc -z 127.0.0.1 "$PORT" 2>/dev/null; do
  PORT=$((PORT+1))
  [ "$PORT" -gt 55500 ] && { echo "no free port in 55437-55500"; exit 1; }
done
DATA="${DATA:-${TMPDIR:-/tmp}/erp-rehearsal-pg}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Postgres refuses to start if the process went multithreaded during startup,
# which is what a non-C locale does on this macOS build.
export LC_ALL=C LANG=C

"$PGBIN/pg_ctl" -D "$DATA" stop >/dev/null 2>&1 || true
rm -rf "$DATA"
"$PGBIN/initdb" -D "$DATA" -U postgres --no-sync -A trust >/dev/null
# -k /tmp: the default socket path under a sandboxed TMPDIR exceeds the
# 103-byte limit on a Unix-domain socket and the server will not start.
"$PGBIN/pg_ctl" -D "$DATA" \
  -o "-p $PORT -k /tmp -c listen_addresses=127.0.0.1" \
  -l "$DATA/pg.log" start >/dev/null
trap 'echo; echo "cluster still running on port '"$PORT"' — stop it with:"; echo "  $PGBIN/pg_ctl -D $DATA stop"' EXIT

psql() { "$PGBIN/psql" -h 127.0.0.1 -p "$PORT" -U postgres "$@"; }

# ── The shim ──────────────────────────────────────────────────────────────
# Just enough of hosted Supabase for these migrations to apply. Kept minimal
# on purpose: every object here is one the migrations genuinely reference,
# so the list doubles as an inventory of what we depend on the platform for.
psql -q -v ON_ERROR_STOP=1 <<'SQL'
create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";

do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon')
    then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated')
    then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='service_role')
    then create role service_role nologin noinherit bypassrls; end if;
end $$;

create schema if not exists auth;
create schema if not exists storage;
create schema if not exists extensions;

-- auth.uid() is the pivot of nearly every RLS policy in this project.
create or replace function auth.uid() returns uuid language sql stable as
  $fn$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $fn$;
create or replace function auth.role() returns text language sql stable as
  $fn$ select nullif(current_setting('request.jwt.claim.role', true), '') $fn$;
create or replace function auth.jwt() returns jsonb language sql stable as
  $fn$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $fn$;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text, raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);
create table if not exists storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[],
  created_at timestamptz default now()
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text, owner uuid, metadata jsonb,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create or replace function storage.foldername(name text) returns text[]
  language sql immutable as $fn$ select string_to_array(name, '/') $fn$;

grant usage on schema public, auth, storage, extensions
  to anon, authenticated, service_role;
SQL

# ── The replay ────────────────────────────────────────────────────────────
ok=0; fail=0; failed=()
for f in "$ROOT"/supabase/migrations/*.sql; do
  if psql -q -v ON_ERROR_STOP=1 -f "$f" >>"$DATA/apply.log" 2>&1; then
    ok=$((ok+1))
  else
    fail=$((fail+1)); failed+=("$(basename "$f")")
  fi
done

echo "applied: $ok   failed: $fail   (of $((ok+fail)))"
if [ "$fail" -gt 0 ]; then
  printf '  ✗ %s\n' "${failed[@]}"
  echo "full output: $DATA/apply.log"
  exit 1
fi
echo "all migrations apply clean from empty."
