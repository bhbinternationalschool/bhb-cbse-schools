/**
 * Self-test: a member of staff's own profile from the app (13 Oct 2026).
 * Run: npx tsx src/lib/staffSelfProfile.selftest.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  addProfileRequest,
  maskTail,
  normalizeProfileRequests,
  ownProfileView,
  requestForStaff,
  splitProfileChanges,
  STAFF_PROFILE_FIELDS,
} from "./staffSelfProfile";

console.log("staffSelfProfile.selftest.ts");

const current = { fullName: "Ravindra Yadav", mobile: "9598028391", email: "", altMobile: "", aadhaarNo: "234567890123", bankAccountNo: "1234567890", city: "Varanasi" };

/* ── contact saves at once; identity / bank go to the office ─────────── */
{
  const r = splitProfileChanges(current, { altMobile: "+91 98765 43210", email: "Ravi@Example.com", city: "Varanasi", bankAccountNo: "99887766554", fullName: "Ravindra Kumar Yadav" });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.direct, { altMobile: "9876543210", email: "ravi@example.com" }, "contact fields, cleaned; unchanged city dropped");
  assert.deepEqual(Object.keys(r.approval).sort(), ["bankAccountNo", "fullName"]);
  assert.equal(r.approval.bankAccountNo!.from, "1234567890");
}
/* ── bad values and unknown fields are refused ───────────────────────── */
{
  const r = splitProfileChanges(current, { aadhaarNo: "1234", panNo: "abc", basicPay: "99999", mobile: "" });
  assert.ok(r.errors.some((e) => /Aadhaar is 12 digits/.test(e)));
  assert.ok(r.errors.some((e) => /PAN looks like/.test(e)));
  assert.ok(r.errors.some((e) => /basicPay cannot be changed/.test(e)), "pay is never self-service");
  assert.ok(r.errors.some((e) => /Registered mobile.*cannot be empty/.test(e)));
}
/* ── what the staff member sees: masked ───────────────────────────────── */
{
  const v = ownProfileView(current as never);
  assert.equal(v.aadhaarNo, "••••••••0123");
  assert.equal(v.bankAccountNo, "••••••7890");
  assert.equal(maskTail(""), "");
  assert.ok(!STAFF_PROFILE_FIELDS.some((f) => ["basicPay", "loginPassword", "salary"].includes(f.key)));
}
/* ── one open request per person; later changes fold in ──────────────── */
{
  let s = normalizeProfileRequests(null);
  s = addProfileRequest(s, { staffId: "a", staffName: "A", fields: { panNo: { from: "", to: "ABCDE1234F" } }, now: "1", id: "r1" });
  s = addProfileRequest(s, { staffId: "a", staffName: "A", fields: { panNo: { from: "", to: "ABCDE9999F" }, bankIfsc: { from: "", to: "SBIN0001234" } }, now: "2", id: "r2" });
  assert.equal(s.requests.length, 1, "folded into the open request");
  assert.equal(s.requests[0]!.fields.panNo!.to, "ABCDE9999F");
  const masked = requestForStaff({ ...s.requests[0]!, fields: { aadhaarNo: { from: "234567890123", to: "345678901234" } } });
  assert.equal(masked.fields.aadhaarNo!.to, "••••••••1234", "the app never shows a full Aadhaar back");
}
/* ── wiring ──────────────────────────────────────────────────────────── */
{
  const api = join(__dirname, "../app/api/v1/staff");
  const me = readFileSync(join(api, "me/profile/route.ts"), "utf8");
  assert.ok(/ctx\.session\.staffId/.test(me) && !/body\.staffId|searchParams/.test(me), "only ever the caller's own row");
  const office = readFileSync(join(api, "profile-requests/route.ts"), "utf8");
  assert.ok(/requireStaffPermission\(req, "staff", "edit"\)/.test(office), "the office queue needs Staff · edit");
  assert.ok(/already the registered mobile of/.test(office), "a login mobile stays one person's");
  const photo = readFileSync(join(api, "me/photo/route.ts"), "utf8");
  assert.ok(/status: "pending"/.test(photo) && /school-files/.test(photo) && !/data:/.test(photo), "photo: private bucket, pending check, no base64");
}

console.log("  ok");
