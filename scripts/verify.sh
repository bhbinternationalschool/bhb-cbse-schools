#!/usr/bin/env bash
#
# Local stand-in for the CI merge gate.
#
# GitHub Actions cannot currently run on this repo — every workflow dies at
# startup with zero jobs — so nothing checks a change before it reaches main
# or production. This runs the same steps .github/workflows/ci.yml would, in
# one command, so a change can be verified without Actions.
#
#   npm run verify              typecheck, lint, self-tests, production build
#   SKIP_BUILD=1 npm run verify  everything except the build (~2 min faster)
#
# Unlike CI this does NOT run `npm ci` — it checks the tree you have rather
# than reinstalling from the lockfile. Run `npm ci` yourself if dependencies
# changed.
#
# Every step runs even after one fails, so a single pass shows you everything
# that is broken rather than only the first thing. Exits non-zero if any step
# failed.
#
# To run it automatically before every push:
#   printf '#!/bin/sh\nnpm run verify\n' > .git/hooks/pre-push
#   chmod +x .git/hooks/pre-push

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

CI_FILE=".github/workflows/ci.yml"
LOG_DIR="$(mktemp -d)"
trap 'rm -rf "$LOG_DIR"' EXIT

PASSED=0
FAILED=()

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
green() { printf '\033[32m%s\033[0m\n' "$1"; }
red() { printf '\033[31m%s\033[0m\n' "$1"; }

# run <label> <command...>
run() {
  local label="$1"
  shift
  local log="$LOG_DIR/$(printf '%s' "$label" | tr -c 'a-zA-Z0-9' '_').log"
  printf '  %-52s' "$label"
  if "$@" >"$log" 2>&1; then
    green "PASS"
    PASSED=$((PASSED + 1))
  else
    red "FAIL"
    FAILED+=("$label|$log")
  fi
}

# The self-tests CI runs, in CI's order. Kept in sync by the drift check below.
SELFTESTS=(
  test:session-cookie
  test:masters-write-guard
  test:masters-revision-guard
  test:masters-revision-lifecycle
  test:masters-cold-client
  test:masters-freeze
  test:session-year
  test:academic-year-resolve
  test:masters-read-failure
  test:save-full-cache
  test:sis-memory-fallback
  test:tenant-wipe-expiry
  test:data-contract
  test:projection
  test:read-client
  test:survey-photo
  test:partial-lead
  test:wire-payload
  test:projected-lead-write
  test:hydrate-failure-safety
  test:sis-revision
  test:sis-prune
  test:attendance-prune
  test:prune-floor
  test:sis-delete
  test:sis-guard-fallback
  test:audit-redaction
  test:student-filters
  test:masters-merge
  test:accounts
  test:playbook
  test:erp-chat
  test:wa-templates-automation
  test:fee-student-search
  test:substitution-auto
  test:timetable-substitution
  test:transport-sibling-gaps
  test:transport-stop-distance
  test:transport-start-month
  test:transport-misrouted
  test:transport-amend
  test:table-sort
  test:transport-fee-policy
  test:transport-nearest-stops
  test:transport-shortfall
  test:transport-afternoon-waves
  test:transport-boarding
  test:transport-crew-access
  test:transport-crew
  test:transport-stop-links
)

bold "Verifying $(git rev-parse --short HEAD 2>/dev/null || echo 'working tree') on $(git branch --show-current 2>/dev/null || echo '?')"
echo

bold "Static checks"
run "typecheck" npm run typecheck
run "lint" npm run lint
echo

bold "Self-tests"
for t in "${SELFTESTS[@]}"; do
  run "$t" npm run "$t" -w web
done
echo

if [ "${SKIP_BUILD:-}" = "1" ]; then
  bold "Production build — skipped (SKIP_BUILD=1)"
else
  bold "Production build"
  # Placeholder values, exactly as CI does: the build must not need real
  # secrets, and if it starts to, that itself is worth knowing.
  run "next build" env \
    NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder-anon-key \
    npm run build
fi
echo

# ── Ratchets: the patterns being retired may not regrow ────────────────
# The migration runs for months across 39 modules. Without this, the
# patterns removed in one module quietly reappear in another and the whole
# exercise nets to zero. See scripts/ratchets.txt.
if ! bash "$ROOT/scripts/check-ratchets.sh"; then
  FAILED+=("ratchets|")
fi
echo

# ── Drift check: this script must cover every self-test CI runs ────────
# A test added to CI but not here would give false confidence locally.
if [ -f "$CI_FILE" ]; then
  MISSING=()
  while read -r t; do
    [ -z "$t" ] && continue
    case " ${SELFTESTS[*]} " in
      *" $t "*) ;;
      *) MISSING+=("$t") ;;
    esac
  done < <(grep -oE 'npm run (test:[a-z0-9:-]+)' "$CI_FILE" | awk '{print $3}' | sort -u)

  if [ ${#MISSING[@]} -gt 0 ]; then
    red "Drift: $CI_FILE runs self-tests this script does not:"
    printf '  - %s\n' "${MISSING[@]}"
    echo "  Add them to SELFTESTS in scripts/verify.sh."
    FAILED+=("ci-drift|")
  fi
fi

# ── Summary ───────────────────────────────────────────────────────────
echo
if [ ${#FAILED[@]} -eq 0 ]; then
  green "All $PASSED checks passed."
  exit 0
fi

red "${#FAILED[@]} check(s) failed, $PASSED passed:"
for entry in "${FAILED[@]}"; do
  label="${entry%%|*}"
  log="${entry#*|}"
  echo
  bold "  ✗ $label"
  [ -n "$log" ] && [ -f "$log" ] && sed 's/^/    /' "$log" | tail -25
done
echo
exit 1
