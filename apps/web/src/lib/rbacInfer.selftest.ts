/**
 * inferRoleCodes must not escalate to "owner" from routine designation
 * text.
 *
 * Before this fix, any staff designation containing "trustee" or
 * "director" — e.g. "Director of Admissions", "Sports Director" — silently
 * resolved to full owner access for any staff member without an explicit
 * RBAC assignment. Designations are ordinary HR data entered by office
 * staff, not a security decision, so that regex was a privilege-escalation
 * bug waiting for a routine title. This guards it can't come back.
 *
 * Run: npx tsx src/lib/rbacInfer.selftest.ts
 */
import assert from "node:assert/strict";

import { emptyMastersShell } from "./masters";
import { inferRoleCodes, type SessionLike } from "./rbac";

console.log("rbacInfer.selftest.ts");

function mastersWithDesignation(designationName: string) {
  const masters = emptyMastersShell();
  masters.designations = [
    {
      id: "des_test",
      code: "TEST",
      name: designationName,
      departmentId: null,
      isActive: true,
    } as (typeof masters.designations)[number],
  ];
  masters.staff = [
    {
      id: "stf_test",
      empCode: "T900",
      fullName: "Test Staff",
      stream: "non_teaching",
      category: "permanent",
      departmentId: null,
      designationId: "des_test",
      campusId: null,
      mobile: "9000000002",
      email: "notowner@example.com",
    } as (typeof masters.staff)[number],
  ];
  return masters;
}

const session: SessionLike = {
  roleCode: "staff",
  staffId: "stf_test",
  fullName: "Test Staff",
  email: "notowner@example.com",
  persona: "staff",
};

// --- THE REGRESSION: "director"/"trustee" in a designation must not grant owner
for (const title of [
  "Director of Admissions",
  "Sports Director",
  "Assistant Director — Transport",
  "Trustee Liaison Officer",
]) {
  const codes = inferRoleCodes(session, mastersWithDesignation(title));
  assert.ok(
    !codes.includes("owner"),
    `designation "${title}" must not infer owner — got [${codes.join(", ")}]`,
  );
}

// --- session.roleCode containing "director"/"trustee" must not grant owner either
{
  const codes = inferRoleCodes(
    { ...session, roleCode: "Assistant Director" },
    emptyMastersShell(),
  );
  assert.ok(
    !codes.includes("owner"),
    `roleCode "Assistant Director" must not infer owner — got [${codes.join(", ")}]`,
  );
}

// --- isProtectedSuperAdminEmail is still the (only) inferred path to owner
{
  const codes = inferRoleCodes(
    { ...session, email: "director@bhbinternational.school" },
    emptyMastersShell(),
  );
  assert.deepEqual(
    codes,
    ["owner"],
    "a protected super-admin email must still infer owner",
  );
}

// --- unrelated patterns are unaffected (principal still infers from designation)
{
  const codes = inferRoleCodes(session, mastersWithDesignation("Principal"));
  assert.ok(
    codes.includes("principal"),
    "principal designation must still infer principal (regression check)",
  );
}

console.log("OK — rbacInfer.selftest.ts");
