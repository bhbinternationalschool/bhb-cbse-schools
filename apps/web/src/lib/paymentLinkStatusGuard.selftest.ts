import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { linkStatusRegresses } from "./paymentLinkStatusGuard";

console.log("paymentLinkStatusGuard.selftest.ts");

/**
 * A payment link's status only moves forward: open → paid/cancelled/expired,
 * and a late payment may still mark a cancelled or expired link paid. A save
 * from a stale copy (an office tab, or the server's own cached list) must not
 * write "open" back over "paid". This pins the rule and that both writers
 * apply it, by reading their code.
 */

// ── The rule ───────────────────────────────────────────────────────────────
assert.equal(linkStatusRegresses("paid", "open"), true, "paid → open is refused");
assert.equal(linkStatusRegresses("paid", "cancelled"), true, "paid → cancelled is refused");
assert.equal(linkStatusRegresses("paid", "expired"), true, "paid → expired is refused");
assert.equal(linkStatusRegresses("cancelled", "open"), true, "cancelled → open is refused");
assert.equal(linkStatusRegresses("expired", "open"), true, "expired → open is refused");
assert.equal(linkStatusRegresses("paid", "paid"), false, "a paid link may be re-saved as paid");
assert.equal(linkStatusRegresses("open", "paid"), false);
assert.equal(linkStatusRegresses("open", "cancelled"), false);
assert.equal(linkStatusRegresses("open", "open"), false);
assert.equal(linkStatusRegresses("expired", "paid"), false, "a late payment still lands");
assert.equal(linkStatusRegresses("cancelled", "paid"), false, "a payment after cancel still lands");
assert.equal(linkStatusRegresses("cancelled", "expired"), false, "lateral between closed states is allowed");
assert.equal(linkStatusRegresses(undefined, "open"), false, "a new link");
assert.equal(linkStatusRegresses("paid", "refunded-ish"), true, "an unknown status never replaces a known one");

// ── Both writers apply it before writing ───────────────────────────────────
{
  const src = readFileSync(join(__dirname, "paymentsNormalized.server.ts"), "utf8");
  const many = src.slice(src.indexOf("export async function pushPaymentLinksToDb"), src.indexOf("export async function fetchPaymentLinksFromDb") > 0 ? src.indexOf("export async function fetchPaymentLinksFromDb") : undefined);
  assert.ok(/linkStatusRegresses\(storedStatus\.get\(l\.id\), l\.status\)/.test(many), "the whole-desk save checks each link");
  assert.ok(many.indexOf("linkStatusRegresses(") < many.indexOf('.from("payment_desk_links")\n      .upsert('), "before writing headers");
  assert.ok(/for \(const link of writable\)/.test(many) && /const linkIds = new Set\(writable\.map/.test(many), "kept links' lines are not rewritten either");
  assert.ok(/if \(read\.error\) \{\s*return \{ ok: false/.test(many), "unreadable statuses → nothing written");

  const one = src.slice(src.indexOf("export async function pushPaymentLinkToDb"));
  assert.ok(one.indexOf("linkStatusRegresses(stored, link.status)") > 0, "the single-link save checks too");
  assert.ok(one.indexOf("linkStatusRegresses(") < one.indexOf('.from("payment_desk_links").upsert(header)'));

  const client = readFileSync(join(__dirname, "paymentsNormalizedClient.ts"), "utf8");
  assert.ok(/if \(body\.kept\?\.length\)[\s\S]*?resetDeskHydrated\("payments"\)/.test(client), "a browser whose links were kept reloads them");
}

console.log("paymentLinkStatusGuard.selftest: all assertions passed");
