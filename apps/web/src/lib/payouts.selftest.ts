/**
 * Self-test: Cashfree Payouts, the pure half, plus the 2FA signature.
 * Run: npx tsx apps/web/src/lib/payouts.selftest.ts
 *
 * This moves salary money, so the assertions are about the three mistakes that
 * cannot be walked back: paying somebody twice, marking an unpaid salary paid,
 * and losing a REVERSED transfer (sent, then returned by the bank days later —
 * the salary is unpaid again and nothing else would notice).
 *
 * The signature is round-tripped against a keypair generated in the test, so
 * "RSA-OAEP with SHA-1, base64" is verified by decrypting it rather than by
 * trusting the call shape.
 */
import assert from "node:assert/strict";
import { generateKeyPairSync, privateDecrypt, constants } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildBeneficiaryBody,
  buildTransferBody,
  IMPS_MAX_PAISE,
  payoutIsInFlight,
  payoutIsPaid,
  payoutModeFor,
  payoutNeedsAttention,
  payoutSentence,
  payoutTransferId,
  readPayoutStatus,
  readPayoutTransfer,
  shouldRetryTransfer,
  type PayoutStatus,
} from "@/lib/payouts";
import { payoutSignatureFrom } from "@/lib/payoutsSignature";

console.log("payouts.selftest.ts");

/* ── only SUCCESS clears a payable ────────────────────────────────────── */
{
  assert.equal(payoutIsPaid("SUCCESS"), true);
  // Every one of these must be false. Any of them reading as paid leaves a
  // staff member unpaid with the book saying otherwise.
  for (const s of [
    "RECEIVED",
    "APPROVAL_PENDING",
    "PENDING",
    "FAILED",
    "REJECTED",
    "REVERSED",
    "UNKNOWN",
  ] as PayoutStatus[]) {
    assert.equal(payoutIsPaid(s), false, `${s} must not count as paid`);
  }

  // REVERSED is the subtle one: it succeeded and then came back. It needs
  // attention, and it is NOT in flight — waiting for it would wait for ever.
  assert.equal(payoutNeedsAttention("REVERSED"), true, "a returned transfer is unpaid again");
  assert.equal(payoutIsInFlight("REVERSED"), false);
  assert.equal(payoutNeedsAttention("FAILED"), true);
  assert.equal(payoutNeedsAttention("REJECTED"), true);
  assert.equal(payoutNeedsAttention("PENDING"), false, "in flight is not a failure to act on");
  assert.equal(payoutIsInFlight("PENDING"), true);
  assert.equal(payoutIsInFlight("APPROVAL_PENDING"), true);
  assert.equal(payoutIsInFlight("RECEIVED"), true);

  // An unrecognised status is UNKNOWN, never SUCCESS.
  for (const odd of ["COMPLETED", "PAID", "DONE", "OK", "", "success!"]) {
    assert.equal(readPayoutStatus(odd), "UNKNOWN", `${odd || "(empty)"} must not become SUCCESS`);
  }
  assert.equal(readPayoutStatus("success"), "SUCCESS", "case is not a signal");
  assert.equal(readPayoutStatus(" Reversed "), "REVERSED");
  // UNKNOWN is deliberately neither paid, in flight, nor actionable-as-failed:
  // somebody has to look, and the sentence says so.
  assert.equal(payoutIsInFlight("UNKNOWN"), false);
  assert.equal(payoutNeedsAttention("UNKNOWN"), false);
}

/* ── a 5XX is never retried ──────────────────────────────────────────── */
{
  // Cashfree's own rule. A 5XX is not evidence that nothing happened, and
  // re-sending is how one salary becomes two.
  for (const code of [500, 502, 503, 504, 429, 400]) {
    assert.equal(shouldRetryTransfer(code), false, `HTTP ${code} must not be retried`);
  }
}

/* ── the transfer id is deterministic, which is what stops a double pay ── */
{
  const a = payoutTransferId({ kind: "sal", subjectId: "stf_9a1", period: "2026-09", amountPaise: 4_200_000 });
  const b = payoutTransferId({ kind: "sal", subjectId: "stf_9a1", period: "2026-09", amountPaise: 4_200_000 });
  assert.equal(a, b, "the same salary asked for twice must carry the same id");
  assert.match(a, /^[A-Za-z0-9_-]{3,40}$/, "and be valid for Cashfree");

  // Different person, month, or amount = a different payment, which it is.
  assert.notEqual(a, payoutTransferId({ kind: "sal", subjectId: "stf_9a2", period: "2026-09", amountPaise: 4_200_000 }));
  assert.notEqual(a, payoutTransferId({ kind: "sal", subjectId: "stf_9a1", period: "2026-10", amountPaise: 4_200_000 }));
  assert.notEqual(a, payoutTransferId({ kind: "sal", subjectId: "stf_9a1", period: "2026-09", amountPaise: 4_300_000 }));

  // Never over 40 chars and never invalid, however long the inputs — an id
  // Cashfree rejects means the salary silently never goes out.
  for (const subjectId of ["s", "x".repeat(80), "stf/with slashes", "«unicode»"]) {
    const id = payoutTransferId({ kind: "salary-run", subjectId, period: "2026-09-monthly", amountPaise: 1 });
    assert.ok(id.length <= 40, `${subjectId}: ${id.length} chars`);
    assert.match(id, /^[A-Za-z0-9_-]{3,40}$/, `${subjectId} produced ${id}`);
  }
}

/* ── IMPS below its cap, NEFT above it ───────────────────────────────── */
{
  assert.equal(payoutModeFor(4_200_000), "imps", "a normal salary goes instantly");
  assert.equal(payoutModeFor(IMPS_MAX_PAISE), "imps", "exactly at the cap is still IMPS");
  // Over the cap IMPS is REJECTED by the bank. For a salary run that means one
  // person unpaid and nobody looking, so the mode has to change by itself.
  assert.equal(payoutModeFor(IMPS_MAX_PAISE + 1), "neft");
  assert.equal(payoutModeFor(10_000_000_00), "neft");
}

/* ── the request bodies ──────────────────────────────────────────────── */
{
  const ben = buildBeneficiaryBody({
    beneficiaryId: "stf_9a1",
    name: "Kamlesh Kumar",
    accountNumber: "0123 4567 8901",
    ifsc: "ubin0812345",
    phone: "+91 94519 38805",
  });
  assert.ok(ben.ok, ben.ok ? "" : ben.error);
  if (!ben.ok) throw new Error("unreachable");
  assert.equal(ben.body.beneficiary_instrument_details.bank_account_number, "012345678901");
  assert.equal(ben.body.beneficiary_instrument_details.bank_ifsc, "UBIN0812345");
  assert.equal(ben.body.beneficiary_contact_details?.beneficiary_phone, "9451938805");

  for (const bad of [
    { beneficiaryId: "x", name: "A", accountNumber: "012345", ifsc: "UBIN0812345", why: "id too short" },
    { beneficiaryId: "stf_1", name: "", accountNumber: "012345", ifsc: "UBIN0812345", why: "no name" },
    { beneficiaryId: "stf_1", name: "A", accountNumber: "123", ifsc: "UBIN0812345", why: "account too short" },
    { beneficiaryId: "stf_1", name: "A", accountNumber: "012345", ifsc: "BAD", why: "bad IFSC" },
  ]) {
    assert.equal(buildBeneficiaryBody(bad).ok, false, `${bad.why} must be refused`);
  }

  const tr = buildTransferBody({
    transferId: "sal_stf9a1_202609_4200000",
    beneficiaryId: "stf_9a1",
    amountPaise: 4_200_000,
    remarks: "Salary September 2026",
  });
  assert.ok(tr.ok, tr.ok ? "" : tr.error);
  if (!tr.ok) throw new Error("unreachable");
  // RUPEES, to two places. Sending paise here would pay a hundred times the salary.
  assert.equal(tr.body.transfer_amount, 42000, "42,000 rupees, not 4,200,000");
  assert.equal(tr.body.transfer_currency, "INR");
  assert.equal(tr.body.transfer_mode, "imps");
  assert.equal(tr.body.beneficiary_details.beneficiary_id, "stf_9a1");

  // A big transfer picks NEFT on its own.
  const big = buildTransferBody({
    transferId: "sal_x_1",
    beneficiaryId: "stf_9a1",
    amountPaise: IMPS_MAX_PAISE + 100,
  });
  assert.ok(big.ok);
  if (big.ok) assert.equal(big.body.transfer_mode, "neft");

  for (const bad of [0, 99, -1, Number.NaN]) {
    assert.equal(
      buildTransferBody({ transferId: "sal_x_1", beneficiaryId: "stf_9a1", amountPaise: bad }).ok,
      false,
      `${bad} must not be transferable`,
    );
  }
  assert.equal(
    buildTransferBody({ transferId: "not/valid", beneficiaryId: "stf_9a1", amountPaise: 5000 }).ok,
    false,
    "an id Cashfree would reject is refused before the call",
  );
}

/* ── reading a transfer, from a reply or a webhook ───────────────────── */
{
  const reply = readPayoutTransfer({
    transfer_id: "sal_stf9a1_202609_4200000",
    cf_transfer_id: 99887766,
    status: "SUCCESS",
    transfer_amount: 42000,
    transfer_utr: "226109988776",
  });
  assert.ok(reply);
  assert.equal(reply!.status, "SUCCESS");
  assert.equal(reply!.amountPaise, 4_200_000, "rupees come back as paise exactly");
  assert.equal(reply!.cfTransferId, "99887766", "a numeric id is stringified, never a float");
  assert.equal(reply!.utr, "226109988776");
  assert.match(payoutSentence(reply!), /paid/);
  assert.match(payoutSentence(reply!), /226109988776/);

  const hook = readPayoutTransfer({
    type: "TRANSFER_REVERSED",
    data: { transfer_id: "sal_x", status: "REVERSED", transfer_amount: 42000 },
  });
  assert.ok(hook);
  assert.equal(hook!.status, "REVERSED");
  // The sentence must say it is unpaid AGAIN, not merely that something failed.
  assert.match(payoutSentence(hook!), /returned by the bank/);
  assert.match(payoutSentence(hook!), /unpaid again/);

  const pending = readPayoutTransfer({ transfer_id: "sal_y", status: "PENDING", transfer_amount: 100 });
  assert.match(payoutSentence(pending!), /Not paid yet/);

  // Not a transfer → null, so an error body is never read as a payment.
  for (const junk of [null, undefined, "", 7, {}, [], { message: "unauthorised" }, { data: {} }]) {
    assert.equal(readPayoutTransfer(junk), null, `${JSON.stringify(junk)} is not a transfer`);
  }
}

/* ── the 2FA signature, round-tripped against a real keypair ─────────── */
{
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  const clientId = "CF_TEST_CLIENT";
  const at = 1_774_000_000;
  const sig = payoutSignatureFrom({ clientId, publicKeyPem: publicKey, unixSeconds: at });
  assert.ok(sig.ok, sig.ok ? "" : sig.error);
  if (!sig.ok) throw new Error("unreachable");

  // Decrypted rather than trusted: RSA-OAEP with SHA-1 is what Cashfree
  // specifies, and getting the padding wrong 401s every single call.
  const plain = privateDecrypt(
    { key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha1" },
    Buffer.from(sig.signature, "base64"),
  ).toString("utf8");
  assert.equal(plain, `${clientId}.${at}`, "the payload is clientId.unixSeconds");

  // Base64, and it changes with the timestamp — the signature is only valid for
  // 5 to 10 minutes, so a cached one would start failing silently.
  assert.match(sig.signature, /^[A-Za-z0-9+/]+=*$/);
  const later = payoutSignatureFrom({ clientId, publicKeyPem: publicKey, unixSeconds: at + 1 });
  assert.ok(later.ok);
  if (later.ok) assert.notEqual(later.signature, sig.signature, "a new timestamp is a new signature");

  // A key that is not a key fails as a refusal, not a throw: an exception here
  // would take down a salary run rather than reporting a misconfiguration.
  const bad = payoutSignatureFrom({ clientId, publicKeyPem: "not a pem", unixSeconds: at });
  assert.equal(bad.ok, false);
  const empty = payoutSignatureFrom({ clientId, publicKeyPem: "", unixSeconds: at });
  assert.equal(empty.ok, false);
  const noClient = payoutSignatureFrom({ clientId: "", publicKeyPem: publicKey, unixSeconds: at });
  assert.equal(noClient.ok, false, "no client id means no signature");
}

/* ── the wiring: salary is NOT switched over yet ─────────────────────── */
{
  const read = (rel: string) =>
    readFileSync(
      join(process.cwd(), process.cwd().endsWith("apps/web") ? "src" : "apps/web/src", rel),
      "utf8",
    );

  const server = read("lib/payouts.server.ts");
  // Payouts is its own product on its own host with its own credentials.
  assert.match(server, /cashfree\.com\/payout/, "the payout host, not the PG base");
  assert.match(server, /CASHFREE_PAYOUT_CLIENT_ID/, "its own client id");
  assert.match(server, /X-Cf-Signature/i, "2FA signature header");
  // The documented rule, honoured where it matters.
  assert.match(server, /shouldRetryTransfer/, "the no-retry rule is consulted, not remembered");

  // The bank file remains the default. Nothing may move salary onto payouts
  // until a sandbox round-trip has confirmed the V2 field names, which could
  // not be verified from the build container.
  const bankFile = read("lib/bankFileExport.ts");
  assert.doesNotMatch(
    bankFile,
    /payouts?\.server|requestPayoutTransfer/,
    "the NEFT bank file must not yet call payouts — the switchover is deliberate and separate",
  );
}

console.log("  ok");
