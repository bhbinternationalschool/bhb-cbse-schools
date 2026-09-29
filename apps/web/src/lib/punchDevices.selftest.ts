/**
 * punchDevices — a punch signed by the phone's key verifies; the same
 * signature for another staff, kind, code or time does not; another
 * phone's key does not; keys are named by their public half.
 * Run: npx tsx src/lib/punchDevices.selftest.ts
 */
import { webcrypto } from "crypto";
import { cleanJwk, deviceIdOf, punchMessage, verifyPunchSignature } from "./punchDevices.server";

let failed = 0;
function expect(label: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    failed += 1;
    console.error(`FAIL ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

async function phone() {
  // As the browser does: private half non-extractable.
  const pair = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
  const jwk = await webcrypto.subtle.exportKey("jwk", pair.publicKey);
  const sign = async (msg: string) =>
    Buffer.from(
      await webcrypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, new TextEncoder().encode(msg)),
    ).toString("base64url");
  return { jwk: cleanJwk(jwk)!, sign };
}

(async () => {
  const mine = await phone();
  const other = await phone();
  expect("jwk accepted", !!mine.jwk, true);
  expect("bad jwk refused", cleanJwk({ kty: "RSA", n: "x" }), null);
  expect("device ids differ", deviceIdOf(mine.jwk) !== deviceIdOf(other.jwk), true);
  expect("device id stable", deviceIdOf(mine.jwk), deviceIdOf({ ...mine.jwk }));

  const p = { staffId: "stf_a", kind: "in", code: "482913", ts: 1_790_000_000_000 };
  const sig = await mine.sign(punchMessage(p));
  expect("own signature verifies", await verifyPunchSignature(mine.jwk, punchMessage(p), sig), true);
  expect("other staff refused", await verifyPunchSignature(mine.jwk, punchMessage({ ...p, staffId: "stf_b" }), sig), false);
  expect("other kind refused", await verifyPunchSignature(mine.jwk, punchMessage({ ...p, kind: "out" }), sig), false);
  expect("other code refused", await verifyPunchSignature(mine.jwk, punchMessage({ ...p, code: "000000" }), sig), false);
  expect("other time refused", await verifyPunchSignature(mine.jwk, punchMessage({ ...p, ts: p.ts + 1 }), sig), false);
  expect("other phone's key refused", await verifyPunchSignature(other.jwk, punchMessage(p), sig), false);
  expect("garbage signature refused", await verifyPunchSignature(mine.jwk, punchMessage(p), "abc"), false);

  if (failed) {
    console.error(`punchDevices: ${failed} failure(s)`);
    process.exit(1);
  }
  console.log("punchDevices: ok");
})();
