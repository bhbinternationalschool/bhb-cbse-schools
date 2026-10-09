import assert from "node:assert/strict";
import { buildTeacherBoard, matchPortalTeacher, realNationalCode } from "./udiseTeacherFill";

console.log("udiseNationalCodePlaceholder.selftest.ts");

/**
 * 9 Oct 2026: 13 portal staff had "Will Be Generated Shortly" as their
 * National Code, and that sentence sat on NEHA PATHAK's ERP record — so all
 * 13 matched her and the review offered her against everyone.
 */

assert.equal(realNationalCode("TR30222856"), "TR30222856");
assert.equal(realNationalCode(" tp07405881 "), "TP07405881", "case and spaces do not matter");
assert.equal(realNationalCode("Will Be Generated Shortly"), "");
assert.equal(realNationalCode("WILL BE GENERATED SHORTLY"), "");
assert.equal(realNationalCode(""), "");
assert.equal(realNationalCode("NA"), "");

const staff = (id: string, fullName: string, oasisId: string, dateOfBirth: string) =>
  ({ id, fullName, oasisId, dateOfBirth, status: "active", stream: "teaching", gender: "", joiningDate: "", qualification: "" }) as never;
const neha = staff("s1", "NEHA PATHAK", "WILL BE GENERATED SHORTLY", "1992-12-07");
const rajesh = staff("s2", "Rajesh Patel", "", "1988-03-01");
const kiran = staff("s3", "Kiran Patel", "TR30222856", "1990-01-01");
const all = [neha, rajesh, kiran];

const portal = (staffName: string, nationalCode: string, dateOfBirth: string) => ({ staffName, nationalCode, dateOfBirth }) as never;

// Rajesh carries the placeholder on the portal: he must NOT become Neha.
const r = matchPortalTeacher(all, portal("RAJESH PATEL", "Will Be Generated Shortly", "01/03/1988"));
assert.equal(r.kind, "matched");
assert.equal(r.kind === "matched" && r.staff.id, "s2", "matched by name + date of birth, not by the placeholder");

// Neha herself still matches — by name and date of birth.
const n = matchPortalTeacher(all, portal("NEHA PATHAK", "Will Be Generated Shortly", "07/12/1992"));
assert.equal(n.kind === "matched" && n.staff.id, "s1");

// A real code still settles it, whatever the case.
const k = matchPortalTeacher(all, portal("KIRAN PATEL", "tr30222856", ""));
assert.equal(k.kind === "matched" && k.by, "national_code");

// The board never asks to copy the placeholder anywhere.
const board = buildTeacherBoard(all, [
  portal("NEHA PATHAK", "Will Be Generated Shortly", "07/12/1992"),
  portal("RAJESH PATEL", "Will Be Generated Shortly", "01/03/1988"),
  portal("SOMEONE NEW", "Will Be Generated Shortly", "01/01/1980"),
]);
assert.ok(board.rows.every((row) => row.nationalCode === "" && !row.codeMissingInErp), "no placeholder code shown or demanded");
assert.ok(!board.rows.some((row) => row.erpName.includes("NEHA PATHAK") && row.portalName !== "NEHA PATHAK"), "Neha is offered only for herself");

console.log("udiseNationalCodePlaceholder.selftest: all assertions passed");
