#!/usr/bin/env python3
"""
Find code that messages somebody from a STAFF MEMBER'S own WhatsApp instead of
the school's Business number.

A parent should hear from the school, once, on a number the school controls and
that the school has a record of. Before 2026-09-07 thirteen web screens opened
`wa.me` — and the shared helper opened wa.me *and* posted to the API, so a fee
reminder could arrive twice, from two senders, with only one of them logged.

The fix is `sendFromSchoolWhatsApp` / `openWaMe` in lib/waMe.ts, which sends
through /api/wa/dispatch (RBAC-checked, quiet-hours aware, logged against the
household) and never opens a personal chat.

WHAT IS NOT COUNTED, because none of it sends from a personal account:

  * `wa.me/?text=…` with NO number — the share sheet, which lets a person pick
    where to post. Event publicity uses this.
  * a link pointed AT the school's own number — the gate QR, the visitor
    poster, the parent app's "message a teacher". These START a conversation
    that then arrives through the Business API; they are inbound.
  * lib/waMe.ts itself, which owns the one legitimate wa.me builder.

Add `personal-whatsapp-allow: <reason>` on the line if a new case is genuinely
one of those and the shapes above do not already cover it.

    python3 scripts/find-personal-whatsapp.py apps/web/src           # list
    python3 scripts/find-personal-whatsapp.py apps/web/src --count   # ratchet
"""

import pathlib
import re
import sys

# A wa.me URL that carries a phone number: wa.me/<something-not-?>
NUMBERED = re.compile(r'https://wa\.me/(?!\?)')

# Interpolations that are unmistakably the SCHOOL's own number.
SCHOOL_NUMBER_HINTS = (
    "school.number",
    "waNumber",
    "${number}",
    "WHATSAPP_GATE_NUMBER",
)

ALLOW = "personal-whatsapp-allow:"

# Owns the builder; the guard lives here.
OWNER = "lib/waMe.ts"


def scan(root: pathlib.Path):
    hits = []
    for path in sorted(root.rglob("*.ts")) + sorted(root.rglob("*.tsx")):
        rel = str(path)
        if OWNER in rel or ".selftest." in path.name:
            continue
        lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
        for n, line in enumerate(lines, 1):
            if not NUMBERED.search(line):
                continue
            # The marker may sit on the line or in the comment immediately
            # above it — a reason worth writing rarely fits on the same line.
            window = lines[max(0, n - 6):n]
            if any(ALLOW in w for w in window):
                continue
            stripped = line.strip()
            # Prose, not code.
            if stripped.startswith(("*", "//", "/*")):
                continue
            if any(h in line for h in SCHOOL_NUMBER_HINTS):
                continue
            hits.append((rel, n, stripped[:120]))
    return hits


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    root = pathlib.Path(args[0] if args else "apps/web/src")
    hits = scan(root)
    if "--count" in sys.argv:
        print(len(hits))
        return 0
    for rel, n, text in hits:
        print(f"{rel}:{n}  {text}")
    if hits:
        print(
            f"\n{len(hits)} place(s) message someone from a personal WhatsApp. "
            "Use openWaMe()/sendFromSchoolWhatsApp() from lib/waMe.ts so it goes "
            "from the school's number and onto the school's record.",
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
