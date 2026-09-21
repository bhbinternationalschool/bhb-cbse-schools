/**
 * Self-test: when an automation card may be sent.
 * Run: npx tsx src/lib/automationSendRules.selftest.ts
 *
 * Built on the two nights this exists for:
 *  - 14 Sep 2026: a fee card raised 00:28 IST, approved 00:30 IST, sent to
 *    104 families. It must be refused.
 *  - 21 Sep 2026: that rule's next card, raised 14 Sep 08:00 IST, still
 *    pending a week later with 104 families' amounts frozen in it. It must
 *    be refused as stale, at any hour.
 */

import assert from "node:assert/strict";

import {
  approveRefusal,
  mobileKey,
  quietHoursRefusal,
  remindedTooRecently,
} from "./automationSendRules";
import type { QuietHours } from "./automation";

console.log("automationSendRules.selftest.ts");

const schoolQuiet: QuietHours = { enabled: true, startHour: 20, endHour: 8, timezone: "Asia/Kolkata" };
const fees = { module: "fees" as const, quietHours: schoolQuiet };
/** An IST wall-clock time as the instant it is. */
const ist = (s: string) => new Date(`${s}+05:30`);

/* ── The two real nights ─────────────────────────────────────────── */
{
  // 14 Sep: raised 13 Sep 18:58:57Z, approved 13 Sep 19:00:09Z (00:30 IST).
  const night = approveRefusal({
    rule: fees,
    item: { createdAt: "2026-09-13T18:58:57.582Z" },
    now: new Date("2026-09-13T19:00:09.155Z"),
  });
  assert.equal(night?.kind, "quiet", "the 00:30 approval is refused");
  assert.match(night!.message, /20:00 and 08:00 IST/);

  // 21 Sep: the card raised 14 Sep 02:30Z, approved in broad daylight.
  const week = approveRefusal({
    rule: fees,
    item: { createdAt: "2026-09-14T02:30:06.401Z" },
    now: new Date("2026-09-21T04:53:00.000Z"),
  });
  assert.equal(week?.kind, "stale", "a week-old list is refused even at 10:23 in the morning");
  assert.match(week!.message, /14 Sept?/);
  assert.match(week!.message, /more than 12 hours ago/);
}

/* ── Stale beats quiet ───────────────────────────────────────────── */
{
  // Out of date is out of date at any hour. "Come back after 8" about a
  // stale card would send the office back to approve wrong figures.
  const both = approveRefusal({
    rule: fees,
    item: { createdAt: ist("2026-09-20T08:00:00").toISOString() },
    now: ist("2026-09-21T23:30:00"),
  });
  assert.equal(both?.kind, "stale");

  // An unreadable creation date is not a fresh card.
  assert.equal(approveRefusal({ rule: fees, item: { createdAt: "" }, now: ist("2026-09-21T10:00:00") })?.kind, "stale");
}

/* ── A fresh card in the daytime goes ────────────────────────────── */
{
  assert.equal(
    approveRefusal({ rule: fees, item: { createdAt: ist("2026-09-21T08:00:00").toISOString() }, now: ist("2026-09-21T10:15:00") }),
    null,
  );
}

/* ── Fee quiet hours are the school's, whatever the rule says ────── */
{
  const edges: [string, boolean][] = [
    ["2026-09-21T07:59:00", true],
    ["2026-09-21T08:00:00", false],
    ["2026-09-21T13:00:00", false],
    ["2026-09-21T19:59:00", false],
    ["2026-09-21T20:00:00", true],
    ["2026-09-21T23:59:00", true],
    ["2026-09-22T00:30:00", true],
  ];
  for (const [t, quiet] of edges) {
    assert.equal(!!quietHoursRefusal(fees, ist(t)), quiet, `fees at ${t} IST`);
  }
  // A fee rule edited to switch its quiet hours off is not a way back to
  // a midnight fee chase.
  const switchedOff = { module: "fees" as const, quietHours: { ...schoolQuiet, enabled: false } };
  assert.ok(quietHoursRefusal(switchedOff, ist("2026-09-22T00:30:00")), "fees stay quiet at night regardless");
}

/* ── Other modules keep their own window ─────────────────────────── */
{
  const ptm = { module: "ptm" as const, quietHours: schoolQuiet };
  assert.ok(quietHoursRefusal(ptm, ist("2026-09-21T22:00:00")), "a PTM reminder at 10 pm waits");
  assert.equal(quietHoursRefusal(ptm, ist("2026-09-21T11:00:00")), null);

  // Health and transport switch theirs off on purpose: a sick child or a
  // late bus cannot wait for morning.
  const transport = { module: "transport" as const, quietHours: { ...schoolQuiet, enabled: false } };
  assert.equal(quietHoursRefusal(transport, ist("2026-09-21T22:00:00")), null);

  // A daytime window, not an overnight one.
  const lunch = { module: "comms" as const, quietHours: { enabled: true, startHour: 13, endHour: 14, timezone: "Asia/Kolkata" } };
  assert.ok(quietHoursRefusal(lunch, ist("2026-09-21T13:30:00")));
  assert.equal(quietHoursRefusal(lunch, ist("2026-09-21T14:00:00")), null);

  // No rule at all (deleted since the card was raised): nothing to apply.
  assert.equal(quietHoursRefusal(null, ist("2026-09-21T23:00:00")), null);
}

/* ── Once a week per family ──────────────────────────────────────── */
{
  // 11 Sep, then 14 Sep: what happened to 95 families.
  assert.equal(remindedTooRecently("2026-09-11", "2026-09-14"), true);
  assert.equal(remindedTooRecently("2026-09-11T18:54:21Z", "2026-09-14"), true, "a timestamp reads as its day");
  // The same calendar-day count the ERP command uses: 11th → next on the 18th.
  assert.equal(remindedTooRecently("2026-09-11", "2026-09-17"), true);
  assert.equal(remindedTooRecently("2026-09-11", "2026-09-18"), false);
  // Never reminded is not "too recent".
  assert.equal(remindedTooRecently(undefined, "2026-09-21"), false);
  assert.equal(remindedTooRecently("", "2026-09-21"), false);
}

/* ── Numbers, in every form the log and the cards hold them ──────── */
{
  assert.equal(mobileKey("919876500001"), "9876500001");
  assert.equal(mobileKey("+91 98765 00001"), "9876500001");
  assert.equal(mobileKey("9876500001"), "9876500001");
  assert.equal(mobileKey("12"), "");
  assert.equal(mobileKey(undefined), "");
}

console.log("  ok");
