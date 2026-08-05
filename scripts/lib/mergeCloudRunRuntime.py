#!/usr/bin/env python3
"""Merge Cloud Run secrets + core runtime vars into desk-cutover-runtime.yaml."""

from __future__ import annotations

import sys
from pathlib import Path

from collectDeskCutoverEnv import format_yaml


def read_yaml(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    if not path.is_file():
        return env
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or ":" not in line:
            continue
        key, _, value = line.partition(":")
        env[key.strip()] = value.strip().strip('"').strip("'")
    return env


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: mergeCloudRunRuntime.py <runtime.yaml> KEY=VALUE ...", file=sys.stderr)
        return 1

    path = Path(sys.argv[1])
    extras: dict[str, str] = {}
    for arg in sys.argv[2:]:
        if "=" not in arg:
            continue
        key, value = arg.split("=", 1)
        if value != "":
            extras[key] = value

    merged = read_yaml(path)
    merged.update(extras)
    path.write_text(format_yaml(merged), encoding="utf-8")
    print(f"Merged {len(extras)} Cloud Run vars into {path} ({len(merged)} total)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
