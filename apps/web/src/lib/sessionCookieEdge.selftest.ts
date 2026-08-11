/**
 * Cross-compatibility + forgery-resistance test for the Edge-runtime
 * session verifier against the Node-runtime signer.
 *
 * middleware.ts (Edge) verifies cookies that were signed by signSession()
 * (Node, in the login API routes). If the two implementations ever drift
 * — different secret resolution, different base64url handling — the edge
 * check would either lock everyone out (mismatch on valid cookies) or,
 * worse, silently fail open. Both are caught here.
 *
 * Run: npx tsx src/lib/sessionCookieEdge.selftest.ts
 */
import assert from "node:assert/strict";

process.env.APP_SESSION_SECRET ||= "test-secret-for-selftest";

import { signSession } from "./sessionCookie.server";
import { verifySessionCookieEdge } from "./sessionCookieEdge";
import type { DemoSession } from "./auth";

console.log("sessionCookieEdge.selftest.ts");

const session: DemoSession = {
  persona: "staff",
  fullName: "Ramesh Singh",
  roleCode: "owner",
  tenantSlug: "bhb-international",
  academicYearCode: "2025-26",
};

void (async () => {
  // --- A cookie signed by the Node signer must verify at the edge -------
  const signed = signSession(session);
  assert.ok(signed, "signSession must produce a value when a secret is set");
  const verified = await verifySessionCookieEdge(signed!);
  assert.ok(verified, "a validly-signed cookie must verify at the edge");
  assert.equal(verified!.roleCode, "owner");
  assert.equal(verified!.persona, "staff");

  // --- THE REGRESSION THIS GUARDS: forged cookies must be rejected ------
  assert.equal(
    await verifySessionCookieEdge(undefined),
    null,
    "missing cookie must be rejected",
  );
  assert.equal(
    await verifySessionCookieEdge(""),
    null,
    "empty cookie must be rejected",
  );
  assert.equal(
    await verifySessionCookieEdge("not-a-signed-cookie"),
    null,
    "a value with no signature separator must be rejected",
  );
  assert.equal(
    await verifySessionCookieEdge(
      Buffer.from(JSON.stringify({ persona: "staff", roleCode: "owner" })).toString(
        "base64url",
      ) + ".forged-signature",
    ),
    null,
    "an unsigned/forged payload (devtools cookie edit) must be rejected",
  );

  // Tamper with a validly-signed cookie's payload (bump roleCode from
  // teacher to owner) while keeping the original signature — the classic
  // "edit the cookie in devtools" escalation attempt.
  const teacherSigned = signSession({ ...session, roleCode: "teacher" })!;
  const [origPayload, sig] = teacherSigned.split(".");
  const forgedPayload = Buffer.from(
    JSON.stringify({ ...session, roleCode: "owner" }),
  ).toString("base64url");
  assert.notEqual(forgedPayload, origPayload);
  assert.equal(
    await verifySessionCookieEdge(`${forgedPayload}.${sig}`),
    null,
    "a tampered payload with the original signature must be rejected",
  );

  // --- Signature must be checked byte-for-byte, not loosely -------------
  const truncated = signed!.slice(0, -1);
  assert.equal(
    await verifySessionCookieEdge(truncated),
    null,
    "a truncated signature must be rejected",
  );

  console.log("OK — sessionCookieEdge.selftest.ts");
})();
