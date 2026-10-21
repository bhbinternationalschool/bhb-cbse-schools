#!/usr/bin/env bash
# The local API stack the app's tests run against (data-layer step 1.0).
#
#   bash scripts/e2e-stack.sh up       throwaway Postgres 17 + every migration,
#                                      PostgREST, the /rest/v1 proxy, keys,
#                                      apps/web/.env.e2e, the seeded school
#   bash scripts/e2e-stack.sh build    next build with .env.e2e (NEXT_PUBLIC_*
#                                      values are baked in at build time)
#   bash scripts/e2e-stack.sh app      next start on 127.0.0.1:3700 (background)
#   bash scripts/e2e-stack.sh check    the acceptance checks (apps/web/e2e/acceptance.ts,
#                                      then e2e/versions.acceptance.ts — step 1.3,
#                                      then e2e/write-kernel.acceptance.ts — step 1.5,
#                                      then e2e/staff-kernel.acceptance.ts — step 2.2b,
#                                      then every e2e/v1-*.acceptance.ts — step 4.1)
#   bash scripts/e2e-stack.sh sql-test <file.sql>
#                                      run a behavioural SQL test (supabase/tests)
#                                      against the stack's database; it must roll
#                                      itself back and raise on any failed check
#   bash scripts/e2e-stack.sh status   what is running
#   bash scripts/e2e-stack.sh down     stop everything, delete the cluster and .env.e2e
#   bash scripts/e2e-stack.sh install-postgrest <dir>
#                                      Linux x86-64 only (CI): download the pinned
#                                      PostgREST release and verify its checksum
#
# No Docker and no Supabase CLI. The app reaches the database only through
# supabase-js over PostgREST (lib/supabase/server.ts, lib/serverTenant.ts), so
# a bare Postgres 17 with the Supabase shim (scripts/supabase-shim.sql), a
# PostgREST, and a 40-line proxy that strips /rest/v1 are the whole of what it
# needs. Auth / Storage / Functions answer 501 (scripts/e2e/proxy.mjs).
#
# Nothing here can reach production: every URL is 127.0.0.1, the keys are
# minted per run from a random secret, apps/web/.env.local is never read
# (scripts/e2e/with-env.mjs refuses to run beside one), and the seed and the
# check refuse any Supabase URL that is not 127.0.0.1.
#
# Env overrides: PGBIN (Postgres 17 bin dir), POSTGREST_BIN, E2E_STATE_DIR,
# E2E_API_PORT (default 54321 — fixed, because `build` bakes the URL in),
# E2E_APP_PORT (default 3700).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB="$ROOT/apps/web"
ENV_FILE="$WEB/.env.e2e"
STATE="${E2E_STATE_DIR:-${TMPDIR:-/tmp}/bhb-e2e-stack}"
API_PORT="${E2E_API_PORT:-54321}"
APP_PORT="${E2E_APP_PORT:-3700}"

# PostgREST, pinned. CI downloads exactly this; a local install of another
# version is refused (set E2E_ALLOW_POSTGREST_VERSION=1 to run it anyway).
POSTGREST_VERSION="16.4"
POSTGREST_LINUX_X64_SHA256="b47ecc82fce1dcebbbc4183d839e52f07f7630c9d7ad0f54db753d1939299354"

# Postgres refuses to start if the process went multithreaded during startup,
# which is what a non-C locale does on the macOS build (memory note
# erp-fresh-db-migration-rehearsal).
export LC_ALL=C LANG=C

say() { printf '%s\n' "e2e-stack: $*"; }
die() { printf '%s\n' "e2e-stack: $*" >&2; exit 1; }

port_busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
free_port() {
  local p="$1" last="$2"
  while port_busy "$p"; do
    p=$((p + 1)); [ "$p" -gt "$last" ] && die "no free port in $1-$last"
  done
  echo "$p"
}

find_pgbin() {
  if [ -n "${PGBIN:-}" ]; then echo "$PGBIN"; return; fi
  for d in /opt/homebrew/opt/postgresql@17/bin /usr/local/opt/postgresql@17/bin /usr/lib/postgresql/17/bin; do
    [ -x "$d/pg_ctl" ] && { echo "$d"; return; }
  done
  command -v pg_ctl >/dev/null 2>&1 && { dirname "$(command -v pg_ctl)"; return; }
  die "Postgres 17 not found — install it (macOS: brew install postgresql@17) or set PGBIN"
}

find_postgrest() {
  local bin="${POSTGREST_BIN:-$(command -v postgrest || true)}"
  [ -n "$bin" ] && [ -x "$bin" ] || die "postgrest not found — macOS: brew install postgrest; Linux: bash scripts/e2e-stack.sh install-postgrest <dir>, then POSTGREST_BIN=<dir>/postgrest"
  local v; v="$("$bin" --version 2>/dev/null | awk '{print $2}')"
  if [ "$v" != "$POSTGREST_VERSION" ]; then
    [ "${E2E_ALLOW_POSTGREST_VERSION:-}" = "1" ] || die "postgrest is $v, the stack is pinned to $POSTGREST_VERSION (E2E_ALLOW_POSTGREST_VERSION=1 to run it anyway)"
    say "WARNING: postgrest $v, pinned $POSTGREST_VERSION — running anyway (E2E_ALLOW_POSTGREST_VERSION=1)"
  fi
  echo "$bin"
}

# Wait until curl gets a 2xx from $1 (with optional header args), up to $2 s.
wait_http() {
  local url="$1" secs="$2"; shift 2
  local i=0
  until curl -sf -m 5 -o /dev/null "$@" "$url"; do
    i=$((i + 1)); [ "$i" -gt "$((secs * 2))" ] && return 1
    sleep 0.5
  done
}

pid_alive() { [ -f "$1" ] && kill -0 "$(cat "$1")" 2>/dev/null; }

# A pid and all its descendants (the app is with-env -> npx -> next -> workers).
tree_of() {
  local p="$1" c
  echo "$p"
  for c in $(pgrep -P "$p" 2>/dev/null || true); do tree_of "$c"; done
}

stop_pid() {
  local f="$1" name="$2"
  if pid_alive "$f"; then
    local pid pids p; pid="$(cat "$f")"
    pids="$(tree_of "$pid")"
    for p in $pids; do kill "$p" 2>/dev/null || true; done
    for _ in $(seq 1 40); do kill -0 "$pid" 2>/dev/null || break; sleep 0.25; done
    for p in $pids; do kill -9 "$p" 2>/dev/null || true; done
    say "stopped $name (pid $pid)"
  fi
  rm -f "$f"
}

# The migration set production actually ran: every file in supabase/migrations
# plus supabase/migrations/adhoc-export (23 migrations applied to production
# through the MCP tool on 9–11 Aug 2026 and exported afterwards — see its
# README), in version order. Without the export, 20260910090000 and
# 20261002130000 fail on a fresh database: they alter wa_contact_state and
# wa_message_delivery, which only the export creates.
#
# The export's seven *_zzz_* files are left out: they are data-only (insert /
# update / delete of production rows under production's tenant id — a
# self-test household and its clean-up), with no schema in them.
migration_files() {
  { ls "$ROOT"/supabase/migrations/*.sql; ls "$ROOT"/supabase/migrations/adhoc-export/*.sql; } \
    | grep -v '_zzz_' \
    | awk -F/ '{print $NF "\t" $0}' | sort | cut -f2
}

write_env_file() {
  local anon="$1" service="$2"
  {
    echo "# Written by scripts/e2e-stack.sh up — the LOCAL test stack only. Never commit;"
    echo "# never copy a value from here into another environment. Keys die with the stack."
    echo "NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:$API_PORT"
    echo "NEXT_PUBLIC_SUPABASE_ANON_KEY=$anon"
    echo "SUPABASE_SERVICE_ROLE_KEY=$service"
    echo "APP_SESSION_SECRET=e2e-secret"
    echo "E2E=1"
    echo "E2E_APP_URL=http://127.0.0.1:$APP_PORT"
    echo "NEXT_PUBLIC_DEMO_AUTH=false"
    echo "NEXT_PUBLIC_TENANT_SLUG=bhb-international"
    echo "# The class gallery's AI check answers \"hold\" here (lib/classGalleryReview.server.ts"
    echo "# honours it only with E2E=1 and a 127.0.0.1 Supabase URL) — never Gemini."
    echo "CLASS_GALLERY_AI_STUB=hold"
    echo "# Every desk-cutover flag production runs with (deploy/desk-cutover-runtime.env)."
    grep -E '^[A-Z0-9_]+_(READ_FROM_DB|DUAL_WRITE_DB)=' "$ROOT/deploy/desk-cutover-runtime.env"
  } >"$ENV_FILE"
  chmod 600 "$ENV_FILE"
}

in_web() { (cd "$WEB" && node "$ROOT/scripts/e2e/with-env.mjs" .env.e2e -- "$@"); }

cmd_up() {
  [ -d "$STATE" ] && { say "a stack state dir exists — taking it down first"; cmd_down; }
  local pgbin pgrst
  pgbin="$(find_pgbin)"
  "$pgbin/postgres" --version | grep -q ' 17\.' || die "$pgbin/postgres is not Postgres 17: $("$pgbin/postgres" --version)"
  pgrst="$(find_postgrest)"
  command -v node >/dev/null || die "node not found"
  command -v curl >/dev/null || die "curl not found"
  port_busy "$API_PORT" && die "port $API_PORT is in use — the API URL is baked into builds, so it is fixed (E2E_API_PORT to change it, then rebuild)"

  mkdir -p "$STATE"
  echo "$pgbin" >"$STATE/pgbin"
  local pg_port pgrst_port
  pg_port="$(free_port 55440 55500)"
  pgrst_port="$(free_port 54330 54399)"
  echo "$pg_port" >"$STATE/pg_port"

  say "Postgres: $("$pgbin/postgres" --version) on 127.0.0.1:$pg_port"
  "$pgbin/initdb" -D "$STATE/pg" -U postgres --no-sync -A trust -E UTF8 >"$STATE/initdb.log" 2>&1 \
    || { cat "$STATE/initdb.log"; die "initdb failed"; }
  # -k /tmp: a socket path under a sandboxed TMPDIR exceeds the 103-byte limit
  # on a Unix-domain socket and the server will not start.
  "$pgbin/pg_ctl" -D "$STATE/pg" -w -t 60 \
    -o "-p $pg_port -k /tmp -c listen_addresses=127.0.0.1 -c fsync=off" \
    -l "$STATE/pg.log" start >/dev/null || { tail -20 "$STATE/pg.log"; die "postgres did not start"; }

  local psql=("$pgbin/psql" -X -q -h 127.0.0.1 -p "$pg_port" -U postgres -d postgres -v ON_ERROR_STOP=1)
  "${psql[@]}" -f "$ROOT/scripts/supabase-shim.sql" >"$STATE/shim.log" 2>&1 || { cat "$STATE/shim.log"; die "shim failed"; }
  # Supabase's role timeouts. The SIS push comment (lib/sisNormalized.server.ts)
  # records production's authenticator at 8 s; anon 3 s / authenticated 8 s are
  # the platform defaults. A test that is slow in production is slow here too.
  "${psql[@]}" -c "alter role authenticator set statement_timeout = '8s'; alter role anon set statement_timeout = '3s'; alter role authenticated set statement_timeout = '8s';" >/dev/null

  local n=0 f
  while IFS= read -r f; do
    if ! "${psql[@]}" -1 -f "$f" >>"$STATE/migrations.log" 2>&1; then
      tail -15 "$STATE/migrations.log" >&2
      die "migration failed after $n applied: ${f#"$ROOT"/} (full log: $STATE/migrations.log)"
    fi
    n=$((n + 1))
  done < <(migration_files)
  say "migrations: $n applied, 0 failed"

  node "$ROOT/scripts/e2e/mint-keys.mjs" >"$STATE/keys.json"
  chmod 600 "$STATE/keys.json"
  local secret anon service
  secret="$(node -e 'process.stdout.write(require(process.argv[1]).jwtSecret)' "$STATE/keys.json")"
  anon="$(node -e 'process.stdout.write(require(process.argv[1]).anonKey)' "$STATE/keys.json")"
  service="$(node -e 'process.stdout.write(require(process.argv[1]).serviceRoleKey)' "$STATE/keys.json")"

  # PostgREST's port is checked free, then bound a moment later. 54330-54399
  # lies inside Linux's ephemeral range (32768-60999): any outgoing
  # connection — the migration psql sessions included — can be holding that
  # local port, and a connect() probe cannot see it, so the bind fails with
  # "Address in use" (CI, 15 Oct 2026, twice on one PR). Start on the next
  # free port instead of failing the run.
  local attempt
  for attempt in 1 2 3 4 5; do
    cat >"$STATE/postgrest.conf" <<CONF
db-uri = "postgres://authenticator@127.0.0.1:$pg_port/postgres"
db-schemas = "public"
db-anon-role = "anon"
db-extra-search-path = "public, extensions"
# Supabase's default: 1,000 rows per request (memory note erp-db-reads-must-page).
db-max-rows = 1000
db-pool = 10
db-channel-enabled = false
jwt-secret = "$secret"
server-host = "127.0.0.1"
server-port = $pgrst_port
log-level = "error"
CONF
    chmod 600 "$STATE/postgrest.conf"
    nohup "$pgrst" "$STATE/postgrest.conf" >"$STATE/postgrest.log" 2>&1 </dev/null &
    echo $! >"$STATE/postgrest.pid"
    # Up, or exited: a PostgREST that cannot bind exits at once, so do not
    # wait the full minute for an answer that cannot come.
    local up=0 j=0
    while [ "$j" -lt 120 ]; do
      if curl -sf -m 5 -o /dev/null -H "Authorization: Bearer $service" \
        "http://127.0.0.1:$pgrst_port/tenants?select=id&limit=1"; then up=1; break; fi
      pid_alive "$STATE/postgrest.pid" || break
      j=$((j + 1)); sleep 0.5
    done
    [ "$up" = 1 ] && break
    # "Address in use" (Linux) / "Address already in use" (macOS) /
    # "resource busy": the bind lost the race; any other failure is real.
    if grep -qiE "address (already )?in use|resource busy" "$STATE/postgrest.log" && [ "$attempt" -lt 5 ]; then
      say "PostgREST port $pgrst_port was taken between the check and the bind — trying the next one"
      stop_pid "$STATE/postgrest.pid" postgrest
      pgrst_port="$(free_port $((pgrst_port + 1)) 54399)"
      continue
    fi
    tail -20 "$STATE/postgrest.log"; die "postgrest did not come up"
  done
  say "PostgREST $POSTGREST_VERSION on 127.0.0.1:$pgrst_port"

  E2E_PROXY_PORT="$API_PORT" E2E_POSTGREST_URL="http://127.0.0.1:$pgrst_port" E2E_SERVICE_KEY="$service" \
    nohup node "$ROOT/scripts/e2e/proxy.mjs" >"$STATE/proxy.log" 2>&1 </dev/null &
  echo $! >"$STATE/proxy.pid"
  wait_http "http://127.0.0.1:$API_PORT/rest/v1/tenants?select=id&limit=1" 30 \
    -H "apikey: $service" -H "Authorization: Bearer $service" || { tail -20 "$STATE/proxy.log"; die "proxy did not come up"; }
  say "API (proxy) on http://127.0.0.1:$API_PORT/rest/v1"

  write_env_file "$anon" "$service"
  say "wrote ${ENV_FILE#"$ROOT"/}"

  say "seeding (apps/web/e2e/seed.ts through the app's own write paths)"
  in_web npx --yes tsx "$ROOT/scripts/e2e-seed.ts"

  smoke "$service"
  say "up. Next: bash scripts/e2e-stack.sh build && bash scripts/e2e-stack.sh app && bash scripts/e2e-stack.sh check"
}

# Through the proxy, with the service key: the tenant, and the classes slice.
smoke() {
  local service="$1" base="http://127.0.0.1:$API_PORT/rest/v1"
  local h=(-H "apikey: $service" -H "Authorization: Bearer $service")
  local tenant classes
  tenant="$(curl -sf "${h[@]}" "$base/tenants?slug=eq.bhb-international&select=id,slug")" || die "smoke: tenants read failed"
  classes="$(curl -sf "${h[@]}" "$base/masters_desk_slices?slice_key=eq.classes&select=payload")" || die "smoke: masters_desk_slices read failed"
  node -e '
    const t = JSON.parse(process.argv[1]); const c = JSON.parse(process.argv[2]);
    if (t.length !== 1 || t[0].slug !== "bhb-international") { console.error("smoke: tenant missing", t); process.exit(1); }
    const n = Array.isArray(c[0]?.payload) ? c[0].payload.length : -1;
    console.log(`e2e-stack: smoke via proxy: tenant ${t[0].slug} (${t[0].id}), masters_desk_slices.classes = ${n} classes`);
    if (n !== 15) process.exit(1);
  ' "$tenant" "$classes" || die "smoke failed"
}

cmd_build() {
  [ -f "$ENV_FILE" ] || die "no .env.e2e — run up first"
  say "next build with .env.e2e (NEXT_PUBLIC_* are baked into the build)"
  NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=6144}" in_web npx next build
}

cmd_app() {
  [ -f "$ENV_FILE" ] || die "no .env.e2e — run up first"
  [ -f "$WEB/.next/BUILD_ID" ] || die "no build at apps/web/.next — run build first"
  pid_alive "$STATE/app.pid" && die "app already running (pid $(cat "$STATE/app.pid"))"
  port_busy "$APP_PORT" && die "port $APP_PORT is in use"
  # cd first, on its own: `cd && nohup … &` would background the whole AND-list
  # as a subshell that waits on node — and holds this script's stdout open.
  (
    cd "$WEB"
    nohup node "$ROOT/scripts/e2e/with-env.mjs" .env.e2e -- \
      npx next start -p "$APP_PORT" -H 127.0.0.1 >"$STATE/app.log" 2>&1 </dev/null &
    echo $! >"$STATE/app.pid"
  )
  wait_http "http://127.0.0.1:$APP_PORT/api/app-version" 90 || { tail -30 "$STATE/app.log"; die "app did not answer /api/app-version"; }
  say "app on http://127.0.0.1:$APP_PORT (log: $STATE/app.log)"
}

cmd_check() {
  [ -f "$ENV_FILE" ] || die "no .env.e2e — run up first"
  in_web npx --yes tsx e2e/acceptance.ts
  # data-layer 1.3: erp_versions, GET /api/data/views/versions, the server
  # reference cache. It reads the app's log to count reference-cache rebuilds.
  in_web npx --yes tsx e2e/versions.acceptance.ts "$STATE/app.log"
  # data-layer 1.5: the write kernel through the running app (refusals,
  # teacher reach, slice and object writes, erp_versions moving). Puts back
  # everything it changes.
  in_web npx --yes tsx e2e/write-kernel.acceptance.ts
  # data-layer 2.2b: staff records through the kernel, the protected staff
  # fields, removed staff hidden by every reader, the old staff-roster route's
  # guard and soft DELETE, a teacher's own-class class subjects. Puts back
  # everything it changes.
  in_web npx --yes tsx e2e/staff-kernel.acceptance.ts
  # data-layer 4.1: the mobile API's per-person routes, one file per converted
  # route (e2e/v1-*.acceptance.ts). Each seeds what it reads, reads the app's
  # log in $STATE, briefly revokes a table's SELECT to prove a failed read is
  # a 503, and removes what it wrote.
  local f
  for f in "$WEB"/e2e/v1-*.acceptance.ts; do
    [ -f "$f" ] || continue
    in_web npx --yes tsx "e2e/$(basename "$f")" "$STATE"
  done
}

cmd_status() {
  if [ ! -d "$STATE" ]; then say "down (no state at $STATE)"; return; fi
  say "state: $STATE"
  for p in postgrest proxy app; do
    if pid_alive "$STATE/$p.pid"; then say "  $p: running (pid $(cat "$STATE/$p.pid"))"; else say "  $p: not running"; fi
  done
  if [ -f "$STATE/pgbin" ] && "$(cat "$STATE/pgbin")/pg_ctl" -D "$STATE/pg" status >/dev/null 2>&1; then
    say "  postgres: running on 127.0.0.1:$(cat "$STATE/pg_port")"
  else
    say "  postgres: not running"
  fi
  [ -f "$ENV_FILE" ] && say "  env: ${ENV_FILE#"$ROOT"/}" || say "  env: none"
}

cmd_sql_test() {
  local file="${1:-}"
  [ -n "$file" ] && [ -f "$file" ] || die "usage: sql-test <file.sql>"
  [ -f "$STATE/pg_port" ] && [ -f "$STATE/pgbin" ] || die "no stack is up (bash scripts/e2e-stack.sh up)"
  say "sql-test: ${file#"$ROOT"/}"
  "$(cat "$STATE/pgbin")/psql" -X -q -h 127.0.0.1 -p "$(cat "$STATE/pg_port")" -U postgres -d postgres \
    -v ON_ERROR_STOP=1 -f "$file"
}

cmd_down() {
  stop_pid "$STATE/app.pid" app
  stop_pid "$STATE/proxy.pid" proxy
  stop_pid "$STATE/postgrest.pid" postgrest
  if [ -f "$STATE/pgbin" ] && [ -d "$STATE/pg" ]; then
    "$(cat "$STATE/pgbin")/pg_ctl" -D "$STATE/pg" -m fast -w stop >/dev/null 2>&1 && say "stopped postgres" || true
  fi
  rm -rf "$STATE"
  rm -f "$ENV_FILE"
  say "down: cluster, processes and .env.e2e removed"
}

cmd_install_postgrest() {
  local dir="${1:-}"
  [ -n "$dir" ] || die "usage: install-postgrest <empty dir>"
  [ "$(uname -s)-$(uname -m)" = "Linux-x86_64" ] || die "install-postgrest is for Linux x86-64 (CI); on macOS: brew install postgrest"
  mkdir -p "$dir"
  local tar="postgrest-v$POSTGREST_VERSION-linux-static-x86-64.tar.xz"
  curl -fsSL -o "$dir/$tar" "https://github.com/PostgREST/postgrest/releases/download/v$POSTGREST_VERSION/$tar"
  echo "$POSTGREST_LINUX_X64_SHA256  $dir/$tar" | sha256sum -c - || die "checksum mismatch for $tar — refusing"
  tar -xJf "$dir/$tar" -C "$dir"
  rm -f "$dir/$tar"
  "$dir/postgrest" --version
}

case "${1:-}" in
  up) cmd_up ;;
  build) cmd_build ;;
  app) cmd_app ;;
  check) cmd_check ;;
  status) cmd_status ;;
  sql-test) cmd_sql_test "${2:-}" ;;
  down) cmd_down ;;
  install-postgrest) cmd_install_postgrest "${2:-}" ;;
  *) sed -n '2,15p' "$0"; exit 2 ;;
esac
