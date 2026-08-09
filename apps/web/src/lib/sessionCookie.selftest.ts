/**
 * Security regression test: a session cookie must not be forgeable.
 *
 * The attack this guards against: a user opens devtools, writes a
 * `bhb_demo_session` cookie claiming `roleCode: "owner"`, and gets
 * Director access. Every case below must be rejected.
 *
 * Run: npx tsx src/lib/sessionCookie.selftest.ts
 */
import assert from "node:assert/strict";

process.env.APP_SESSION_SECRET ||= "test-secret-for-selftest";

import { signSession, verifySessionCookie } from "./sessionCookie.server";
import type { DemoSession } from "./auth";

const session: DemoSession = {
  persona: "parent",
  fullName: "Ramesh Singh",
  roleCode: "parent",
  householdId: "hh_1",
  tenantSlug: "bhb-international",
  academicYearCode: "2025-26",
};

console.log("sessionCookie.selftest.ts");

// --- Round trip -------------------------------------------------------
const signed = signSession(session);
assert.ok(signed, "signSession must produce a value when a secret is set");
const round = verifySessionCookie(signed!);
assert.deepEqual(round, session, "a signed session must verify back unchanged");
console.log("  ok  signed session round-trips");

// --- Forged from scratch (the actual attack) --------------------------
const forgedSession: DemoSession = {
  ...session,
  persona: "staff",
  roleCode: "owner",
  email: "director@bhbinternational.school",
};
const forgedPlain = encodeURIComponent(JSON.stringify(forgedSession));
assert.equal(
  verifySessionCookie(forgedPlain),
  null,
  "hand-written plain-JSON cookie must be rejected",
);
const forgedB64 = Buffer.from(JSON.stringify(forgedSession), "utf8").toString(
  "base64url",
);
assert.equal(
  verifySessionCookie(`${forgedB64}.deadbeef`),
  null,
  "base64 payload with a bogus signature must be rejected",
);
assert.equal(
  verifySessionCookie(forgedB64),
  null,
  "base64 payload with no signature at all must be rejected",
);
console.log("  ok  forged owner cookie rejected (3 variants)");

// --- Tampered payload, signature kept ---------------------------------
const [, realSig] = signed!.split(".");
assert.equal(
  verifySessionCookie(`${forgedB64}.${realSig}`),
  null,
  "swapping the payload while keeping a valid signature must be rejected",
);
console.log("  ok  payload swap under a valid signature rejected");

// --- Legacy unsigned cookies (pre-fix values) -------------------------
assert.equal(
  verifySessionCookie(encodeURIComponent(JSON.stringify(session))),
  null,
  "legacy unsigned cookie must be rejected, not silently trusted",
);
console.log("  ok  legacy unsigned cookie rejected");

// --- Junk -------------------------------------------------------------
for (const bad of ["", "   ", ".", "..", "a.b.c", "%%%.%%%"]) {
  assert.equal(
    verifySessionCookie(bad),
    null,
    `malformed value ${JSON.stringify(bad)} must be rejected`,
  );
}
assert.equal(verifySessionCookie(undefined), null, "missing cookie → null");
console.log("  ok  malformed and missing values rejected");

// --- A different secret must not validate -----------------------------
{
  const original = process.env.APP_SESSION_SECRET;
  process.env.APP_SESSION_SECRET = "a-different-secret";
  assert.equal(
    verifySessionCookie(signed!),
    null,
    "a cookie signed with another secret must be rejected",
  );
  process.env.APP_SESSION_SECRET = original;
}
console.log("  ok  cookie signed with a different secret rejected");

console.log("\nAll session-forgery checks passed.");
