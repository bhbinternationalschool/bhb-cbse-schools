#!/usr/bin/env bash
# Ratchet check — counts may only go down. See scripts/ratchets.txt.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/apps/web/src"
BUDGETS="$ROOT/scripts/ratchets.txt"

bold() { printf "\033[1m%s\033[0m\n" "$1"; }
pass() { printf "  %-46s \033[32m%s\033[0m\n" "$1" "$2"; }
fail() { printf "  %-46s \033[31m%s\033[0m\n" "$1" "$2"; }
note() { printf "  %-46s \033[33m%s\033[0m\n" "$1" "$2"; }

# Count matches in CODE, not in prose.
#
# The first run of this script failed because a comment in the new data layer
# *describes* the `void pushX()` pattern it replaces, and the counter matched
# the description. Documenting a bad pattern must not register as committing
# one, or the honest response is to stop writing the explanation.
code_grep() {
  local pattern="$1"
  shift
  grep -rnE "$pattern" "$@" 2>/dev/null \
    | grep -vE '^[^:]+:[0-9]+:[[:space:]]*(\*|//|#)' \
    | wc -l
}

# ── Data-layer rebuild ratchets (COMMAND.md step 1.6) ──────────────────────
#
# These count CALLS of the replica's loaders, so they need three things
# code_grep above does not give:
#
#   * an identifier boundary — `(^|[^A-Za-z0-9_$])name\(` — so `loadMasters(`
#     does not also match `loadMastersSafe(`/`reloadMasters(`, and `loadSis(`
#     does not match `loadSisForStaff(` (both suffixed names exist today; the
#     `\(` straight after the name already excludes the suffixed ones, the
#     boundary excludes any prefixed one). A member call such as
#     `mod.loadMasters(` (dynamic import) IS a call and IS counted;
#   * only .ts/.tsx, with `*.selftest.ts` excluded — the self-tests mostly
#     quote these names inside text-grep assertions, which are not calls;
#   * definition lines (`function loadMasters(`) excluded.
#
# Comment lines (`//`, `*`, `/*`, `#` at line start) are dropped as in code_grep.
# The pattern passed in must not contain a capturing group the caller relies on.
DL_BOUND='(^|[^A-Za-z0-9_$])'

# grep -n lines of real code matching $1 under $2.., selftests/definitions out.
dl_code_lines() {
  local pattern="$1" defname="$2"
  shift 2
  grep -rnE --include='*.ts' --include='*.tsx' "$pattern" "$@" 2>/dev/null \
    | grep -vE '^[^:]+\.selftest\.tsx?:' \
    | grep -vE '^[^:]+:[0-9]+:[[:space:]]*(\*|//|/\*|#)' \
    | grep -vE "^[^:]+:[0-9]+:.*function[[:space:]]+${defname}[[:space:]]*[(<]"
}

# FILE count: distinct files with at least one code line matching.
dl_files() {
  dl_code_lines "$@" | sed -E 's/^([^:]+):[0-9]+:.*$/\1/' | sort -u | wc -l
}

# OCCURRENCE count: every match on every code line (two calls on one line = 2).
dl_occurrences() {
  local pattern="$1"
  dl_code_lines "$@" | sed -E 's/^[^:]+:[0-9]+://' | grep -oE "$pattern" | wc -l
}

# Each metric's current count. Kept here rather than in the budget file so
# the pattern and its rationale live next to each other.
count_metric() {
  case "$1" in
    default_ay)
      code_grep 'DEFAULT_AY' "$SRC" ;;
    void_writes)
      code_grep 'void (push|flush|schedule)' "$SRC" ;;
    fake_success)
      grep -rln 'skipped: true' "$SRC/app/api" 2>/dev/null | wc -l ;;
    data_layer_localstorage)
      # The whole point of the layer is that the browser holds no truth.
      code_grep 'localStorage' "$SRC/lib/data" ;;
    unguarded_cache_writes)
      # A bare setItem on a module's whole state throws when the origin is
      # full, and on 2026-08-10 that aborted SIS hydration and rendered an
      # empty roster against a database holding 711 students. Every one of
      # these must go through writeCacheOrInvalidate, which never throws for
      # a full disk and drops the stale entry instead.
      code_grep '(window\.)?localStorage\.setItem\(STORAGE_KEY' "$SRC/lib" ;;
    data_layer_whole_state)
      # `body.state` / `{ state }` is the whole-module payload shape.
      code_grep 'body\.state|\{ state \}' "$SRC/lib/data" "$SRC/app/api/data" ;;
    grids_without_row_menu)
      # A grid is a file that renders rows; "no menu" is the absence of the
      # shared trigger. Public / parent / PWA surfaces are not office grids,
      # and printed sheets, dashboards and confirm dialogs are documents or
      # summaries, not operational lists — a row menu means nothing there.
      # NUL-delimited: the checkout path carries a space, and plain xargs
      # splits on it and greps a path that does not exist (counts 0).
      grep -lE 'ErpTableBody|<DataTable|<tbody' "$SRC"/components/*/*.tsx 2>/dev/null \
        | tr '\n' '\0' | xargs -0 grep -LE 'RowActionMenu|rowActions=|DeskListActions' 2>/dev/null \
        | tr '\n' '\0' | xargs -0 grep -L 'ratchet-allow: grids_without_row_menu' 2>/dev/null \
        | grep -vE '/components/(ui|pwa|public|parent|login|pay|theme|voice|maps)/' \
        | grep -vE '(Sheet|Page|Dashboard|Dialog)\.tsx$|ReportsCenterWorkspace|ModuleDashboard' \
        | wc -l ;;
    raw_hex)
      # Arbitrary hex Tailwind values instead of the design tokens in
      # globals.css — the "six different danger reds" problem. Falls per
      # module as the visual refit (docs/plans/woolly-riding-quail.md)
      # sweeps each screen; the design-token themselves are dark-mode
      # aware, arbitrary hex is not.
      code_grep '(bg|text|border|ring|from|to|via)-\[#[0-9a-fA-F]{3,8}\]' "$SRC" ;;
    personal_whatsapp)
      # Code that messages a parent, lead, vendor or staff member from the
      # STAFF MEMBER'S own WhatsApp instead of the school's Business number.
      #
      # Until 2026-09-07 thirteen web screens did, and the shared helper
      # openWaMe() was worse than the raw ones: it POSTed to /api/wa/dispatch
      # AND opened wa.me, so a family could get the same fee reminder twice,
      # from two senders, with only one of them on the school's record.
      #
      # Use openWaMe()/sendFromSchoolWhatsApp() from lib/waMe.ts. Not counted:
      # `wa.me/?text=` with no number (the share sheet), and links pointed AT
      # the school's own number (gate QR, visitor poster, "message a teacher"),
      # which are how a parent STARTS a conversation that then arrives through
      # the API. Mark a genuine exception with `personal-whatsapp-allow:`.
      python3 scripts/find-personal-whatsapp.py "$SRC" --count ;;
    unguarded_replace)
      # `.from("t").delete()` filtered by a PARENT id, followed by an insert or
      # upsert into the same table — two statements with nothing tying them
      # together. When the insert fails, the delete has already committed and
      # the parent is left with no children: a mark sheet with no marks, a
      # register with no attendance, a receipt with no fee lines.
      #
      # That is not a hypothetical. It emptied the whole fee book on
      # 2026-09-06 — 1,913 lines over 435 receipts, ₹20.8 lakh of collections
      # with no student, head or month — and took 134 receipts the same way on
      # 2026-09-01. Use lib/replaceChildRows.server.ts, which does both inside
      # one plpgsql function so a failed insert rolls the delete back.
      #
      # NOT counted: `delete().in("id", staleIds)` followed by an upsert of the
      # live set. That is a prune — it removes rows that are meant to go and
      # rewrites rows that already exist, so a failure loses nothing.
      python3 scripts/find-unguarded-replace.py "$SRC" --count ;;
    dynamic_public_env)
      # `process.env[expr]` with a NEXT_PUBLIC key is never inlined by Next
      # and reads undefined in the browser. On 2026-08-18 every
      # NEXT_PUBLIC_*_READ_FROM_DB / _DUAL_WRITE_DB client flag was inert for
      # that reason. All browser reads go through lib/deskPublicEnv.ts.
      code_grep 'process\.env\[[^]]*NEXT_PUBLIC' "$SRC" ;;
    white_on_white)
      # A field forced to `bg-white` whose text is `text-[var(--brand-deep)]`
      # with no dark: override is INVISIBLE in dark mode. --brand-deep inverts
      # (navy #203050 in light, #e4eaf7 in dark), so the token that keeps the
      # text dark on a white box in one theme turns it white on white in the
      # other.
      #
      # Found 2026-09-03 when the fee counter's Mode & account, reference and
      # amount boxes went unreadable. Four of them were introduced by the
      # raw_hex cleanup, which converted `text-[#203050]` to the token on the
      # reasoning that globals.css rescues that literal in dark mode — it
      # does, but the rescue selector is `.text-\[\#203050\]` and does NOT
      # match the !important variant these fields use.
      #
      # A deliberately-light control keeps the LITERAL, like a print sheet.
      # Only the !important form. Plain `bg-white` is rescued by globals.css
      # in dark mode (it flips to a dark surface), so those chips are fine and
      # were wrongly "fixed" once before this narrowed. `!bg-white` escapes the
      # rescue and stays white, which is what makes the token fatal there.
      grep -rn '!bg-white' --include='*.tsx' "$SRC" 2>/dev/null \
        | grep '!text-\[var(--brand-deep)\]' \
        | grep -vc 'dark:' ;;
    raw_table)
      # Hand-rolled <table> instead of ui/erp-roster.tsx's ErpTableShell —
      # no shared sticky header, zebra, density, or empty/skeleton states.
      #
      # Counts SCREEN tables only. Two kinds of file are exempt and must say so
      # with a `ratchet-allow: raw_table — <reason>` comment:
      #
      #   printed documents — ErpTableShell is theme-aware, and a receipt that
      #     followed dark mode would print white ink on white paper;
      #   files that never render a table — an HTML string written into a print
      #     popup, or a parser matching <table> in imported HTML.
      #
      # Without the exemption the target of 0 was unreachable by construction,
      # so the budget got raised instead of the pattern being removed. The
      # marker keeps every exemption greppable and justified at the site.
      grep -rl '<table' "$SRC" 2>/dev/null \
        | grep -vE 'ui/(erp-roster|data-table)\.tsx' \
        | xargs -I{} grep -L 'ratchet-allow: raw_table' "{}" 2>/dev/null \
        | wc -l ;;
    duplicate_migration_versions)
      # Two migration files sharing one numeric prefix. The prefix IS the
      # migration version: Supabase keys supabase_migrations.schema_migrations
      # on it, so on a fresh apply one file can be recorded as already-run and
      # skipped, and the sort order between the pair is arbitrary either way.
      # Counts distinct COLLIDING versions, not files.
      #
      # `ls <dir>` rather than `ls <dir>/*.sql | xargs basename`: the repo path
      # contains a space ("CBSE Schools"), and xargs splits on it, inventing
      # duplicates out of the path fragments. Listing the directory yields bare
      # filenames, which have no spaces.
      ls "$ROOT/supabase/migrations" 2>/dev/null \
        | grep '\.sql$' | sed 's/_.*//' | sort | uniq -d | wc -l ;;
    load_masters_screen_files)
      # FILES under components/ + app/(erp)/ that call loadMasters(). Each is a
      # screen reading the browser replica; Phase 2 moves them to useMasters().
      dl_files "${DL_BOUND}loadMasters\(" loadMasters "$SRC/components" "$SRC/app/(erp)" ;;
    load_sis_screen_files)
      # FILES under components/ + app/(erp)/ that call loadSis() (not
      # loadSisForStaff). Phase 3 moves them to the sis.students collection.
      dl_files "${DL_BOUND}loadSis\(" loadSis "$SRC/components" "$SRC/app/(erp)" ;;
    ensure_hydrated_component_files)
      # FILES under components/ that call any ensure<Desk>Hydrated(). The name
      # must end in exactly `Hydrated(` (ensure*HydratedServer is server-only
      # and lives in lib/ and app/api/, not here).
      dl_files "${DL_BOUND}ensure[A-Za-z]+Hydrated\(" 'ensure[A-Za-z]+Hydrated' "$SRC/components" ;;
    read_cache_files)
      # FILES anywhere in src that call readCache() (browserStorage.ts's
      # whole-desk localStorage read). The definition line itself is excluded;
      # browserStorage.ts still counts if it calls readCache internally.
      dl_files "${DL_BOUND}readCache\(" readCache "$SRC" ;;
    selftest_readfilesync_files)
      # *.selftest.ts FILES that call readFileSync — i.e. text-grep "tests"
      # that read source as a string instead of running behaviour (R7: lint,
      # not proof). Counted per FILE; comment lines ignored.
      find "$SRC" \( -name '*.selftest.ts' -o -name '*.selftest.tsx' \) -print0 2>/dev/null \
        | xargs -0 grep -nE "${DL_BOUND}readFileSync\(" /dev/null 2>/dev/null \
        | grep -vE '^[^:]+:[0-9]+:[[:space:]]*(\*|//|/\*|#)' \
        | sed -E 's/^([^:]+):[0-9]+:.*$/\1/' | sort -u | wc -l ;;
    v1_school_mirror_files)
      # FILES under app/api/v1 (the mobile API) that call
      # ensureSchoolMirrorHydrated() — every one rebuilds the whole school
      # replica inside a Cloud Run instance before answering. Phase 4 removes.
      dl_files "${DL_BOUND}ensureSchoolMirrorHydrated\(" ensureSchoolMirrorHydrated "$SRC/app/api/v1" ;;
    load_masters_calls_src)
      # OCCURRENCES of loadMasters( in ALL of src (selftests and the definition
      # excluded). The Phase 2.3b gate.
      dl_occurrences "${DL_BOUND}loadMasters\(" loadMasters "$SRC" ;;
    load_sis_calls_src)
      # OCCURRENCES of loadSis( in ALL of src (selftests and the definition
      # excluded; loadSisForStaff not counted). The Phase 3.4 gate.
      dl_occurrences "${DL_BOUND}loadSis\(" loadSis "$SRC" ;;
    nonbrowser_desk_get)
      # Data-layer step 3.0 (docs/data-layer-rebuild/COMMAND.md). Phase 3
      # gates the bulk desk GETs (/api/school-data/*, /api/data/*) to
      # per-screen browser use and Phase 6 deletes them, so nothing that is
      # NOT a signed-in browser tab may come to depend on them. On
      # 15 Oct 2026 the count was 0 everywhere a non-browser caller lives:
      # the Flutter app (calls /api/v1/* only), the office robot extension
      # (/api/v1/udise|propel/robot/* only), every script, CI workflow and
      # deploy file (Cloud Scheduler jobs are created by
      # scripts/setup-cloud-scheduler.sh and hit POST */tick routes), the
      # nightly BigQuery sync (reads Postgres directly through
      # postgresPool, never HTTP), and server code fetching its own
      # routes. Production logs agreed: no non-browser request of those
      # paths in the 30 days to 15 Oct. A new caller that needs a bulk read
      # gets an explicit service-only export route, not a browser desk route.
      # scripts/e2e* and apps/web/e2e are the local test stack, not callers.
      {
        grep -rnE 'api/(school-data|data)/' \
          "$ROOT/cbse_school_mobile/lib" "$ROOT/extensions" "$ROOT/scripts" \
          "$ROOT/apps/web/scripts" "$ROOT/.github/workflows" "$ROOT/deploy" \
          "$ROOT"/cloudbuild*.yaml "$SRC"/lib/bigQuery*.ts \
          "$SRC/app/api/analytics" 2>/dev/null \
          | grep -vE '/scripts/(e2e|check-ratchets\.sh|ratchets\.txt)'
        grep -rnE 'fetch\([^)]*api/(school-data|data)/' "$SRC/app/api" 2>/dev/null
        grep -rnE 'fetch\([^)]*api/(school-data|data)/' --include='*.server.ts' "$SRC" 2>/dev/null
      } | wc -l ;;
    fee_whole_desk_push)
      # Data-layer step 5.1a (docs/data-layer-rebuild/evidence/fees-inventory.md).
      # Every call that writes the WHOLE fee desk from a copy: the instance's
      # (pushFeesRemoteServer(loadFees()) after a webhook, the staff app's
      # collect, refunds, the bulk tools), the browser's (pushFeeDeskToDb from
      # the fees-vouchers POST) and the whole-year open-dues rebuild. Headers
      # are last-write-wins there, voided_at included. 12 on 15 Oct 2026;
      # 5.1b moves them to fee_voucher_write / fee_voucher_void, 5.1e leaves
      # only the manual rebuild route.
      # Call sites only: the three definitions and prose are not counted.
      grep -rnE '\b(pushFeesRemoteServer|pushFeeDeskToDb|rebuildFeeOpenDuesCache)\(' "$SRC" \
        --include='*.ts' --include='*.tsx' 2>/dev/null \
        | grep -vE '^[^:]+:[0-9]+:[[:space:]]*(\*|//|#)' \
        | grep -vE 'selftest|\.test\.|export (async )?function' \
        | wc -l ;;
    save_masters_call_sites)
      # Data-layer 2.2c. Call sites of saveMasters( — the whole-book Masters
      # save from a tab's copy — anywhere in src (definition, selftests and
      # comment lines excluded). 2.2c moved the Foundation panels, the
      # timetable's periods/week and the number series to element writes;
      # 2.2d/2.2e move the rest; 2.2f deletes saveMasters (budget 0).
      grep -rnE '\bsaveMasters\(' "$SRC" --include='*.ts' --include='*.tsx' 2>/dev/null \
        | grep -vE '^[^:]+:[0-9]+:[[:space:]]*(\*|//|#)' \
        | grep -vE 'selftest|\.test\.|export (async )?function saveMasters' \
        | wc -l ;;
    masters_desk_post)
      # Data-layer 2.2f. Browser code that POSTs to the old masters-desk
      # route (/api/school-data/masters-desk answers 410 for every body since
      # 2.2f): a code line naming the route with method POST within the next
      # six lines. The GET hydrate (method: "GET") is not counted. Target 0.
      grep -rnE -A6 'api/school-data/masters-desk' "$SRC" --include='*.ts' --include='*.tsx' 2>/dev/null \
        | grep -vE 'selftest|/app/api/school-data/masters-desk/' \
        | grep -vE '^[^:-]+[:-][0-9]+[:-][[:space:]]*(\*|//|#)' \
        | grep -cE 'method:[[:space:]]*["'"'"']POST' ;;
    hydrate_events)
      # Data-layer 2.3a. Code that raises or listens for the old hydrate
      # events — "bhb-masters-updated", "bhb-rbac-updated",
      # "bhb-desk-first-hydrated" (the quoted name on a code line; comments
      # and selftests excluded). React Query and the versions poll replace
      # them. Target 0.
      dl_occurrences '"bhb-(masters-updated|rbac-updated|desk-first-hydrated)"' __no_definition__ "$SRC" ;;
    *)
      echo "-1" ;;
  esac
}

bold "Ratchets"
status=0
tightenable=0

while IFS='|' read -r metric budget desc; do
  case "$metric" in ''|\#*) continue ;; esac
  metric="$(echo "$metric" | tr -d '[:space:]')"
  budget="$(echo "$budget" | tr -d '[:space:]')"

  actual="$(count_metric "$metric" | tr -d '[:space:]')"
  if [ "$actual" = "-1" ]; then
    fail "$metric" "UNKNOWN METRIC"
    status=1
    continue
  fi

  if [ "$actual" -gt "$budget" ]; then
    fail "$metric" "$actual > $budget"
    printf "      %s\n" "$desc"
    printf "      \033[31mThis pattern grew. Remove it, or justify raising the budget.\033[0m\n"
    status=1
  elif [ "$actual" -lt "$budget" ]; then
    note "$metric" "$actual (budget $budget)"
    printf "      Improved — lower the budget in scripts/ratchets.txt.\n"
    tightenable=1
  else
    pass "$metric" "$actual"
  fi
done < "$BUDGETS"

if [ "$tightenable" = "1" ]; then
  echo
  echo "  One or more counts improved. Tighten the budgets so they cannot regrow."
fi

exit "$status"
