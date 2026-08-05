#!/usr/bin/env python3
"""Format desk-cutover-runtime.yaml for gcloud --update-env-vars (^@^ delimiter)."""

from __future__ import annotations

import sys
from pathlib import Path


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: formatDeskCutoverUpdate.py <runtime.yaml>", file=sys.stderr)
        return 1

    parts: list[str] = []
    for raw in Path(sys.argv[1]).read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or ":" not in line:
            continue
        key, _, value = line.partition(":")
        value = value.strip().strip('"').strip("'")
        parts.append(f"{key.strip()}={value}")

    print("@".join(parts), end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
