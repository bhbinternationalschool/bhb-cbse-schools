/**
 * Audit trail must not become a second copy of the secrets.
 *
 * Student records carry full Aadhaar numbers, PAN and portal passwords.
 * The audit trail needs to record THAT those fields changed, never their
 * values — otherwise enabling auditing quietly doubles the blast radius
 * of any future leak, in a table nobody thinks of as sensitive.
 *
 * Run: npx tsx src/lib/auditRedaction.selftest.ts
 */
import assert from "node:assert/strict";
import { diffForAudit } from "./auditClient";

console.log("auditRedaction.selftest.ts");

// --- Sensitive values never appear in the diff ------------------------
{
  const before = {
    fullName: "Aadvik Singh",
    aadhaarNumber: "111122223333",
    fatherAadhaarNumber: "444455556666",
    motherAadhaarNumber: "777788889999",
    loginPassword: "hunter2",
    bankAccountNo: "50100123456789",
    classId: "IX",
  };
  const after = {
    ...before,
    aadhaarNumber: "999988887777",
    fatherAadhaarNumber: "000011112222",
    motherAadhaarNumber: "333344445555",
    loginPassword: "newpassword",
    bankAccountNo: "50100999999999",
    classId: "X",
  };

  const { changedFields, before: b, after: a } = diffForAudit(before, after);
  const serialised = JSON.stringify({ b, a });

  for (const secret of [
    "111122223333", "999988887777",
    "444455556666", "000011112222",
    "777788889999", "333344445555",
    "hunter2", "newpassword",
    "50100123456789", "50100999999999",
  ]) {
    assert.ok(
      !serialised.includes(secret),
      `secret ${secret} leaked into the audit diff`,
    );
  }

  // …but the fact they changed is still recorded.
  for (const f of [
    "aadhaarNumber", "fatherAadhaarNumber", "motherAadhaarNumber",
    "loginPassword", "bankAccountNo", "classId",
  ]) {
    assert.ok(changedFields.includes(f), `${f} should be listed as changed`);
  }
  assert.equal(b.aadhaarNumber, "[redacted]");
  assert.equal(a.aadhaarNumber, "[redacted]");
  console.log("  ok  identity numbers and passwords redacted, change still logged");
}

// --- Non-sensitive values are kept, so the trail is useful ------------
{
  const { before: b, after: a, changedFields } = diffForAudit(
    { fullName: "Aadvik Singh", classId: "IX", rollNo: "12" },
    { fullName: "Aadvik Singh", classId: "X",  rollNo: "07" },
  );
  assert.deepEqual(changedFields.sort(), ["classId", "rollNo"]);
  assert.equal(b.classId, "IX");
  assert.equal(a.classId, "X");
  assert.ok(!("fullName" in b), "unchanged fields must not be recorded");
  console.log("  ok  changed non-sensitive values kept, unchanged fields omitted");
}

// --- Empty secrets are not labelled as redacted -----------------------
{
  const { before: b, after: a } = diffForAudit(
    { aadhaarNumber: "" },
    { aadhaarNumber: "111122223333" },
  );
  assert.equal(b.aadhaarNumber, "", "an absent value should read as empty, not redacted");
  assert.equal(a.aadhaarNumber, "[redacted]");
  console.log("  ok  empty-to-set transition distinguishes absent from hidden");
}

// --- No previous record (create) produces no diff ---------------------
{
  const { changedFields } = diffForAudit(null, { fullName: "New Student" });
  assert.deepEqual(changedFields, [], "a create has no before-state to diff");
  console.log("  ok  create path produces no spurious diff");
}

console.log("\nAll audit redaction checks passed.");
