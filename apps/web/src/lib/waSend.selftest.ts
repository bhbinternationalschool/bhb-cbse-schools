/**
 * Run: npx tsx src/lib/waSend.selftest.ts
 *
 * Exercises only the pure logic — shouldRetryWithFallback(). Actually
 * sending (sendWhatsAppText/sendWhatsAppTemplate/sendWaWithFailover) needs
 * live Meta/BSP config and a live Supabase service-role client for the
 * opt-out/window checks, so those are verified live against the real
 * dispatch route instead.
 */
import assert from "node:assert/strict";

import { shouldRetryWithFallback } from "./waSend";

console.log("waSend.selftest.ts");

// --- retries when the primary genuinely failed for a number-specific reason
{
  assert.equal(
    shouldRetryWithFallback({
      primaryResult: { ok: false, mode: "none" },
      primaryMobile: "9876543210",
      fallbackMobile: "9123456789",
    }),
    true,
    "opted-out/invalid/window-blocked (mode:none) primary should retry a distinct fallback",
  );
  assert.equal(
    shouldRetryWithFallback({
      primaryResult: { ok: false, mode: "meta" },
      primaryMobile: "9876543210",
      fallbackMobile: "9123456789",
    }),
    true,
    "a Meta API rejection should retry a distinct fallback",
  );
  assert.equal(
    shouldRetryWithFallback({
      primaryResult: { ok: false, mode: "bsp" },
      primaryMobile: "9876543210",
      fallbackMobile: "9123456789",
    }),
    true,
    "a BSP rejection should retry a distinct fallback",
  );
}

// --- never retries when the primary actually succeeded --------------------
{
  assert.equal(
    shouldRetryWithFallback({
      primaryResult: { ok: true, mode: "meta" },
      primaryMobile: "9876543210",
      fallbackMobile: "9123456789",
    }),
    false,
    "a successful primary send must never trigger a retry",
  );
}

// --- never retries when the provider isn't configured at all --------------
{
  assert.equal(
    shouldRetryWithFallback({
      primaryResult: { ok: false, mode: "stub" },
      primaryMobile: "9876543210",
      fallbackMobile: "9123456789",
    }),
    false,
    "stub mode means no provider is configured — a different number can't fix that",
  );
}

// --- never retries without a usable, distinct fallback ---------------------
{
  assert.equal(
    shouldRetryWithFallback({
      primaryResult: { ok: false, mode: "meta" },
      primaryMobile: "9876543210",
      fallbackMobile: undefined,
    }),
    false,
    "no fallback number on file — nothing to retry",
  );
  assert.equal(
    shouldRetryWithFallback({
      primaryResult: { ok: false, mode: "meta" },
      primaryMobile: "9876543210",
      fallbackMobile: "",
    }),
    false,
    "empty fallback string — nothing to retry",
  );
  assert.equal(
    shouldRetryWithFallback({
      primaryResult: { ok: false, mode: "meta" },
      primaryMobile: "9876543210",
      fallbackMobile: "987654321",
    }),
    false,
    "a too-short fallback (9 digits) is not a usable number",
  );
  assert.equal(
    shouldRetryWithFallback({
      primaryResult: { ok: false, mode: "meta" },
      primaryMobile: "9876543210",
      fallbackMobile: "9876543210",
    }),
    false,
    "fallback identical to the primary — retrying the same number again is pointless",
  );
  assert.equal(
    shouldRetryWithFallback({
      primaryResult: { ok: false, mode: "meta" },
      primaryMobile: "9876543210",
      // Same number, different formatting (bare 10-digit vs 91-prefixed) —
      // must still be recognized as identical after normalization.
      fallbackMobile: "919876543210",
    }),
    false,
    "fallback that normalizes to the same E.164 number as the primary must not retry",
  );
}

console.log("OK — waSend.selftest.ts");
