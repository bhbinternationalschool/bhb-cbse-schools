#!/usr/bin/env bash
# Free disk space taken by git worktrees (owner's rule, 15 Oct 2026; see
# ~/.claude/CLAUDE.md). Safe by construction:
#   - a worktree is REMOVED only when it has no uncommitted work and its HEAD
#     is already in origin/main;
#   - otherwise its rebuildable folders (node_modules, .next, .dart_tool,
#     test-results, the Flutter build dir) are deleted and the source is kept;
#   - a worktree with any file changed in the last 90 minutes is SKIPPED
#     (another session may be working in it);
#   - worktrees whose folder is already gone are pruned from git's list.
# Only worktrees under ~/bhb-worktrees, <repo>/.claude/worktrees and /private/tmp
# are considered; the main checkout is never touched.
#
#   bash scripts/cleanup-worktrees.sh          dry run: prints what it would do
#   DRY=0 bash scripts/cleanup-worktrees.sh    does it
set -u
MAIN="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null | sed 's#/\.git$##')"
[ -n "$MAIN" ] && [ -d "$MAIN" ] || { echo "run inside the repo" >&2; exit 2; }
DRY="${DRY:-1}"
cd "$MAIN" || exit 1
git fetch -q origin
echo "free before: $(df -h / | awk 'NR==2{print $4}')"
git worktree list --porcelain | awk '/^worktree /{print substr($0,10)}' | while IFS= read -r wt; do
  [ "$wt" = "$MAIN" ] && continue
  case "$wt" in "$HOME"/bhb-worktrees/*|"$MAIN"/.claude/worktrees/*|/private/tmp/*) ;; *) continue ;; esac
  if [ ! -d "$wt" ]; then
    echo "PRUNE  (folder gone) $wt"; [ "$DRY" = 0 ] && git worktree prune; continue
  fi
  if [ -n "$(find "$wt" -maxdepth 6 -newermt '-90 minutes' -not -path '*/node_modules/*' -not -path '*/.next/*' -print -quit 2>/dev/null)" ]; then
    echo "SKIP   (active in the last 90 min) $wt"; continue
  fi
  size=$(du -sh "$wt" 2>/dev/null | cut -f1)
  dirty=$(git -C "$wt" status --porcelain 2>/dev/null \
    | grep -vE '(^|/)(node_modules|\.next|test-results|\.dart_tool|build)(/|$)' \
    | grep -v '^?? .*\.log$' | head -1)
  head=$(git -C "$wt" rev-parse HEAD 2>/dev/null)
  if [ -z "$dirty" ] && git merge-base --is-ancestor "$head" origin/main 2>/dev/null; then
    echo "REMOVE ($size, merged and clean) $wt"
    [ "$DRY" = 0 ] && git worktree remove --force "$wt"
  else
    echo "SLIM   ($size, $([ -n "$dirty" ] && echo 'uncommitted work kept' || echo 'not merged')) $wt"
    if [ "$DRY" = 0 ]; then
      find "$wt" -maxdepth 4 -type d \( -name node_modules -o -name .next -o -name .dart_tool -o -name test-results \) \
        -prune -exec rm -rf {} + 2>/dev/null
      rm -rf "$wt/cbse_school_mobile/build" 2>/dev/null
    fi
  fi
done
[ "$DRY" = 0 ] && git worktree prune
echo "free after:  $(df -h / | awk 'NR==2{print $4}')$([ "$DRY" = 0 ] || echo '  (dry run — nothing changed; DRY=0 to act)')"
