#!/usr/bin/env bash
#
# Reclaim disk space by deleting regenerable build caches.
#
# The tracked project is ~66 MB. What actually fills a laptop is the stuff
# git already ignores: node_modules for 603 npm packages across three
# workspaces, the Next.js build cache, and the Flutter/Xcode/Gradle output
# for 178 pub packages. None of it is source. All of it comes back from
# `npm install` and `flutter pub get`.
#
#   npm run reclaim               report sizes, confirm, delete project caches
#   npm run reclaim -- --dry-run  report only, delete nothing
#   npm run reclaim -- --yes      skip the confirmation prompt
#   npm run reclaim -- --global   also clear shared toolchain caches (~/…)
#
# Rebuild after running:
#   npm install
#   cd cbse_school_mobile && flutter pub get
#
# SAFETY. Several gitignored files in this tree are irreplaceable, most of
# all the Play Store signing key — lose android/key.properties or the .jks
# it points at and this app can never be updated on Play again. So this
# script does not glob and does not delete "everything ignored". It deletes
# an explicit list of known-regenerable paths, refuses any path git tracks,
# and hard-refuses the protected paths below even if one is ever added to
# the list by mistake.

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
green() { printf '\033[32m%s\033[0m\n' "$1"; }
red() { printf '\033[31m%s\033[0m\n' "$1"; }
dim() { printf '\033[2m%s\033[0m\n' "$1"; }

DRY_RUN=0
ASSUME_YES=0
DO_GLOBAL=0

for arg in "$@"; do
  case "$arg" in
    --dry-run|-n) DRY_RUN=1 ;;
    --yes|-y) ASSUME_YES=1 ;;
    --global|-g) DO_GLOBAL=1 ;;
    --help|-h)
      awk 'NR>1 { if ($0 !~ /^#/) exit; sub(/^# ?/, ""); print }' "$0"
      exit 0
      ;;
    *)
      red "Unknown option: $arg"
      echo "Try: bash scripts/reclaim-space.sh --help"
      exit 2
      ;;
  esac
done

# ── Regenerable project caches ────────────────────────────────────────
# Every entry must be reproducible by `npm install` or `flutter pub get`.
# Nothing here may be a source file, a secret, or a signing input.
PROJECT_TARGETS=(
  "node_modules"
  "apps/web/node_modules"
  "packages/time/node_modules"
  "deploy/vercel-proxy/node_modules"
  "apps/web/.next"
  "apps/web/out"
  "apps/web/coverage"
  "apps/web/tsconfig.tsbuildinfo"
  "tsconfig.tsbuildinfo"
  "cbse_school_mobile/build"
  "cbse_school_mobile/.dart_tool"
  "cbse_school_mobile/coverage"
  "cbse_school_mobile/ios/Pods"
  "cbse_school_mobile/ios/.symlinks"
  "cbse_school_mobile/android/.gradle"
  "cbse_school_mobile/android/.kotlin"
  "cbse_school_mobile/android/app/.cxx"
  "cbse_school_mobile/android/app/build"
  "cbse_school_mobile/play-store-assets/app-release.aab"
  "supabase/.temp"
)

# ── Never delete, under any circumstances ─────────────────────────────
# Gitignored, so the tracked-file guard below would not catch them, and
# not regenerable by any command. Losing one costs a release or a secret.
PROTECTED=(
  "cbse_school_mobile/android/key.properties"
  "cbse_school_mobile/android/local.properties"
  ".env"
  ".env.local"
  "apps/web/.env.local"
)

is_protected() {
  local candidate="$1" p
  for p in "${PROTECTED[@]}"; do
    [ "$candidate" = "$p" ] && return 0
    case "$candidate" in "$p"/*) return 0 ;; esac
  done
  case "$candidate" in
    *.jks|*.keystore|*.pem|*key.properties) return 0 ;;
  esac
  return 1
}

# A path git tracks is source, never a cache. Matches if anything inside
# a directory is tracked, which is what we want.
is_tracked() {
  git ls-files --error-unmatch -- "$1" >/dev/null 2>&1
}

size_kb() { du -sk "$1" 2>/dev/null | awk '{print $1}'; }

human() {
  awk -v k="${1:-0}" 'BEGIN {
    if (k <= 0) { printf "0 KB" }
    else if (k < 1024) { printf "%d KB", k }
    else if (k < 1048576) { printf "%.1f MB", k / 1024 }
    else { printf "%.2f GB", k / 1048576 }
  }'
}

# ── Survey ────────────────────────────────────────────────────────────
FOUND=()
FOUND_KB=()
TOTAL_KB=0

for target in "${PROJECT_TARGETS[@]}"; do
  [ -e "$target" ] || continue

  if is_protected "$target"; then
    red "  refusing protected path: $target"
    continue
  fi

  if is_tracked "$target"; then
    red "  skipping (tracked by git): $target"
    continue
  fi

  kb="$(size_kb "$target")"
  [ -z "$kb" ] && continue
  FOUND+=("$target")
  FOUND_KB+=("$kb")
  TOTAL_KB=$((TOTAL_KB + kb))
done

bold "Project caches in $ROOT"
if [ ${#FOUND[@]} -eq 0 ]; then
  echo "  Nothing to reclaim — already clean."
else
  for i in "${!FOUND[@]}"; do
    printf '  %-52s %10s\n' "${FOUND[$i]}" "$(human "${FOUND_KB[$i]}")"
  done
  printf '  %-52s %10s\n' "" "----------"
  printf '  %-52s %10s\n' "total" "$(human "$TOTAL_KB")"
fi

# ── Shared toolchain caches (opt-in) ──────────────────────────────────
# Outside the repo and shared with every other project on the machine.
# Deleting them is safe but re-downloading is slower, so it is opt-in.
#
# Deliberately narrow: ~/.gradle/caches, not ~/.gradle (which holds
# gradle.properties, where signing credentials often live), and
# ~/.pub-cache/hosted, not ~/.pub-cache (whose bin/ holds globally
# activated dart executables).
GLOBAL_TARGETS=()
if [ "$DO_GLOBAL" -eq 1 ]; then
  GLOBAL_TARGETS=(
    "$HOME/.gradle/caches"
    "$HOME/.pub-cache/hosted"
    "$HOME/.pub-cache/git"
  )
  if [ "$(uname -s)" = "Darwin" ]; then
    GLOBAL_TARGETS+=(
      "$HOME/Library/Developer/Xcode/DerivedData"
      "$HOME/Library/Caches/CocoaPods"
    )
  fi

  GFOUND=()
  GFOUND_KB=()
  GTOTAL_KB=0
  for target in "${GLOBAL_TARGETS[@]}"; do
    [ -e "$target" ] || continue
    kb="$(size_kb "$target")"
    [ -z "$kb" ] && continue
    GFOUND+=("$target")
    GFOUND_KB+=("$kb")
    GTOTAL_KB=$((GTOTAL_KB + kb))
  done

  echo
  bold "Shared toolchain caches (--global)"
  if [ ${#GFOUND[@]} -eq 0 ]; then
    echo "  Nothing to reclaim."
  else
    for i in "${!GFOUND[@]}"; do
      printf '  %-52s %10s\n' "${GFOUND[$i]/#$HOME/\~}" "$(human "${GFOUND_KB[$i]}")"
    done
    printf '  %-52s %10s\n' "" "----------"
    printf '  %-52s %10s\n' "total" "$(human "$GTOTAL_KB")"
  fi
  TOTAL_KB=$((TOTAL_KB + GTOTAL_KB))
  [ ${#GFOUND[@]} -gt 0 ] && FOUND+=("${GFOUND[@]}")
fi

echo
if [ ${#FOUND[@]} -eq 0 ]; then
  green "Nothing to do."
  exit 0
fi

if [ "$DRY_RUN" -eq 1 ]; then
  dim "Dry run — nothing deleted. Would free $(human "$TOTAL_KB")."
  exit 0
fi

# ── Confirm ───────────────────────────────────────────────────────────
if [ "$ASSUME_YES" -ne 1 ]; then
  if [ ! -t 0 ]; then
    red "Not a terminal and --yes not given; refusing to delete."
    exit 1
  fi
  printf 'Delete these and free %s? [y/N] ' "$(human "$TOTAL_KB")"
  read -r reply
  case "$reply" in
    y|Y|yes|YES) ;;
    *) echo "Aborted."; exit 1 ;;
  esac
fi

# ── Delete ────────────────────────────────────────────────────────────
echo
FAILED=0
for target in "${FOUND[@]}"; do
  if rm -rf -- "$target" 2>/dev/null; then
    printf '  removed  %s\n' "${target/#$HOME/\~}"
  else
    red "  FAILED   ${target/#$HOME/\~}"
    FAILED=$((FAILED + 1))
  fi
done

if [ "$DO_GLOBAL" -eq 1 ] && command -v npm >/dev/null 2>&1; then
  if npm cache clean --force >/dev/null 2>&1; then
    printf '  cleaned  npm cache\n'
  fi
fi

echo
if [ "$FAILED" -gt 0 ]; then
  red "Freed roughly $(human "$TOTAL_KB"), but $FAILED path(s) could not be removed."
else
  green "Freed roughly $(human "$TOTAL_KB")."
fi

dim "Restore with:  npm install  &&  (cd cbse_school_mobile && flutter pub get)"
[ "$DO_GLOBAL" -eq 1 ] && dim "iOS also needs:  (cd cbse_school_mobile/ios && pod install)"

exit 0
