#!/usr/bin/env python3
"""Collect Track C desk cutover env vars for Cloud Run deploy and Docker build."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


def parse_env_file(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.is_file():
        return out
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        out[key] = value
    return out


def load_template_keys(template_path: Path) -> list[str]:
    keys: list[str] = []
    for raw in template_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _ = line.split("=", 1)
        keys.append(key.strip())
    return keys


def merge_desk_env(
    template_path: Path,
    local_path: Path | None,
) -> dict[str, str]:
    template = parse_env_file(template_path)
    local = parse_env_file(local_path) if local_path else {}
    merged: dict[str, str] = {}
    for key in load_template_keys(template_path):
        if key in local and local[key] != "":
            merged[key] = local[key]
        elif key in template:
            merged[key] = template[key]
    return merged


def format_yaml(env: dict[str, str]) -> str:
    lines = []
    for key, value in env.items():
        safe = value.replace("\\", "\\\\").replace('"', '\\"')
        lines.append(f'{key}: "{safe}"')
    return "\n".join(lines) + "\n"


def format_build_env(env: dict[str, str]) -> str:
    lines = []
    for key, value in env.items():
        if key.startswith("NEXT_PUBLIC_"):
            lines.append(f"{key}={value}")
    return "\n".join(lines) + "\n"


def format_pipe(env: dict[str, str]) -> str:
    return "|".join(f"{k}={v}" for k, v in env.items())


def check_env(
    template_path: Path,
    local_path: Path,
    *,
    require_read_from_db: bool,
) -> int:
    merged = merge_desk_env(template_path, local_path)
    template_keys = load_template_keys(template_path)
    missing: list[str] = []
    for key in template_keys:
        if key not in merged:
            missing.append(key)
        elif require_read_from_db and key.endswith("_READ_FROM_DB") and merged[key] != "true":
            missing.append(f"{key} (expected true, got {merged[key]!r})")

    if missing:
        print("Missing or incomplete desk cutover env:", file=sys.stderr)
        for key in missing:
            print(f"  - {key}", file=sys.stderr)
        return 1

    print(f"OK — {len(merged)} desk cutover vars present")
    return 0


def main() -> int:
    root = Path(__file__).resolve().parents[2]
    default_template = root / "deploy" / "desk-cutover.env.example"

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "env_file",
        nargs="?",
        default=str(root / "apps" / "web" / ".env.local"),
        help="Source .env.local (values override template defaults)",
    )
    parser.add_argument(
        "--template",
        default=str(default_template),
        help="Desk cutover key template",
    )
    parser.add_argument(
        "--format",
        choices=("yaml", "build-env", "pipe"),
        default="yaml",
        help="Output format",
    )
    parser.add_argument(
        "--write",
        action="store_true",
        help="Write deploy/.generated/* files for Cloud Build",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Exit 1 if env_file is missing required desk keys",
    )
    parser.add_argument(
        "--require-read-from-db",
        action="store_true",
        help="With --check, require all *_READ_FROM_DB=true",
    )
    args = parser.parse_args()

    template_path = Path(args.template)
    local_path = Path(args.env_file) if args.env_file else None

    if args.check:
        if not local_path or not local_path.is_file():
            print(f"Missing env file: {local_path}", file=sys.stderr)
            return 1
        return check_env(
            template_path,
            local_path,
            require_read_from_db=args.require_read_from_db,
        )

    merged = merge_desk_env(template_path, local_path)

    if args.write:
        out_dir = root / "deploy" / ".generated"
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / "desk-cutover-runtime.yaml").write_text(
            format_yaml(merged), encoding="utf-8"
        )
        (out_dir / "desk-cutover-build.env").write_text(
            format_build_env(merged), encoding="utf-8"
        )
        print(f"Wrote {out_dir}/desk-cutover-runtime.yaml")
        print(f"Wrote {out_dir}/desk-cutover-build.env")
        return 0

    if args.format == "yaml":
        sys.stdout.write(format_yaml(merged))
    elif args.format == "build-env":
        sys.stdout.write(format_build_env(merged))
    else:
        sys.stdout.write(format_pipe(merged))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
