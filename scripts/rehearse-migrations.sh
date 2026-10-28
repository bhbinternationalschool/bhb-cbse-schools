#!/usr/bin/env bash
# Apply every migration to a throwaway Postgres 17, from empty.
#
# There is no staging environment: migrations go straight to production, and
# this is the safety net. It catches the class of fault production hides by
# construction — a migration that only works because of state an earlier,
# since-edited migration happened to leave behind. Prod has that state; a
# fresh database does not.
#
# This replays supabase/migrations/*.sql ONLY, and lists every failure rather
# than stopping at the first. As of 13 Oct 2026 two fail — a real gap, which
# is what this check is for: 20260910090000 and 20261002130000 alter tables
# that only the hand-applied supabase/migrations/adhoc-export files create.
# scripts/e2e-stack.sh replays the history production actually ran (both
# directories, in version order) and must apply clean.
#
# Usage:  bash scripts/rehearse-migrations.sh
# Leaves the cluster running for inspection; prints how to stop it.
set -euo pipefail

# Homebrew on macOS, the PGDG package on Linux; PGBIN overrides both.
if [ -z "${PGBIN:-}" ]; then
  for d in /opt/homebrew/opt/postgresql@17/bin /usr/local/opt/postgresql@17/bin /usr/lib/postgresql/17/bin; do
    [ -x "$d/pg_ctl" ] && { PGBIN="$d"; break; }
  done
fi
[ -n "${PGBIN:-}" ] || { echo "Postgres 17 not found — set PGBIN"; exit 1; }
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
# Just enough of hosted Supabase for these migrations to apply — shared with
# scripts/e2e-stack.sh, which also serves the result through PostgREST.
psql -q -v ON_ERROR_STOP=1 -f "$ROOT/scripts/supabase-shim.sql" >/dev/null

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
