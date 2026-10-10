#!/usr/bin/env python3
"""
Find `delete a parent's children, then insert them again` written as two
separate PostgREST statements.

    await sb.from("exam_desk_marks").delete().eq("mark_sheet_id", id);
    await sb.from("exam_desk_marks").upsert(marks);

Nothing ties those together. When the second fails, the first has already
committed and the parent is left with no children — a mark sheet with no
marks, a register with no attendance, a receipt with no fee lines. The last
one emptied the entire fee book on 2026-09-06: 1,913 lines over 435 receipts,
₹20.8 lakh of collections showing a guardian and an amount and no student, no
head, no month. 134 receipts went the same way on 2026-09-01.

The fix is `lib/replaceChildRows.server.ts` → `replace_child_rows`, which does
the delete and the insert inside one plpgsql function.

WHAT IS DELIBERATELY NOT COUNTED

    await sb.from("t").delete().in("id", staleIds);
    await sb.from("t").upsert(liveRows);

That is a prune, not a replace: it deletes rows that are meant to go and
rewrites rows that already exist, so a failed upsert loses nothing. The
difference is the filter column — a prune filters on the child's own `id`,
a replace filters on the PARENT's id. Only the latter is counted.

    python3 scripts/find-unguarded-replace.py apps/web/src           # list
    python3 scripts/find-unguarded-replace.py apps/web/src --count   # ratchet
"""

import pathlib
import re
import sys

# .from("table") … .delete() … up to the end of the statement
DELETE = re.compile(
    r'\.from\(\s*"([a-z0-9_]+)"\s*\)((?:(?!\.from\().){0,300}?)\.delete\(\)'
    r'((?:(?!\.from\().){0,300}?);',
    re.S,
)
FILTER_COL = re.compile(r'\.(?:eq|in)\(\s*"([a-z0-9_]+)"')

# A child's own identity, or the tenant scope. Filtering on these is a prune
# or a scope, never "wipe this parent's children".
NOT_A_PARENT = {"id", "tenant_id"}

# How far after the delete an insert still counts as the same operation.
WINDOW = 2500


def write_after(text: str, table: str, start: int) -> bool:
    tail = text[start : start + WINDOW]
    return bool(
        re.search(
            r'\.from\(\s*"' + re.escape(table) + r'"\s*\)'
            r'((?:(?!\.from\().){0,300}?)\.(insert|upsert)\(',
            tail,
            re.S,
        )
    )


def scan(root: pathlib.Path):
    hits = []
    for path in sorted(root.rglob("*.ts")):
        if ".selftest." in path.name:
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        if "ratchet-allow: unguarded_replace" in text:
            continue
        for m in DELETE.finditer(text):
            table, tail = m.group(1), m.group(3)
            parents = [c for c in FILTER_COL.findall(tail) if c not in NOT_A_PARENT]
            if not parents:
                continue
            if not write_after(text, table, m.end()):
                continue
            line = text[: m.start()].count("\n") + 1
            hits.append((path, line, table, ",".join(parents)))
    return hits


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    root = pathlib.Path(args[0] if args else "apps/web/src")
    hits = scan(root)
    if "--count" in sys.argv:
        print(len(hits))
        return 0
    for path, line, table, cols in hits:
        print(f"{path}:{line}  {table}  replaced by {cols}")
    if hits:
        print(
            f"\n{len(hits)} unguarded replace(s). Use replaceChildRows() from "
            "lib/replaceChildRows.server.ts, or add a "
            "`ratchet-allow: unguarded_replace — <reason>` comment if the "
            "delete genuinely cannot lose anything.",
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
