/**
 * An enrolled parent is a parent: no role-pick menu, no "General" tag.
 * Run: npx tsx src/lib/waKnownParentRole.selftest.ts
 */
import assert from "node:assert/strict";
import type { WaResolvedIdentity, WaResolvedRole } from "./waRoleResolver";
import { categoryForKnownIdentity, collapseRolesForEnrolledParent } from "./waUnifiedBotEngine";

console.log("waKnownParentRole.selftest.ts");

const parent: WaResolvedRole = { kind: "parent", label: "Enrolled parent (SIS)", pickKeyword: "PARENT", householdId: "hh_1" };
const lead: WaResolvedRole = { kind: "admission_lead", label: "Admission enquiry", pickKeyword: "ADMISSION", leadId: "ld_1" };
const vendor: WaResolvedRole = { kind: "vendor", label: "Vendor", pickKeyword: "VENDOR" };
const teacher: WaResolvedRole = { kind: "teacher", label: "Teacher", pickKeyword: "TEACHER" };

/* The four families of 11 Sep 2026: parent + the enquiry that enrolled them. */
assert.deepEqual(collapseRolesForEnrolledParent([parent, lead]), [parent], "the old enquiry is dropped");
assert.deepEqual(collapseRolesForEnrolledParent([lead, parent]).map((r) => r.kind), ["parent"]);
/* A parent who is also a vendor or a teacher still gets to choose. */
assert.deepEqual(collapseRolesForEnrolledParent([parent, vendor]).map((r) => r.kind), ["parent", "vendor"]);
assert.deepEqual(collapseRolesForEnrolledParent([parent, teacher, lead]).map((r) => r.kind), ["parent", "teacher"]);
/* No parent → nothing changes; a pure enquiry stays an enquiry. */
assert.deepEqual(collapseRolesForEnrolledParent([lead]), [lead]);
assert.deepEqual(collapseRolesForEnrolledParent([]), []);

const id = (roles: WaResolvedRole[]): WaResolvedIdentity => ({ mobile10: "9999999999", displayName: "X", isKnown: roles.length > 0, roles });
assert.equal(categoryForKnownIdentity(id([parent])), "parent");
assert.equal(categoryForKnownIdentity(id([parent, vendor])), "parent", "a parent choosing a role is still filed under parents");
assert.equal(categoryForKnownIdentity(id([teacher])), "staff");
assert.equal(categoryForKnownIdentity(id([lead])), "admission_enquiry");
assert.equal(categoryForKnownIdentity(id([vendor])), "vendor_enquiry");
assert.equal(categoryForKnownIdentity(id([])), "general", "only a stranger is General");

console.log("ok");
