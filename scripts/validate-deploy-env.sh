#!/usr/bin/env bash
# Validate apps/web/.env.local has all desk cutover keys before production deploy.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${1:-$ROOT/apps/web/.env.local}"

python3 "$ROOT/scripts/lib/collectDeskCutoverEnv.py" "$ENV_FILE" --check "${@:2}"
