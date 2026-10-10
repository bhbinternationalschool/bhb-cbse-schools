/**
 * mobileFeatures — the two gates (RBAC and the mobile map) must both hold,
 * and a personal denial must beat any role.
 * Run: npx tsx src/lib/mobileFeatures.selftest.ts
 */
import {
  MOBILE_FEATURES,
  MOBILE_FEATURE_IDS,
  defaultMobileAccess,
  normalizeMobileAccess,
  resolveMobileFeatures,
  setRoleMobileFeatures,
  setStaffMobileRule,
  type MobileAccessState,
} from "./mobileFeatures";

let failed = 0;
function expect(label: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) {
    failed += 1;
    console.error(`FAIL ${label}: got ${g}, want ${w}`);
  }
}
const yes = () => true;
const no = () => false;

// ---- catalogue ----------------------------------------------------------
expect("ids unique", new Set(MOBILE_FEATURE_IDS).size, MOBILE_FEATURE_IDS.length);
expect(
  "every feature has a note",
  MOBILE_FEATURES.filter((f) => f.note.trim().length < 10).length,
  0,
);

// ---- both gates ---------------------------------------------------------
const access = defaultMobileAccess();
const teacher = resolveMobileFeatures({
  roleCodes: ["teacher"],
  access,
  can: yes,
});
expect("teacher gets attendance", teacher.features.includes("attendance_mark"), true);
expect("teacher has no fee counter", teacher.features.includes("fee_take"), false);
expect("teacher has no lead list", teacher.features.includes("admission_leads"), false);
expect("teacher has no staff-leave approval", teacher.features.includes("staff_leave_approve"), false);

const accounts = resolveMobileFeatures({ roleCodes: ["accounts"], access, can: yes });
expect("accounts gets fee take", accounts.features.includes("fee_take"), true);
expect("accounts does not mark attendance", accounts.features.includes("attendance_mark"), false);

const principal = resolveMobileFeatures({ roleCodes: ["principal"], access, can: yes });
expect("principal gets everything", principal.features.length, MOBILE_FEATURE_IDS.length);

// RBAC refusal wins even when the mobile map says yes.
const noRbac = resolveMobileFeatures({ roleCodes: ["principal"], access, can: no });
expect("rbac refusal empties the list", noRbac.features.length, 0);
expect("…and reports why", noRbac.blockedByRbac.length, MOBILE_FEATURE_IDS.length);

// Only the fees module denied.
const feesDenied = resolveMobileFeatures({
  roleCodes: ["accounts"],
  access,
  can: (m) => m !== "fees",
});
expect("fee features drop out", feesDenied.features.includes("fee_take"), false);
expect("fee features are listed as blocked", feesDenied.blockedByRbac.includes("fee_take"), true);
expect("non-fee features survive", feesDenied.features.includes("gps_punch"), true);

// ---- per-person grant and denial ---------------------------------------
let s: MobileAccessState = access;
s = setStaffMobileRule(s, {
  staffId: "stf_a",
  allow: ["fee_take"],
  deny: [],
  note: "collects at the gate",
});
const grantedTeacher = resolveMobileFeatures({
  roleCodes: ["teacher"],
  staffId: "stf_a",
  access: s,
  can: yes,
});
expect("personal grant adds it", grantedTeacher.features.includes("fee_take"), true);
expect(
  "grant does not leak to others",
  resolveMobileFeatures({ roleCodes: ["teacher"], staffId: "stf_b", access: s, can: yes })
    .features.includes("fee_take"),
  false,
);

s = setStaffMobileRule(s, {
  staffId: "stf_c",
  allow: ["fee_take"],
  deny: ["fee_take", "attendance_mark"],
  note: "on leave",
});
const denied = resolveMobileFeatures({
  roleCodes: ["principal"],
  staffId: "stf_c",
  access: s,
  can: yes,
});
expect("denial beats a personal grant", denied.features.includes("fee_take"), false);
expect("denial beats the role", denied.features.includes("attendance_mark"), false);
expect("other features remain", denied.features.includes("school_snapshot"), true);

// An empty rule is dropped rather than stored.
const cleared = setStaffMobileRule(s, { staffId: "stf_c", allow: [], deny: [], note: "" });
expect("empty rule removed", cleared.staffRules.some((r) => r.staffId === "stf_c"), false);

// ---- role edits ---------------------------------------------------------
const edited = setRoleMobileFeatures(access, "teacher", ["fee_take", "notices"]);
expect(
  "role edit replaces the list",
  resolveMobileFeatures({ roleCodes: ["teacher"], access: edited, can: yes }).features,
  ["fee_take", "notices"],
);
expect(
  "role code is matched case-insensitively",
  resolveMobileFeatures({ roleCodes: ["TEACHER"], access: edited, can: yes }).features.length,
  2,
);

// ---- normalize ----------------------------------------------------------
expect("garbage normalizes to defaults", normalizeMobileAccess(null).roleFeatures.teacher.length, access.roleFeatures.teacher.length);
const partial = normalizeMobileAccess({
  version: 1,
  roleFeatures: { teacher: ["fee_take", "not_a_feature"] },
  staffRules: [{ staffId: "stf_x", allow: ["notices", "nope"], deny: [], note: "" }],
});
expect("unknown feature ids dropped", partial.roleFeatures.teacher, ["fee_take"]);
expect("unconfigured roles keep defaults", partial.roleFeatures.accounts.includes("fee_take"), true);
expect("staff rule cleaned", partial.staffRules[0].allow, ["notices"]);
expect(
  "rule without a staffId dropped",
  normalizeMobileAccess({ version: 1, roleFeatures: {}, staffRules: [{ staffId: "", allow: [], deny: [], note: "" }] })
    .staffRules.length,
  0,
);

// Multiple roles union.
const both = resolveMobileFeatures({ roleCodes: ["teacher", "accounts"], access, can: yes });
expect("roles union", both.features.includes("fee_take") && both.features.includes("attendance_mark"), true);

if (failed) {
  console.error(`mobileFeatures selftest: ${failed} failure(s)`);
  process.exit(1);
}
console.log("mobileFeatures selftest: ok");
