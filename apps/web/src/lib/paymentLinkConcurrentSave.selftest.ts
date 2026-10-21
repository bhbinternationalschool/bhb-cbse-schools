/**
 * Self-test: a pay-link saved by two writers at once is still saved, and a
 * link never carries one due twice.
 * Run: npx tsx apps/web/src/lib/paymentLinkConcurrentSave.selftest.ts
 *
 * CI, 20 Oct 2026 (PRs #678, #683): the parent checkout answered 503 "Could
 * not start payment just now" because creating a link saves it twice at the
 * same moment — savePayments starts the whole-desk save, and the route then
 * saves the link itself. The loser of that race got
 *   payment_desk_links_tenant_id_code_key  (the header, on its code), or
 *   payment_desk_link_lines_pkey           (a line, replace_child_rows)
 * although the rows it was writing were, by then, stored exactly.
 *
 * The client below answers the way Postgres answered the loser: a unique
 * violation on the first write, success when written again.
 */
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FeeDueLine } from "./fees";
import type { PaymentLink } from "./payments";

console.log("paymentLinkConcurrentSave.selftest.ts");

const store = new Map<string, string>();
(globalThis as unknown as { window: unknown }).window = Object.assign(globalThis, {
  addEventListener: () => {},
  removeEventListener: () => {},
});
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
};

type Fail = { code?: string; message: string } | null;

/** A fake client: `headerFails` / `linesFail` are the answers to the first writes, in order. */
function fakeClient(opts: { headerFails?: Fail[]; linesFail?: Fail[] }) {
  const headerFails = [...(opts.headerFails ?? [])];
  const linesFail = [...(opts.linesFail ?? [])];
  const calls = { header: 0, lines: 0, linesRows: [] as unknown[][] };
  const select = () => {
    const q = { eq: () => q, maybeSingle: async () => ({ data: null, error: null }) };
    return q;
  };
  const sb = {
    from: (table: string) => ({
      select,
      upsert: async () => {
        if (table !== "payment_desk_links") return { error: null };
        calls.header += 1;
        return { error: headerFails.shift() ?? null };
      },
    }),
    rpc: async (_fn: string, args: { p_rows: unknown[] }) => {
      calls.lines += 1;
      calls.linesRows.push(args.p_rows);
      const e = linesFail.shift() ?? null;
      return e ? { data: null, error: e } : { data: { rows: args.p_rows.length }, error: null };
    },
  };
  return { sb: sb as unknown as SupabaseClient, calls };
}

const CODE_RACE = { code: "23505", message: 'duplicate key value violates unique constraint "payment_desk_links_tenant_id_code_key"' };
const LINE_RACE = { code: "23505", message: 'duplicate key value violates unique constraint "payment_desk_link_lines_pkey"' };

const due = (dueKey: string, balancePaise: number, dueOn = "2026-10-10") =>
  ({ dueKey, studentId: "st1", label: dueKey, kind: "transport", dueOn, balancePaise, billedPaise: balancePaise, paidPaise: 0 }) as unknown as FeeDueLine;

const failures: string[] = [];
async function check(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures.push(`  FAIL ${name}: ${(err as Error).message.split("\n")[0]}`);
    console.log(failures[failures.length - 1]);
  }
}

async function main() {
  const { writePaymentLinkToDb, isUniqueRace } = await import("./paymentsNormalized.server");
  const { createPaymentLink, uniqueDuesByKey } = await import("./payments");

  const link = {
    id: "pl_race",
    code: "PL-RACE",
    householdId: "hh1",
    studentId: "st1",
    studentName: "A",
    classLabel: "IV-B",
    academicYearCode: "2026-27",
    amountPaise: 50000,
    lines: [{ dueKey: "transport:st1:ta_new:2026-10", studentId: "st1", studentName: "A", label: "Transport · October 2026", kind: "transport", amountPaise: 50000 }],
    status: "open",
    createdAt: "2026-10-20T13:47:28.000Z",
    createdBy: "Parent portal",
    expiresOn: "2026-10-27",
    upiRef: "",
    paidAt: null,
    voucherId: null,
    receiptNo: null,
    note: "Parent portal",
  } as unknown as PaymentLink;

  await check("the header lost the race on its code → written again, saved", async () => {
    const { sb, calls } = fakeClient({ headerFails: [CODE_RACE] });
    const r = await writePaymentLinkToDb(sb, "t1", link);
    assert.equal(r.ok, true, r.error);
    assert.equal(calls.header, 2);
    assert.equal(calls.lines, 1);
  });

  await check("a line lost the race (replace_child_rows) → written again, saved", async () => {
    const { sb, calls } = fakeClient({ linesFail: [LINE_RACE] });
    const r = await writePaymentLinkToDb(sb, "t1", link);
    assert.equal(r.ok, true, r.error);
    assert.equal(calls.lines, 2);
  });

  await check("a write that keeps failing on a unique key stops after three tries and says so", async () => {
    const { sb, calls } = fakeClient({ headerFails: [CODE_RACE, CODE_RACE, CODE_RACE, CODE_RACE] });
    const r = await writePaymentLinkToDb(sb, "t1", link);
    assert.equal(r.ok, false);
    assert.match(String(r.error), /payment_desk_links_tenant_id_code_key/);
    assert.equal(calls.header, 3);
  });

  await check("any other error is not retried", async () => {
    const { sb, calls } = fakeClient({ headerFails: [{ code: "42501", message: "permission denied for table payment_desk_links" }] });
    const r = await writePaymentLinkToDb(sb, "t1", link);
    assert.equal(r.ok, false);
    assert.equal(calls.header, 1);
    assert.equal(calls.lines, 0);
  });

  await check("isUniqueRace knows the code and the message, and nothing else", () => {
    assert.equal(isUniqueRace(CODE_RACE), true);
    assert.equal(isUniqueRace(`payment_desk_link_lines not replaced (nothing was changed): ${LINE_RACE.message}`), true);
    assert.equal(isUniqueRace("permission denied"), false);
    assert.equal(isUniqueRace(null), false);
  });

  await check("one due listed twice → ONE line on the link, for that due's balance (never the sum)", () => {
    const k = "transport:st1:ta_new:2026-10";
    const r = createPaymentLink({
      householdId: "hh_dup",
      studentId: "st1",
      studentName: "A",
      classLabel: "IV-B",
      createdBy: "Parent portal",
      dues: [due(k, 50000), due(k, 50000), due("acad:st1:oct", 120000)],
      fresh: true,
    });
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.deepEqual(r.link.lines.map((l) => l.dueKey).sort(), ["acad:st1:oct", k]);
    assert.equal(r.link.amountPaise, 170000);
    assert.equal(r.link.lines.find((l) => l.dueKey === k)!.amountPaise, 50000);
  });

  await check("two copies that disagree keep the smaller balance", () => {
    const out = uniqueDuesByKey([due("a", 50000), due("a", 30000), due("b", 1)]);
    assert.deepEqual(out.map((d) => [d.dueKey, d.balancePaise]), [["a", 30000], ["b", 1]]);
    const same = [due("a", 1), due("b", 2)];
    assert.equal(uniqueDuesByKey(same), same, "nothing repeated → the same list");
  });

  if (failures.length) {
    console.error(`\n${failures.length} failed:\n${failures.join("\n")}`);
    process.exit(1);
  }
  console.log("paymentLinkConcurrentSave.selftest.ts: all passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
