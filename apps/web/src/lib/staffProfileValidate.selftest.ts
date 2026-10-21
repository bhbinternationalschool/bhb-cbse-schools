/**
 * validateStaffProfile — a blank login username must not block Save while an
 * employee code can supply it (21 Oct 2026, hotfix/staff-editor-save).
 *
 * Production: 29 of 35 staff have "Portal / app login enabled" (the default)
 * and no username. The staff editor (StaffProfileForm) refused Save for every
 * one of them — "Username required when login is enabled" — although Save
 * itself fills the username from the employee code and the field says
 * "Defaults to emp code". The edit never left the page.
 * Run: npx tsx src/lib/staffProfileValidate.selftest.ts
 */
import { defaultStaffLoginUsername, validateStaffProfile } from "./staffResolve";
import { normalizeStaffRecord } from "./foundationMasters";

let failed = 0;
function expect(label: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    failed += 1;
    console.error(`FAIL ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

const rec = (p: Record<string, unknown>) =>
  normalizeStaffRecord({ id: "stf_x", empCode: "BHB-017", fullName: "Staff X", mobile: "9876543210", ...p });

// The production shape: login on by default, username never typed.
const prodShape = rec({});
expect("login is on by default", prodShape.loginEnabled, true);
expect("username blank", prodShape.loginUsername, "");
expect("blank username + emp code: no error", validateStaffProfile(prodShape), {});
expect("default username from the code", defaultStaffLoginUsername(" BHB/017 "), "bhb017");

// Still refused when nothing can supply a username.
expect(
  "blank username, no usable code: refused",
  Object.keys(validateStaffProfile(rec({ empCode: "///" }))),
  ["loginUsername"],
);
expect(
  "blank username, blank code: code required, username refused",
  Object.keys(validateStaffProfile(rec({ empCode: "" }))).sort(),
  ["empCode", "loginUsername"],
);
// Login off, or a typed username: fine as before.
expect("login off", validateStaffProfile(rec({ loginEnabled: false })), {});
expect("typed username", validateStaffProfile(rec({ loginUsername: "sx" })), {});
// The other checks are unchanged.
expect("bad mobile still refused", Object.keys(validateStaffProfile(rec({ mobile: "123" }))), ["mobile"]);

if (failed) {
  console.error(`staffProfileValidate: ${failed} failed`);
  process.exit(1);
}
console.log("staffProfileValidate: ok");
