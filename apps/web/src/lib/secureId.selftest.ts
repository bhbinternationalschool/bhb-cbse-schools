/**
 * Self-test: bank-account verification, the pure half.
 * Run: npx tsx apps/web/src/lib/secureId.selftest.ts
 *
 * The whole point of this check is catching an account that EXISTS but belongs
 * to somebody else. So the assertions that matter most are the ones that stop
 * a near-match, an unrecognised status or a missing answer from reading as
 * "safe to pay" — a verification that says yes too easily is worse than no
 * verification at all, because the school would then trust it.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  bankFingerprintSource,
  bankIsUnverifiable,
  bankVerdict,
  buildBankVerifyRequest,
  ifscLooksValid,
  maskAccount,
  NAME_MATCH_THRESHOLD,
  normaliseName,
  readBankVerifyResult,
  safeToPay,
  verdictSentence,
} from "@/lib/secureId";

console.log("secureId.selftest.ts");

/* ── the request, and what is refused before a paid call is spent ──────── */
{
  const ok = buildBankVerifyRequest({
    accountNumber: "0123 4567 8901",
    ifsc: "ubin0812345",
    name: "Kamlesh Kumar",
    phone: "+91 94519 38805",
  });
  assert.ok(ok.ok, ok.ok ? "" : ok.error);
  if (!ok.ok) throw new Error("unreachable");
  assert.equal(ok.body.bank_account, "012345678901", "spaces are stripped");
  assert.equal(ok.body.ifsc, "UBIN0812345", "IFSC is upper-cased");
  assert.equal(ok.body.name, "Kamlesh Kumar");
  assert.equal(ok.body.phone, "919451938805");

  // A malformed phone is DROPPED, not fatal: the account is what is being
  // checked, and failing the whole verification over a phone number would
  // block the thing that prevents the loss.
  const shortPhone = buildBankVerifyRequest({ accountNumber: "012345", ifsc: "UBIN0812345", phone: "123" });
  assert.ok(shortPhone.ok);
  if (shortPhone.ok) assert.equal(shortPhone.body.phone, undefined);

  // Refused locally, so the school is not billed for a check that cannot work.
  for (const bad of [
    { accountNumber: "12345", ifsc: "UBIN0812345", why: "too short" },
    { accountNumber: "1".repeat(41), ifsc: "UBIN0812345", why: "too long" },
    { accountNumber: "0123-4567", ifsc: "UBIN0812345", why: "punctuation" },
    { accountNumber: "012345", ifsc: "UBIN081234", why: "IFSC too short" },
    { accountNumber: "012345", ifsc: "UBI0N812345", why: "IFSC 5th char not 0" },
    { accountNumber: "012345", ifsc: "", why: "no IFSC" },
  ]) {
    const r = buildBankVerifyRequest(bad);
    assert.equal(r.ok, false, `${bad.why} must be refused before the call`);
  }

  // Deutsche Bank and Paytm Payments Bank cannot be verified at all, so the
  // desk is told why instead of being handed an uninterpretable failure.
  for (const ifsc of ["DEUT0784BLR", "PYTM0123456"]) {
    assert.equal(bankIsUnverifiable(ifsc), true, `${ifsc} is known unverifiable`);
    const r = buildBankVerifyRequest({ accountNumber: "012345678", ifsc });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /Deutsche|Paytm/);
  }
  assert.equal(bankIsUnverifiable("UBIN0812345"), false);
  assert.equal(ifscLooksValid("UBIN0812345"), true);
}

/* ── the account number never appears in full ─────────────────────────── */
{
  assert.equal(maskAccount("012345678901"), "••••••••8901");
  assert.equal(maskAccount("1234"), "••••", "a short number is fully hidden, not revealed");
  assert.equal(maskAccount("123"), "•••");
  assert.equal(maskAccount(""), "");
  // The last four are all that is ever shown, and nothing longer leaks.
  assert.ok(!maskAccount("012345678901").includes("0123"));
}

/* ── the fingerprint is the PAIR, so a changed IFSC is a new check ─────── */
{
  const a = bankFingerprintSource("0123 4567", "ubin0812345");
  assert.equal(a, bankFingerprintSource("01234567", "UBIN0812345"), "spacing and case do not change it");
  assert.notEqual(
    a,
    bankFingerprintSource("01234567", "UBIN0812346"),
    "a different IFSC must be a different check — a cached answer for another bank is not an answer",
  );
  assert.notEqual(a, bankFingerprintSource("01234568", "UBIN0812345"));
}

/* ── an unrecognised status never reads as VALID ──────────────────────── */
{
  const valid = readBankVerifyResult({
    account_status: "VALID",
    name_at_bank: "KAMLESH KUMAR",
    name_match_score: 92,
    reference: 8812,
  });
  assert.ok(valid);
  assert.equal(valid!.status, "VALID");
  assert.equal(valid!.nameMatchScore, 92);
  assert.equal(valid!.reference, "8812", "a numeric reference is stringified");

  assert.equal(readBankVerifyResult({ account_status: "INVALID" })!.status, "INVALID");
  assert.equal(readBankVerifyResult({ account_status: "received" })!.status, "RECEIVED");
  // Anything Cashfree has not documented as conclusive becomes FAILED, never
  // VALID. A new status string must not mean "safe to pay".
  for (const odd of ["SOMETHING_NEW", "PENDING", "OK", "SUCCESS", "TRUE"]) {
    assert.equal(
      readBankVerifyResult({ account_status: odd })!.status,
      "FAILED",
      `${odd} must not be read as valid`,
    );
  }
  // Not a verification result at all → null, so an error body is never read
  // as an account that checked out.
  for (const junk of [null, undefined, "", 7, {}, [], { message: "unauthorised" }]) {
    assert.equal(readBankVerifyResult(junk), null, `${JSON.stringify(junk)} is not a result`);
  }
}

/* ── the verdict: a near-match is not a match ─────────────────────────── */
{
  const result = (over: Partial<ReturnType<typeof readBankVerifyResult> & object> = {}) => ({
    status: "VALID" as const,
    nameAtBank: "KAMLESH KUMAR",
    nameMatchScore: 95,
    reference: "1",
    message: "",
    ...over,
  });

  const ok = bankVerdict({ result: result(), expectedName: "Kamlesh Kumar" });
  assert.equal(ok.kind, "ok");
  assert.equal(safeToPay(ok), true);

  // THE CASE THIS EXISTS FOR: the account is real, and it is somebody else's.
  const mismatch = bankVerdict({
    result: result({ nameAtBank: "SUNIL VERMA", nameMatchScore: 12 }),
    expectedName: "Kamlesh Kumar",
  });
  assert.equal(mismatch.kind, "name_mismatch");
  assert.equal(safeToPay(mismatch), false, "a real account in the wrong name is NOT safe to pay");
  assert.match(verdictSentence(mismatch), /SUNIL VERMA/);
  assert.match(verdictSentence(mismatch), /Do not pay/);

  // Just under the threshold is a person's decision, not a silent yes.
  const under = bankVerdict({
    result: result({ nameMatchScore: NAME_MATCH_THRESHOLD - 1 }),
    expectedName: "Kamlesh Kumar",
  });
  assert.equal(under.kind, "name_mismatch", "below the threshold a human decides");
  assert.equal(safeToPay(under), false);
  const at = bankVerdict({
    result: result({ nameMatchScore: NAME_MATCH_THRESHOLD }),
    expectedName: "Kamlesh Kumar",
  });
  assert.equal(at.kind, "ok", "at the threshold is a match");

  // No name to check against: the account exists, and the desk is told to look
  // at the name rather than being given a clean bill of health.
  const unnamed = bankVerdict({ result: result() });
  assert.equal(unnamed.kind, "unnamed");
  assert.equal(safeToPay(unnamed), false, "nobody checked the name, so this is not 'safe to pay'");
  assert.match(verdictSentence(unnamed), /check that is who you mean to pay/);

  // No score from Cashfree: exact comparison after normalising, and anything
  // else is a mismatch for a person. A similarity guess here would be inventing
  // the very number the bank declined to give.
  const exact = bankVerdict({
    result: result({ nameMatchScore: null, nameAtBank: "kamlesh   kumar." }),
    expectedName: "Kamlesh Kumar",
  });
  assert.equal(exact.kind, "ok", "punctuation and spacing do not break an exact match");
  const near = bankVerdict({
    result: result({ nameMatchScore: null, nameAtBank: "K KUMAR" }),
    expectedName: "Kamlesh Kumar",
  });
  assert.equal(near.kind, "name_mismatch", "without a score, close is not equal");
  const blankAtBank = bankVerdict({
    result: result({ nameMatchScore: null, nameAtBank: "" }),
    expectedName: "",
  });
  assert.equal(blankAtBank.kind, "unnamed");

  // Invalid and unknown are different answers and must stay different: one
  // means the account is wrong, the other means nobody knows.
  const invalid = bankVerdict({
    result: result({ status: "INVALID", message: "account_does_not_exist" }),
    expectedName: "Kamlesh Kumar",
  });
  assert.equal(invalid.kind, "invalid");
  assert.equal(safeToPay(invalid), false);

  for (const status of ["RECEIVED", "FAILED"] as const) {
    const unknown = bankVerdict({ result: result({ status }), expectedName: "Kamlesh Kumar" });
    assert.equal(unknown.kind, "unknown", `${status} is not an answer either way`);
    assert.equal(safeToPay(unknown), false);
    assert.match(
      verdictSentence(unknown),
      /not the same as the account being wrong/,
      "the desk is told the difference, so a retry is not read as a bad account",
    );
  }
}

/* ── normaliseName is a normaliser, not a fuzzy matcher ──────────────── */
{
  assert.equal(normaliseName("  Kamlesh   Kumar.  "), "KAMLESH KUMAR");
  assert.equal(normaliseName("O'Brien-Smith"), "O BRIEN SMITH");
  assert.equal(normaliseName("Ramesh 123 Singh"), "RAMESH SINGH");
  assert.equal(normaliseName(""), "");
  // Different people must not normalise to the same string.
  assert.notEqual(normaliseName("Kamlesh Kumar"), normaliseName("K Kumar"));
}

/* ── the wiring: separate keys, and no account number anywhere ────────── */
{
  const read = (rel: string) =>
    readFileSync(
      join(process.cwd(), process.cwd().endsWith("apps/web") ? "src" : "apps/web/src", rel),
      "utf8",
    );

  const server = read("lib/secureId.server.ts");
  // Its own product, its own credentials. Reusing CASHFREE_APP_ID fails with an
  // unhelpful secret-invalid error that looks nothing like the real cause.
  assert.match(server, /CASHFREE_VERIFICATION_APP_ID/, "verification uses its own App ID");
  assert.match(server, /CASHFREE_VERIFICATION_SECRET_KEY/, "and its own secret");
  assert.match(server, /cashfree\.com\/verification/, "and its own host, not the PG base");

  // THE PRIVACY RULE. The stored row may carry the last four digits and a hash,
  // never the number. A verification table that became a second copy of every
  // staff member's bank details would be worse than the problem it solves.
  const upsert = server.slice(server.indexOf("bank_account_verifications\").upsert"));
  assert.ok(upsert.length > 0, "the upsert must exist");
  const storedBlock = upsert.slice(0, upsert.indexOf("onConflict"));
  assert.match(storedBlock, /account_last4: accountLast4/, "only the last four are stored");
  assert.doesNotMatch(
    storedBlock,
    /bank_account:|account_number:|accountNumber(?!\))/,
    "the account number must never be written to the table",
  );
  assert.match(server, /createHash\("sha256"\)/, "the key is a hash, not the number");

  // A cached FAILED/RECEIVED must not be served for ever: nobody ever found
  // out, and reusing it would make a transient failure permanent.
  assert.match(
    server,
    /cached\.status === "VALID" \|\| cached\.status === "INVALID"/,
    "only a conclusive cached answer is reused",
  );
  // Not configured and not valid are different answers on a staff record.
  assert.match(server, /configured: false/, "a missing key set is reported as unconfigured");

  const route = read("app/api/verify/bank-account/route.ts");
  // Asking for a verification spends money, so it sits behind the same
  // permission as other accounts-desk spending; reading a paid-for answer does not.
  assert.match(
    route,
    /requireStaffPermission\(req, "accounts", "edit"\)/,
    "POST is gated on accounts: edit because each call is billed",
  );
  assert.match(route, /requireStaffPermission\(req, "accounts", "view"\)/, "GET only needs view");

  const deploy = readFileSync(
    join(process.cwd(), process.cwd().endsWith("apps/web") ? "../../scripts" : "scripts", "deploy-online.sh"),
    "utf8",
  );
  assert.match(deploy, /CASHFREE_VERIFICATION_APP_ID/, "the deploy passes the verification App ID");

  const cloudbuild = readFileSync(
    join(process.cwd(), process.cwd().endsWith("apps/web") ? "../.." : ".", "cloudbuild.yaml"),
    "utf8",
  );
  assert.match(cloudbuild, /_CASHFREE_VERIFICATION_APP_ID/, "and cloudbuild declares it");
  // A secret named in --set-secrets that does not exist in Secret Manager fails
  // the WHOLE deploy. This feature is off by default, so it must not be able to
  // break a deploy for a school that never enables it.
  assert.doesNotMatch(
    cloudbuild,
    /school-erp-cashfree-verification-secret-key/,
    "the verification secret is NOT in --set-secrets: a missing secret there fails every deploy",
  );
}

console.log("  ok");
