/**
 * Self-test: what the director's digest says is waiting on the office.
 * Run: npx tsx src/lib/officeBacklog.selftest.ts
 *
 * What must hold:
 *  - the queue as it stood on 21 Sep 2026 reads as a phone call, with a name;
 *  - an unreadable source is SAID, never reported as an empty queue;
 *  - a clear day says nothing, so the digest does not cry wolf;
 *  - a short quiet spell in fee reminders is not a line.
 */

import assert from "node:assert/strict";

import {
  backlogIsEmpty,
  FEE_REMINDER_QUIET_DAYS,
  formatOfficeBacklog,
  formatOfficeBacklogOneLine,
  wholeDaysBetween,
  type OfficeBacklog,
} from "./officeBacklog";

console.log("officeBacklog.selftest.ts");

const clear: OfficeBacklog = {
  waitingParents: [],
  relayUnanswered: 0,
  relayNoRoute: 0,
  mediaUnreviewed: { images: 0, audio: 0, other: 0 },
  daysSinceFeeReminder: 1,
};

/* ── The night this was written ──────────────────────────────────── */
{
  const tonight: OfficeBacklog = {
    waitingParents: [
      { name: "Mr. ROHIT DIXIT", days: 10 },
      { name: "Mr. AJAY KUMAR SHRIVASTAVA", days: 10 },
      { name: "MR. PRADEEP KUMAR YADAV", days: 7 },
      { name: "AMITABH YADAV", days: 5 },
      { name: "ASHUTOSH MISHRA", days: 4 },
      { name: "MR. RAMBABU  YADAV", days: 3 },
    ],
    relayUnanswered: 11,
    relayNoRoute: 10,
    mediaUnreviewed: { images: 26, audio: 15, other: 5 },
    daysSinceFeeReminder: 8,
  };
  const text = formatOfficeBacklog(tonight);
  assert.ok(text.startsWith("*Waiting for the office*"), text);
  assert.match(text, /6 parents are waiting for a reply — oldest 10 days \(Mr\. ROHIT DIXIT\)/);
  assert.match(text, /Mr\. AJAY KUMAR SHRIVASTAVA 10d/, "the next few are named too");
  assert.match(text, /\+1 more/, "and the rest counted, not dropped");
  assert.match(text, /11 messages forwarded to office phones, not answered/);
  assert.match(text, /10 messages reached nobody/);
  assert.match(text, /26 photos, 15 voice notes, 5 other files/);
  assert.match(text, /No fee reminder sent for 8 days/);
  // Every fee reminder the school has sent came from the automation card,
  // so the line points at the card — not at the ERP command, which has
  // never sent one (an earlier draft of this line said the opposite).
  assert.match(text, /approve the card in Masters → Automation/);
  assert.equal(backlogIsEmpty(tonight), false);

  const line = formatOfficeBacklogOneLine(tonight);
  assert.equal(line, "Office: 6 parents waiting (oldest 10d), 21 relay unanswered, 46 files unopened.");
  // It goes into a WhatsApp template parameter, and Meta refuses a newline
  // there (#132000) — the whole send fails, not just the line.
  assert.ok(!line.includes("\n"), "one line, really");
}

/* ── Unknown is not zero ─────────────────────────────────────────── */
{
  // A digest that goes quiet because a query failed is the same silence
  // this exists to end.
  const blind: OfficeBacklog = {
    waitingParents: null,
    relayUnanswered: null,
    relayNoRoute: null,
    mediaUnreviewed: null,
    daysSinceFeeReminder: null,
  };
  const text = formatOfficeBacklog(blind);
  assert.match(text, /Could not read the parent chats/);
  assert.match(text, /Could not read the office relay/);
  assert.match(text, /Could not read the files parents sent/);
  assert.equal(backlogIsEmpty(blind), false, "an unread queue is never a clear queue");
  assert.match(formatOfficeBacklogOneLine(blind), /parent chats unreadable/);

  // One source unreadable, the rest clear: still said.
  const oneBlind = { ...clear, relayNoRoute: null };
  assert.match(formatOfficeBacklog(oneBlind), /Could not read the office relay/);
  assert.equal(backlogIsEmpty(oneBlind), false);
}

/* ── A clear day says nothing ────────────────────────────────────── */
{
  assert.equal(formatOfficeBacklog(clear), "");
  assert.equal(formatOfficeBacklogOneLine(clear), "");
  assert.equal(backlogIsEmpty(clear), true);

  // Fee reminders: a few quiet days are normal; a week is worth a line.
  const justUnder = { ...clear, daysSinceFeeReminder: FEE_REMINDER_QUIET_DAYS - 1 };
  assert.equal(formatOfficeBacklog(justUnder), "");
  assert.equal(backlogIsEmpty(justUnder), true);
  const aWeek = { ...clear, daysSinceFeeReminder: FEE_REMINDER_QUIET_DAYS };
  assert.match(formatOfficeBacklog(aWeek), /No fee reminder sent for 7 days/);
  assert.equal(backlogIsEmpty(aWeek), false);

  // Never sent at all is "nothing on record", not a week-long gap.
  assert.equal(formatOfficeBacklog({ ...clear, daysSinceFeeReminder: null }), "");
}

/* ── Grammar, because the director reads it ──────────────────────── */
{
  const one = formatOfficeBacklog({
    ...clear,
    waitingParents: [{ name: "X", days: 1 }],
    relayUnanswered: 1,
    mediaUnreviewed: { images: 1, audio: 1, other: 0 },
  });
  assert.match(one, /1 parent is waiting for a reply — oldest 1 day \(X\)/);
  assert.match(one, /1 message forwarded/);
  assert.match(one, /1 photo, 1 voice note\./);
}

/* ── Days ────────────────────────────────────────────────────────── */
{
  assert.equal(wholeDaysBetween("2026-09-11T00:51:00Z", "2026-09-21T09:00:00Z"), 10);
  assert.equal(wholeDaysBetween("2026-09-21T08:00:00Z", "2026-09-21T09:00:00Z"), 0);
  assert.equal(wholeDaysBetween("2026-09-22T00:00:00Z", "2026-09-21T00:00:00Z"), 0, "never negative");
  assert.equal(wholeDaysBetween("not a date", "2026-09-21T00:00:00Z"), null);
}

console.log("  ok");
