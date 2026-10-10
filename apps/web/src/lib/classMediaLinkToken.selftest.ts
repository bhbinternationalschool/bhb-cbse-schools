import assert from "node:assert/strict";
import { signClassMediaLink, verifyClassMediaLink } from "./classMediaLinkToken.server";

console.log("classMediaLinkToken.selftest.ts");
const now = Date.parse("2026-10-10T10:00:00Z");
const s = signClassMediaLink("pho_abc", now)!;
assert.ok(s && s.exp > now / 1000);
assert.equal(verifyClassMediaLink("pho_abc", String(s.exp), s.sig, now), true);
assert.equal(verifyClassMediaLink("pho_abc", String(s.exp), s.sig, now + 11 * 60_000), false, "expires after ten minutes");
assert.equal(verifyClassMediaLink("pho_other", String(s.exp), s.sig, now), false, "bound to one item");
assert.equal(verifyClassMediaLink("pho_abc", String(s.exp + 600), s.sig, now), false, "expiry cannot be stretched");
assert.equal(verifyClassMediaLink("pho_abc", null, s.sig, now), false);
assert.equal(verifyClassMediaLink("pho_abc", String(s.exp), "", now), false);
console.log("classMediaLinkToken.selftest: all assertions passed");
