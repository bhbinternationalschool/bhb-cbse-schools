/**
 * RoleScope enforcement regression test.
 *
 * RoleScope (campusIds/classIds/departmentIds) has always been stored and
 * editable in the Roles & Permissions UI, but nothing ever read it back —
 * a teacher assigned "teacher" scoped to one class could view/edit every
 * class, because hasPermission only checked module+action. This guards
 * hasScopedPermission/scopedClassIds so that regression can't come back
 * silently.
 *
 * Run: npx tsx src/lib/rbacScope.selftest.ts
 */
import assert from "node:assert/strict";

import { emptyMastersShell } from "./masters";
import {
  hasPermission,
  hasScopedPermission,
  scopedClassIds,
  type RbacRole,
  type RbacState,
  type SessionLike,
  type UserRoleAssignment,
} from "./rbac";

console.log("rbacScope.selftest.ts");

const masters = emptyMastersShell();
masters.staff = [
  {
    id: "stf_teacher",
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
];

const session: SessionLike = {
  roleCode: "teacher",
  staffId: "stf_teacher",
  fullName: "Meera Rao",
  persona: "staff",
};

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

function stateWithAssignment(scope: UserRoleAssignment["scope"]): RbacState {
  return {
    version: 1,
    roles: [teacherRole],
    assignments: [
      {
        id: "asn_1",
        staffId: "stf_teacher",
        roleId: "role_teacher",
        isPrimary: true,
        scope,
        expiresOn: "",
        note: "",
      },
    ],
    audit: [],
  };
}

// --- Scoped assignment: only the assigned class is allowed -------------
{
  const rbac = stateWithAssignment({
    campusIds: [],
    classIds: ["cls_vi"],
    departmentIds: [],
  });

  assert.equal(
    hasScopedPermission(session, masters, "students", "view", rbac, {
      classId: "cls_vi",
    }),
    true,
    "in-scope class must be allowed",
  );
  assert.equal(
    hasScopedPermission(session, masters, "students", "view", rbac, {
      classId: "cls_ix",
    }),
    false,
    "THE REGRESSION THIS GUARDS: out-of-scope class must be denied",
  );
  assert.equal(
    hasScopedPermission(session, masters, "students", "view", rbac),
    true,
    "omitting entity must not restrict — caller isn't asking about a record",
  );
  assert.equal(
    hasPermission(session, masters, "students", "view", rbac),
    true,
    "hasPermission must stay unaffected by scope (backward compatible for its 23 call sites)",
  );
}

// --- Unscoped assignment: empty classIds means unrestricted ------------
{
  const rbac = stateWithAssignment({
    campusIds: [],
    classIds: [],
    departmentIds: [],
  });
  assert.equal(
    hasScopedPermission(session, masters, "students", "view", rbac, {
      classId: "cls_anything",
    }),
    true,
    "empty scope array must mean unrestricted, not deny-all",
  );
  assert.equal(
    scopedClassIds(session, masters, "students", "view", rbac),
    null,
    "scopedClassIds must be null (unrestricted) for an empty-scope assignment",
  );
}

// --- Module/action the role doesn't grant at all ------------------------
{
  const rbac = stateWithAssignment({
    campusIds: [],
    classIds: ["cls_vi"],
    departmentIds: [],
  });
  assert.equal(
    hasScopedPermission(session, masters, "payroll", "view", rbac, {
      classId: "cls_vi",
    }),
    false,
    "a module the role never granted must be denied regardless of scope",
  );
}

// --- scopedClassIds reflects the restriction for read-side filtering ---
{
  const rbac = stateWithAssignment({
    campusIds: [],
    classIds: ["cls_vi", "cls_vii"],
    departmentIds: [],
  });
  assert.deepEqual(
    scopedClassIds(session, masters, "students", "view", rbac)?.sort(),
    ["cls_vi", "cls_vii"],
    "scopedClassIds must return exactly the assigned classes",
  );
}

// --- No assignment record at all: inferred-role fallback is unrestricted
{
  const rbac: RbacState = {
    version: 1,
    roles: [teacherRole],
    assignments: [],
    audit: [],
  };
  assert.equal(
    hasScopedPermission(session, masters, "students", "view", rbac, {
      classId: "cls_anything",
    }),
    true,
    "no assignment record (inferred fallback) must stay unrestricted — unchanged historical behavior",
  );
}

console.log("OK — rbacScope.selftest.ts");
