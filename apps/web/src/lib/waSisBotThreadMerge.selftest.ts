/**
 * Self-test: two parents at once, and one parent chat desk.
 * Run: npx tsx apps/web/src/lib/waSisBotThreadMerge.selftest.ts
 *
 * What must hold:
 *  - the turns of a family whose reply was being worked out while another
 *    family's reply was written are still on the desk afterwards. This is
 *    the one that failed: KANHAIYA PATEL's practice tap on 24 Sep 2026 was
 *    sent, delivered and read, and is nowhere on the desk;
 *  - the thread's own fields — status, unread count, pending ask — are the
 *    caller's, because those are what this message decided;
 *  - a turn already on the desk is not written twice, so a retried write is
 *    harmless;
 *  - a thread the desk has never seen is added rather than dropped.
 */

import assert from "node:assert/strict";

import { mergeThreadTurns } from "./waSisBotThreadMerge";

console.log("waSisBotThreadMerge.selftest.ts");

type Msg = { id: string; text: string };
type Thread = { id: string; messages: Msg[]; status: string; unreadStaff: number };

const msg = (id: string, text: string): Msg => ({ id, text });

/* ── 1. The real loss, 24 Sep 2026 ──────────────────────────────────── */

// 18:02 IST. KANHAIYA PATEL taps "अभ्यास शुरू करें" for SUMIT (V), and the
// drill takes a few seconds to open — the syllabus, the chapter list. While
// it does, VISHAL SINGH's tap is answered and written. Before this merge,
// the drill's write put back the desk as it was BEFORE Vishal's turns, or
// Vishal's write put back the desk without Kanhaiya's. Either way one
// family's evening is gone from the school's record of it.
const deskWhenKanhaiyaArrived: Thread[] = [
  { id: "wst_kanhaiya", messages: [msg("m1", "पिछले हफ़्ते की बात")], status: "bot", unreadStaff: 0 },
  { id: "wst_vishal", messages: [], status: "bot", unreadStaff: 0 },
];

// Vishal's reply lands first, on the desk as it stood.
const afterVishal = mergeThreadTurns(
  deskWhenKanhaiyaArrived,
  { id: "wst_vishal", messages: [msg("v1", "अभ्यास शुरू करें"), msg("v2", "🌱 AYANSHI SINGH (UKG) — …")], status: "bot", unreadStaff: 0 },
  [msg("v1", "अभ्यास शुरू करें"), msg("v2", "🌱 AYANSHI SINGH (UKG) — …")],
);

// Kanhaiya's drill finishes and writes, holding the desk it read at 18:02.
const kanhaiyaTurns = [msg("k1", "अभ्यास शुरू करें"), msg("k2", "📚 SUMIT, कल *कंप्यूटर* है।")];
const after = mergeThreadTurns(
  afterVishal,
  {
    id: "wst_kanhaiya",
    // The caller built these from ITS stale copy — one old message plus the turns.
    messages: [msg("m1", "पिछले हफ़्ते की बात"), ...kanhaiyaTurns],
    status: "bot",
    unreadStaff: 0,
  },
  kanhaiyaTurns,
);

const vishal = after.find((t) => t.id === "wst_vishal")!;
const kanhaiya = after.find((t) => t.id === "wst_kanhaiya")!;

assert.deepEqual(
  kanhaiya.messages.map((m) => m.id),
  ["m1", "k1", "k2"],
  "the scope question WhatsApp delivered and the parent read is on the desk",
);
assert.deepEqual(
  vishal.messages.map((m) => m.id),
  ["v1", "v2"],
  "and the reply written while it was being worked out is not overwritten",
);
assert.equal(after.length, 2, "no thread is lost or duplicated");

/* ── 2. The thread's own fields are this message's decision ─────────── */

// Escalating to the office, unread going up, the pending question: all
// decided by the message being handled, so the caller's copy wins. Only
// the message list is folded together.
const escalated = mergeThreadTurns(
  [{ id: "wst_a", messages: [msg("a1", "…")], status: "bot", unreadStaff: 0 }],
  { id: "wst_a", messages: [msg("a1", "…"), msg("a2", "HUMAN")], status: "needs_staff", unreadStaff: 1 },
  [msg("a2", "HUMAN")],
)[0]!;
assert.equal(escalated.status, "needs_staff", "the office still sees it was escalated");
assert.equal(escalated.unreadStaff, 1);

/* ── 3. A retried write does not say it twice ───────────────────────── */

const once = mergeThreadTurns(
  [{ id: "wst_b", messages: [msg("b1", "DUES"), msg("b2", "₹4,200 बकाया है")], status: "bot", unreadStaff: 0 }],
  { id: "wst_b", messages: [msg("b1", "DUES"), msg("b2", "₹4,200 बकाया है")], status: "bot", unreadStaff: 0 },
  [msg("b1", "DUES"), msg("b2", "₹4,200 बकाया है")],
)[0]!;
assert.deepEqual(once.messages.map((m) => m.id), ["b1", "b2"], "a repeat of the same write changes nothing");

/* ── 4. A family writing for the first time ─────────────────────────── */

// findOrCreate puts a new thread at the front of the desk; a merge that
// only replaced what it found would drop it and lose the first message a
// family ever sends.
const fresh = mergeThreadTurns(
  [{ id: "wst_old", messages: [], status: "bot", unreadStaff: 0 }],
  { id: "wst_new", messages: [msg("n1", "नमस्ते")], status: "bot", unreadStaff: 0 },
  [msg("n1", "नमस्ते")],
);
assert.equal(fresh.length, 2);
assert.equal(fresh[0]!.id, "wst_new", "the newest thread is at the front, where the desk shows it");

console.log("  ok — a reply written while another was being worked out is kept");
