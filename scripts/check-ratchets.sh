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
    raw_hex)
      # Arbitrary hex Tailwind values instead of the design tokens in
      # globals.css — the "six different danger reds" problem. Falls per
      # module as the visual refit (docs/plans/woolly-riding-quail.md)
      # sweeps each screen; the design-token themselves are dark-mode
      # aware, arbitrary hex is not.
      code_grep '(bg|text|border|ring|from|to|via)-\[#[0-9a-fA-F]{3,8}\]' "$SRC" ;;
    dynamic_public_env)
      # `process.env[expr]` with a NEXT_PUBLIC key is never inlined by Next
      # and reads undefined in the browser. On 2026-08-18 every
      # NEXT_PUBLIC_*_READ_FROM_DB / _DUAL_WRITE_DB client flag was inert for
      # that reason. All browser reads go through lib/deskPublicEnv.ts.
      code_grep 'process\.env\[[^]]*NEXT_PUBLIC' "$SRC" ;;
    raw_table)
      # Hand-rolled <table> instead of ui/erp-roster.tsx's ErpTableShell —
      # no shared sticky header, zebra, density, or empty/skeleton states.
      grep -rl '<table' "$SRC" 2>/dev/null \
        | grep -vE 'ui/(erp-roster|data-table)\.tsx' | wc -l ;;
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
