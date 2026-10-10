/**
 * Per-person permission grants.
 *
 * The mobile feature map deliberately cannot widen RBAC — a feature stays
 * dark unless the role's matrix already carries the module and action. That
 * left one real request with no answer: give ONE teacher the fee counter
 * without putting fee collection on every teacher in the school. Personal
 * grants are that answer, so they need guarding: they must grant, they must
 * expire, they must not leak to the person sitting next to them, and a deny
 * that lives in the role must not be silently re-opened for everybody.
 *
 * Run: npx tsx src/lib/rbacUserGrants.selftest.ts
 */
import assert from "node:assert/strict";

import { defaultMobileAccess } from "./mobileFeatures";
import { emptyMastersShell } from "./masters";
import {
  hasPermission,
  hasScopedPermission,
  removeUserGrant,
  setUserGrant,
  userGrantsFor,
  type RbacRole,
  type RbacState,
  type SessionLike,
} from "./rbac";

console.log("rbacUserGrants.selftest.ts");

const masters = emptyMastersShell();
masters.staff = [
  {
    id: "stf_meera",
    empCode: "T001",
    fullName: "Meera Rao",
    stream: "teaching",
    category: "permanent",
    departmentId: null,
    designationId: null,
    campusId: null,
    mobile: "9000000001",
    email: "meera@example.com",
  } as (typeof masters.staff)[number],
  {
    id: "stf_anil",
    empCode: "T002",
    fullName: "Anil Kumar",
    stream: "teaching",
    category: "permanent",
    departmentId: null,
    designationId: null,
    campusId: null,
    mobile: "9000000002",
    email: "anil@example.com",
  } as (typeof masters.staff)[number],
];

const teacherRole: RbacRole = {
  id: "role_teacher",
  code: "teacher",
  name: "Teacher",
  isBuiltIn: true,
  isActive: true,
  makerChecker: false,
  permissions: [{ module: "students", actions: ["view"] }],
  note: "",
};

function sessionFor(staffId: string, fullName: string): SessionLike {
  return { roleCode: "teacher", staffId, fullName, persona: "staff" };
}

const meera = sessionFor("stf_meera", "Meera Rao");
const anil = sessionFor("stf_anil", "Anil Kumar");

const base: RbacState = {
  version: 1,
  roles: [teacherRole],
  assignments: [
    {
      id: "asn_1",
      staffId: "stf_meera",
      roleId: "role_teacher",
      isPrimary: true,
      scope: { campusIds: [], classIds: [], departmentIds: [] },
      expiresOn: "",
      note: "",
    },
    {
      id: "asn_2",
      staffId: "stf_anil",
      roleId: "role_teacher",
      isPrimary: true,
      scope: { campusIds: [], classIds: [], departmentIds: [] },
      expiresOn: "",
      note: "",
    },
  ],
  audit: [],
  userGrants: [],
  mobile: defaultMobileAccess(),
};

// 1. The role alone does not collect fees. That is the premise.
assert.equal(
  hasPermission(meera, masters, "fees", "create", base),
  false,
  "teacher role should not carry fees:create out of the box",
);

// 2. One teacher, granted by name, can.
const granted = setUserGrant(base, {
  staffId: "stf_meera",
  module: "fees",
  actions: ["view", "create"],
  note: "Runs the counter on Saturdays",
  grantedBy: "Principal",
});
assert.equal(
  hasPermission(meera, masters, "fees", "create", granted),
  true,
  "personal grant should carry fees:create",
);
assert.equal(
  hasPermission(meera, masters, "fees", "view", granted),
  true,
  "personal grant should carry every action it lists",
);

// 3. …and only her. The teacher sitting next to her is untouched.
assert.equal(
  hasPermission(anil, masters, "fees", "create", granted),
  false,
  "a personal grant must not leak to another holder of the same role",
);

// 4. It does not become a skeleton key for the rest of the module list.
assert.equal(
  hasPermission(meera, masters, "fees", "void", granted),
  false,
  "an action the grant does not list stays refused",
);
assert.equal(
  hasPermission(meera, masters, "payroll", "view", granted),
  false,
  "a grant on one module must not open another",
);

// 5. Scoped checks honour it too — a personal grant carries no scope, so it
//    is unrestricted; the alternative is a permission that reads as given but
//    refuses every actual row.
assert.equal(
  hasScopedPermission(meera, masters, "fees", "create", granted, {
    classId: "cls_any",
  }),
  true,
  "personal grant should satisfy a scoped check",
);

// 6. Expiry is real, both ways.
const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const expired = setUserGrant(base, {
  staffId: "stf_meera",
  module: "fees",
  actions: ["create"],
  expiresOn: yesterday,
});
assert.equal(
  hasPermission(meera, masters, "fees", "create", expired),
  false,
  "a grant past its expiry must stop granting",
);
const future = setUserGrant(base, {
  staffId: "stf_meera",
  module: "fees",
  actions: ["create"],
  expiresOn: tomorrow,
});
assert.equal(
  hasPermission(meera, masters, "fees", "create", future),
  true,
  "a grant still inside its window should grant",
);
assert.equal(
  userGrantsFor(expired, meera, masters).length,
  0,
  "userGrantsFor should hide expired grants",
);
assert.equal(userGrantsFor(future, meera, masters).length, 1);

// 7. Re-granting the same module replaces rather than piles up.
const regranted = setUserGrant(granted, {
  staffId: "stf_meera",
  module: "fees",
  actions: ["view"],
});
assert.equal(
  regranted.userGrants.filter(
    (g) => g.staffId === "stf_meera" && g.module === "fees",
  ).length,
  1,
  "one row per person per module",
);
assert.equal(
  hasPermission(meera, masters, "fees", "create", regranted),
  false,
  "narrowing a grant should actually narrow it",
);

// 8. Empty actions is how the office takes it back.
const cleared = setUserGrant(granted, {
  staffId: "stf_meera",
  module: "fees",
  actions: [],
});
assert.equal(cleared.userGrants.length, 0);
assert.equal(hasPermission(meera, masters, "fees", "create", cleared), false);

// 9. Remove by id.
const removed = removeUserGrant(granted, granted.userGrants[0].id);
assert.equal(removed.userGrants.length, 0);
assert.equal(hasPermission(meera, masters, "fees", "create", removed), false);

// 10. A grant with no staffId is not a grant for everybody.
const nobody = setUserGrant(base, {
  staffId: "   ",
  module: "fees",
  actions: ["create"],
});
assert.equal(nobody.userGrants.length, 0, "a blank staffId must be refused");
assert.equal(hasPermission(anil, masters, "fees", "create", nobody), false);

console.log("OK");
