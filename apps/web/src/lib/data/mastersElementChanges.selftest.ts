/**
 * Run: npm run test:masters-lib-writes
 *
 * data-layer 2.2e — the fee writes as Masters elements (pure parts):
 *  1. diffMastersLists: a new grant → one create; an ended grant → a patch of
 *     the keys that changed only (expecting the old values); a missing id →
 *     a delete; lists not named are never looked at; normalised "nothing"
 *     (absent / null / "") is not a change.
 *  2. planMastersElementChanges against the STORED elements: a patch at the
 *     stored `_rev`, carrying only the changed keys (another key changed
 *     elsewhere is kept); a key this action sets that someone changed → a
 *     conflict, nothing planned; a create of a stored id → conflict, or skipped
 *     with ifAbsent; a delete of a gone element → nothing; a list that is not a
 *     `_rev` Masters list → refused.
 *  3. revokeChangesForVoucher: exactly the stored grants with the voucher's
 *     marker that are not already rejected — never another receipt's (a
 *     marker that is a prefix of another must not match).
 *  4. The Masters editor plans fee keys as elements (planMastersElementCommit):
 *     a fee line changed → one upsert to masters.fee-structure-lines; the
 *     fee-setup clone (groups + lines + instalments) → ONE batch; nothing in
 *     `rest` but keys with no element home (feeBackdatePolicy).
 *  5. The receipt number: chooseReceiptNo takes the server's number over a
 *     lagging copy, the copy's when it is later, never one already held;
 *     laterSeriesNumber compares tails of one prefix only.
 */
import assert from "node:assert/strict";
import {
  diffMastersLists,
  planMastersElementChanges,
  revokeChangesForVoucher,
  type MastersElementChange,
} from "./mastersElementChanges";
import { planMastersElementCommit } from "./client/mastersElementPlan";
import { chooseReceiptNo } from "@/lib/fees";
import { laterSeriesNumber } from "@/lib/numberSeries";

type Row = Record<string, unknown>;
let checks = 0;
const ok = (fn: () => void) => {
  fn();
  checks += 1;
};
const served = (lists: Record<string, Row[]>) => (k: string) => new Map((lists[k] ?? []).map((e) => [String(e.id), e]));

// 1. diff
ok(() => {
  const g1 = { id: "cg1", concessionId: "c1", studentId: "s1", status: "approved", reason: "A", effectiveTo: null, ground: "" };
  const g2 = { id: "cg2", concessionId: "c1", studentId: "s2", status: "approved", reason: "B", effectiveTo: null };
  const before = { concessionGrants: [g1, g2], feeStructureLines: [{ id: "l1" }] };
  const after = {
    concessionGrants: [
      { ...g1, effectiveTo: "2026-10-31", reason: "A · ended" },
      { id: "cg3", concessionId: "c1", studentId: "s3", status: "pending", reason: "C" },
    ],
    feeStructureLines: [],
  };
  const ch = diffMastersLists(before, after, ["concessionGrants"]);
  assert.deepEqual(
    ch.map((c) => `${c.kind}:${c.id}`).sort(),
    ["create:cg3", "delete:cg2", "patch:cg1"],
    "create, patch, delete; feeStructureLines not named — not looked at",
  );
  const p = ch.find((c) => c.kind === "patch") as Extract<MastersElementChange, { kind: "patch" }>;
  assert.deepEqual(p.set, { effectiveTo: "2026-10-31", reason: "A · ended" }, "only the changed keys");
  assert.deepEqual(p.expect, { effectiveTo: null, reason: "A" });
  // "" / null / absent is not a change (a normalised copy against the stored one)
  assert.deepEqual(diffMastersLists({ concessionGrants: [{ id: "x", ground: "" }] }, { concessionGrants: [{ id: "x" }] }, ["concessionGrants"]), []);
});

// 2. plan against the stored elements
ok(() => {
  const stored = served({
    concessionGrants: [{ id: "cg1", status: "approved", reason: "A", effectiveTo: null, note: "someone else", _rev: 4 }],
  });
  const patch: MastersElementChange = { kind: "patch", sliceKey: "concessionGrants", id: "cg1", expect: { reason: "A", effectiveTo: null }, set: { reason: "A · ended", effectiveTo: "2026-10-31" } };
  const plan = planMastersElementChanges([patch], stored);
  assert.ok(plan.ok);
  assert.equal(plan.ops.length, 1);
  assert.equal(plan.ops[0].collection, "masters.concession-grants");
  assert.deepEqual(plan.ops[0].op, { op: "upsert", id: "cg1", base: "4", row: { reason: "A · ended", effectiveTo: "2026-10-31" } }, "at the stored _rev, only the keys set");

  // a key this action sets was changed elsewhere → conflict, nothing
  const moved = served({ concessionGrants: [{ id: "cg1", status: "approved", reason: "A (edited)", _rev: 5 }] });
  const c = planMastersElementChanges([patch], moved);
  assert.equal(c.ok, false);
  assert.equal(!c.ok && c.kind, "conflict");

  // removed elsewhere → conflict
  assert.equal(planMastersElementChanges([patch], served({})).ok, false);

  // create: new → base null; stored → conflict; stored + ifAbsent → skipped
  const create: MastersElementChange = { kind: "create", sliceKey: "concessions", id: "cnc_rtew_h1", row: { id: "cnc_rtew_h1", name: "RTE", _rev: 9 } };
  const fresh = planMastersElementChanges([create], served({}));
  assert.ok(fresh.ok);
  assert.deepEqual(fresh.ops[0].op, { op: "upsert", id: "cnc_rtew_h1", base: null, row: { id: "cnc_rtew_h1", name: "RTE" } }, "no _rev sent");
  const there = served({ concessions: [{ id: "cnc_rtew_h1", name: "RTE", _rev: 1 }] });
  assert.equal(planMastersElementChanges([create], there).ok, false, "an id already stored is not created twice");
  const skip = planMastersElementChanges([{ ...create, ifAbsent: true }], there);
  assert.ok(skip.ok && skip.ops.length === 0, "ifAbsent: already there — nothing");

  // delete: gone → nothing; stored → at its _rev (absent _rev = 0)
  const del: MastersElementChange = { kind: "delete", sliceKey: "concessionGrants", id: "cg9" };
  const gone = planMastersElementChanges([del], served({}));
  assert.ok(gone.ok && gone.ops.length === 0);
  const del2 = planMastersElementChanges([del], served({ concessionGrants: [{ id: "cg9" }] }));
  assert.ok(del2.ok);
  assert.deepEqual(del2.ops[0].op, { op: "delete", id: "cg9", base: "0" });

  // not a _rev Masters list / an id twice
  assert.equal(planMastersElementChanges([{ kind: "delete", sliceKey: "staff", id: "x" }], served({})).ok, false);
  assert.equal(planMastersElementChanges([del, del], served({ concessionGrants: [{ id: "cg9" }] })).ok, false);
});

// 3. revoke exactly the receipt's grants
ok(() => {
  const grants: Row[] = [
    { id: "a", status: "approved", reason: "Fee Take · x · receipt RCV-1 [v:rcv_1]" },
    { id: "b", status: "pending", reason: "Fee Take · y · receipt RCV-1 [v:rcv_1]" },
    { id: "c", status: "rejected", reason: "old [v:rcv_1]" },
    { id: "d", status: "approved", reason: "Fee Take · receipt RCV-10 [v:rcv_10]" },
    { id: "e", status: "approved", reason: "Masters grant" },
  ];
  const ch = revokeChangesForVoucher(grants, { id: "rcv_1", receiptNo: "RCV-1" }, "2026-10-27");
  assert.deepEqual(ch.map((c) => c.id), ["a", "b"], "only rcv_1's live grants; rcv_10 is not a match");
  const p = ch[0] as Extract<MastersElementChange, { kind: "patch" }>;
  assert.equal(p.set.status, "rejected");
  assert.match(String(p.set.reason), /auto-revoked — receipt RCV-1 voided 2026-10-27$/);
  assert.deepEqual(revokeChangesForVoucher(grants, { id: "", receiptNo: "" }, "2026-10-27"), [], "no id — nothing");
});

// 4. the Masters editor plans fee keys as elements
ok(() => {
  const line = (id: string, amt: number, rev = 2) => ({ id, feeGroupId: "g1", feeHeadId: "h1", amountPaise: amt, _rev: rev });
  const shown = { feeStructureLines: [line("l1", 100), line("l2", 200)], feeGroups: [{ id: "g1", academicYearCode: "2026-27", _rev: 1 }], installments: [] };
  const edited = { ...shown, feeStructureLines: [line("l1", 150), line("l2", 200)] };
  const one = planMastersElementCommit({ shown, next: edited, served: shown });
  assert.ok(one.ok);
  assert.deepEqual(one.rest, []);
  assert.equal(one.requests.length, 1);
  assert.equal(one.requests[0].collection, "masters.fee-structure-lines");
  assert.deepEqual(one.requests[0].ops.map((o) => [o.id, o.base]), [["l1", "2"]], "one line, on its shown _rev");

  // the clone: new year's groups + lines + an instalment → ONE batch
  const cloned = {
    ...shown,
    installments: [{ id: "i27", academicYearCode: "2027-28", code: "APR" }],
    feeGroups: [...shown.feeGroups, { id: "g2", academicYearCode: "2027-28" }],
    feeStructureLines: [...shown.feeStructureLines, { id: "l3", feeGroupId: "g2", feeHeadId: "h1", amountPaise: 100 }],
  };
  const clone = planMastersElementCommit({ shown, next: cloned, served: shown });
  assert.ok(clone.ok);
  assert.equal(clone.requests.length, 1, "one request");
  assert.equal(clone.requests[0].kind, "batch", "all or none");
  assert.deepEqual(
    clone.requests[0].parts?.map((p) => p.collection),
    ["masters.installments", "masters.fee-groups", "masters.fee-structure-lines"],
    "parents first",
  );

  // a key with no element home stays in rest (the editor refuses it)
  const backdate = planMastersElementCommit({ shown: { feeBackdatePolicy: { allowForAllStaff: false } }, next: { feeBackdatePolicy: { allowForAllStaff: true } }, served: {} });
  assert.ok(backdate.ok);
  assert.deepEqual(backdate.rest, ["feeBackdatePolicy"]);

  // the mid-year policy is an object on its stamp
  const midYear = planMastersElementCommit({
    shown: { midYearFeePolicy: { skipMonthsBeforeJoin: true } },
    next: { midYearFeePolicy: { skipMonthsBeforeJoin: false } },
    served: { midYearFeePolicy: { skipMonthsBeforeJoin: true } },
    stamps: { midYearFeePolicy: "2026-10-27T00:00:00Z" },
  });
  assert.ok(midYear.ok);
  assert.equal(midYear.requests[0]?.collection, "masters.mid-year-fee-policy");
  assert.equal(midYear.requests[0]?.ops[0]?.base, "2026-10-27T00:00:00Z");

  // two fee lines dropped at once → never two single-list deletes: one batch
  const wipe = planMastersElementCommit({ shown, next: { ...shown, feeStructureLines: [] }, served: shown });
  assert.equal(wipe.ok, false, "emptying the fee lines is refused");
});

// 5. receipt numbers
ok(() => {
  const fees = { vouchers: [{ receiptNo: "RCV-00700" }, { receiptNo: "RCV-00701" }] } as Parameters<typeof chooseReceiptNo>[2];
  assert.equal(chooseReceiptNo("RCV-00711", "RCV-00702", fees), "RCV-00711", "the server's over a lagging copy");
  assert.equal(chooseReceiptNo("RCV-00702", "RCV-00703", fees), "RCV-00703", "the copy's when later (a receipt the server has not seen)");
  assert.equal(chooseReceiptNo("RCV-00701", "RCV-00702", fees), "RCV-00702", "never a number this copy holds");
  assert.equal(chooseReceiptNo(undefined, "RCV-00702", fees), "RCV-00702", "no server number: the copy's");
  assert.equal(laterSeriesNumber("RCV-00711", "F/2026-27/0099"), "RCV-00711", "different prefix: the server's");
  assert.equal(laterSeriesNumber("SRN-00338", "SRN-00340"), "SRN-00340");
});

console.log(`mastersElementChanges.selftest: ok (${checks} checks)`);

// ── 2.2e review fixes ──────────────────────────────────────────────────────
import { counterGrantId, planCounterGrants } from "@/lib/counterConcession";
import { recordCounterGrants, retryQueuedCounterGrants, revokeCounterGrants, COUNTER_GRANT_QUEUE_KEY, type Deps } from "@/lib/counterGrantsClient";
import { emptyMastersShell, type MastersState } from "@/lib/masters";

const reviewChecks: Promise<void>[] = [];

// 6. the counter's grants planned on the STORED grants
ok(() => {
  const shell = emptyMastersShell() as MastersState;
  const book: MastersState = {
    ...shell,
    feeHeads: [{ id: "h1", code: "TUI", nameEn: "Tuition", category: "academic", frequency: "monthly", isOptional: false, isRefundable: false, isActive: true, sortOrder: 1 } as MastersState["feeHeads"][number]],
    concessions: [],
    concessionGrants: [],
  };
  const req = {
    items: [{ studentId: "s1", studentName: "A", feeHeadId: "h1", feeHeadName: "Tuition", discountPaise: 10_000, dueLabel: "Tuition · May", futureEffectiveFrom: "2026-06-10" }],
    reason: "hardship",
    academicYearCode: "2026-27",
    ground: "hardship" as const,
    sourceVoucherId: "rcv_1",
    sourceReceiptNo: "RCV-00001",
    canApprove: false,
    by: "Clerk One",
    nowIso: "2026-10-27T00:00:00Z",
  };
  const first = planCounterGrants(book, req);
  assert.equal(first.newGrants.length, 1);
  assert.equal(first.newGrants[0].id, "cg_ctr_s1_h1_1", "a fixed id: two counters at once write the same one");
  assert.equal(first.newGrants[0].status, "pending", "a clerk without approval authority records it pending");
  assert.match(first.newGrants[0].reason, /by Clerk One · receipt RCV-00001 \[v:rcv_1\]$/, "the giver and the receipt");
  assert.equal(first.newRules.length, 1);
  assert.equal(first.newRules[0].id, "cnc_ctr_h1_10000", "the counter rule's id is fixed per head and amount");
  // the same again, on what is now stored: skipped (already on file), nothing new
  const again = planCounterGrants(first.next, req);
  assert.equal(again.newGrants.length, 0, "already on file → nothing written");
  assert.equal(again.skipped, 1);
  // another amount on the same head: blocked (one discount per head)
  const other = planCounterGrants(first.next, { ...req, items: [{ ...req.items[0], discountPaise: 20_000 }], canApprove: true });
  assert.equal(other.newGrants.length, 0, "a second discount on the head is refused");
  assert.equal(other.blocked.length, 1);
  assert.equal(counterGrantId("s1", "h1", first.next.concessionGrants), "cg_ctr_s1_h1_2", "the next one for that head is _2");
});

// 7. the client: waits for the receipt, keeps what it could not record, says so
function fakeDeps(answers: { status: number; body: Record<string, unknown> }[]): Deps & { said: string[]; store: Map<string, string>; calls: string[] } {
  const store = new Map<string, string>();
  const said: string[] = [];
  const calls: string[] = [];
  let t = 0;
  return {
    said,
    store,
    calls,
    fetch: (async (_u: unknown, init?: { body?: string }) => {
      calls.push(String(init?.body ?? ""));
      const a = answers.length > 1 ? answers.shift()! : answers[0];
      return { status: a.status, json: async () => a.body } as unknown as Response;
    }) as unknown as typeof fetch,
    sleep: async (ms: number) => {
      t += ms;
    },
    now: () => t,
    say: (m: string) => void said.push(m),
    storage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
  };
}
const grantBody = { items: [], reason: "", academicYearCode: "2026-27", sourceVoucherId: "rcv_9", sourceReceiptNo: "RCV-00009" };
reviewChecks.push(
  (async () => {
    // receipt not in the database yet → asked again until it is
    const d = fakeDeps([
      { status: 409, body: { ok: false, kind: "receipt_pending" } },
      { status: 409, body: { ok: false, kind: "receipt_pending" } },
      { status: 200, body: { ok: true, granted: 1, skipped: 0, pending: 0, ruleLabels: [], blocked: [] } },
    ]);
    const r = await recordCounterGrants(grantBody, d);
    assert.equal(r.ok, true);
    assert.equal(d.calls.length, 3, "waited for the receipt");
    assert.equal(d.store.get(COUNTER_GRANT_QUEUE_KEY) ?? "[]", "[]", "nothing kept");
    // never in the database within the wait → kept, said, retried later
    const d2 = fakeDeps([{ status: 409, body: { ok: false, kind: "receipt_pending", message: "not yet" } }]);
    const r2 = await recordCounterGrants(grantBody, d2);
    assert.equal(r2.ok, false);
    assert.equal(JSON.parse(d2.store.get(COUNTER_GRANT_QUEUE_KEY)!).length, 1, "kept for a retry");
    assert.ok(d2.said.some((m) => /NOT recorded yet/.test(m)), "the clerk is told");
    const d3 = { ...d2, fetch: fakeDeps([{ status: 200, body: { ok: true } }]).fetch };
    assert.equal(await retryQueuedCounterGrants(d3), 0, "the retry records it");
    assert.equal(d2.store.get(COUNTER_GRANT_QUEUE_KEY), "[]");
    // a refusal (403) is not kept, but said
    const d4 = fakeDeps([{ status: 403, body: { ok: false, kind: "auth", message: "no" } }]);
    const r4 = await revokeCounterGrants({ id: "rcv_9", receiptNo: "RCV-00009" }, d4);
    assert.equal(r4.ok, false);
    assert.equal(d4.store.get(COUNTER_GRANT_QUEUE_KEY), undefined, "not kept");
    assert.ok(d4.said.some((m) => /NOT ended yet/.test(m)));
    checks += 1;
  })(),
);

void Promise.all(reviewChecks).then(
  () => console.log(`mastersElementChanges.selftest (review): ok (${checks} checks)`),
  (e: unknown) => {
    console.error(e);
    process.exit(1);
  },
);
