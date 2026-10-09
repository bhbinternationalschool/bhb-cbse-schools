import assert from "node:assert/strict";
import type { PaymentLink } from "./payments";

console.log("paymentLinkReuse.selftest.ts");

/**
 * The same family asking for the same money gets the open link it already
 * has, not a new gateway order (director, 9 Oct 2026: 13 links for one
 * family's ₹19,300; a double tap made two orders 17 seconds apart).
 */

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

async function main() {
  const { createPaymentLink, findReusablePaymentLink, cancelPaymentLink, reusableCheckoutUrl, patchPaymentLink } = await import("./payments");
  const { singleFlight } = await import("./singleFlight");
  const due = (dueKey: string, balancePaise: number, dueOn: string) =>
    ({ dueKey, studentId: "st1", label: dueKey, kind: "academic", dueOn, balancePaise, billedPaise: balancePaise, paidPaise: 0 }) as never;
  const base = { householdId: "hh1", studentId: "st1", studentName: "A", classLabel: "IV-B", createdBy: "Parent", note: "Parent portal" };
  const dues = [due("apr", 100000, "2026-04-01"), due("may", 150000, "2026-05-01")];

  const a = createPaymentLink({ ...base, dues });
  assert.ok(a.ok && !a.reused);
  if (!a.ok) return;
  const b = createPaymentLink({ ...base, dues });
  assert.ok(b.ok && b.reused, "same family, same dues, same place → the open link");
  if (!b.ok) return;
  assert.equal(b.link.id, a.link.id);

  // No gateway on it yet → the caller still attaches one.
  assert.equal(reusableCheckoutUrl(b, "cashfree"), "");
  patchPaymentLink(a.link.id, { gatewayMode: "cashfree", gatewayCheckoutUrl: "https://pay/x", gatewayExternalId: "x" });
  const c = createPaymentLink({ ...base, dues });
  assert.ok(c.ok);
  if (!c.ok) return;
  assert.equal(reusableCheckoutUrl(c, "cashfree"), "https://pay/x", "the open checkout is handed back");
  assert.equal(reusableCheckoutUrl(c, "razorpay"), "", "never another gateway's checkout");

  // Different money, rail, child or a forced fresh link → a new link.
  const part = createPaymentLink({ ...base, dues, targetPaise: 120000 });
  assert.ok(part.ok && !part.reused, "a part payment is a different ask");
  const upi = createPaymentLink({ ...base, dues, note: "Parent portal · upi" });
  assert.ok(upi.ok && !upi.reused, "a different rail is a different gateway order");
  const fresh = createPaymentLink({ ...base, dues, fresh: true });
  assert.ok(fresh.ok && !fresh.reused, "auto-pay always mints its own");

  // A cancelled or expiring-today link is never reused.
  if (!upi.ok) return;
  cancelPaymentLink(upi.link.id);
  const again = createPaymentLink({ ...base, dues, note: "Parent portal · upi" });
  assert.ok(again.ok && !again.reused, "a cancelled link is not handed back");
  if (!again.ok) return;
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const expiring = { ...again.link, expiresOn: today } as PaymentLink;
  assert.equal(
    findReusablePaymentLink([expiring], { householdId: "hh1", studentId: "st1", note: expiring.note, lines: expiring.lines, amountPaise: expiring.amountPaise }, today),
    undefined,
    "a link dying tonight is not handed out",
  );

  // Two concurrent taps run once.
  let runs = 0;
  const slow = () => new Promise<number>((r) => setTimeout(() => r(++runs), 20));
  const [x, y] = await Promise.all([singleFlight("k", slow), singleFlight("k", slow)]);
  assert.equal(runs, 1);
  assert.equal(x, y);
  await singleFlight("k", slow);
  assert.equal(runs, 2, "a later call runs again");

  console.log("paymentLinkReuse.selftest: all assertions passed");
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
