/**
 * The Payouts 2FA signature.
 *
 * Its own module, not part of payouts.server.ts, for one reason: it is the
 * piece most likely to be subtly wrong and it is the piece a test can actually
 * prove. Keeping it free of `server-only` lets the selftest generate a keypair,
 * sign, and DECRYPT the result — so "RSA-OAEP with SHA-1, base64" is verified
 * rather than assumed. Get the padding wrong and every payout call 401s with
 * "Signature Mismatched", which looks like a credentials problem and is not.
 *
 * Cloud Run has no static IP, so IP allowlisting is not available to this
 * service and the public-key route is the only 2FA that works here.
 *
 * The signature is valid for five to ten minutes, so it is generated per
 * request. Caching one would work in testing and start failing in production
 * some minutes later, which is the worst shape of bug to chase.
 */

import { createPublicKey, publicEncrypt, constants } from "node:crypto";

export type SignatureResult =
  | { ok: true; signature: string }
  | { ok: false; error: string };

/**
 * Sign `clientId.unixSeconds` with the Payouts public key.
 *
 * Exported with explicit inputs — no env, no clock — so the test can pin the
 * exact bytes. `payoutSignature()` in the server module supplies both.
 *
 * Never throws. An unusable key is a misconfiguration, and an exception here
 * would take down a salary run instead of reporting one.
 */
export function payoutSignatureFrom(input: {
  clientId: string;
  /** The .pem downloaded from Payouts → Two-Factor Authentication. */
  publicKeyPem: string;
  unixSeconds: number;
}): SignatureResult {
  const clientId = (input.clientId || "").trim();
  if (!clientId) return { ok: false, error: "No Payouts client id configured" };

  const pem = (input.publicKeyPem || "").trim();
  if (!pem) return { ok: false, error: "No Payouts public key configured" };
  if (!Number.isFinite(input.unixSeconds)) {
    return { ok: false, error: "Invalid timestamp for the signature" };
  }

  try {
    // Accepts the .pem as downloaded. An environment variable often carries it
    // with literal \n, which createPublicKey will not parse, so those are
    // restored — a key that looks right and fails to load is otherwise a very
    // quiet misconfiguration.
    const key = createPublicKey(pem.includes("\\n") ? pem.replace(/\\n/g, "\n") : pem);
    const payload = `${clientId}.${Math.floor(input.unixSeconds)}`;
    const encrypted = publicEncrypt(
      {
        key,
        // RSA/ECB/OAEPWithSHA-1AndMGF1Padding, which is what Cashfree's own
        // samples use. Node defaults OAEP to SHA-1 but it is set explicitly:
        // a future default change would silently break every payout.
        padding: constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha1",
      },
      Buffer.from(payload, "utf8"),
    );
    return { ok: true, signature: encrypted.toString("base64") };
  } catch (e) {
    return {
      ok: false,
      error: `Could not sign with the Payouts public key: ${e instanceof Error ? e.message : "unknown error"}`,
    };
  }
}
