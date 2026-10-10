import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SisStudent } from "./sis";

console.log("parentFamilyInactive.selftest.ts");

/**
 * A family the school has made inactive (every child) cannot use the parent
 * app: no login code, an open session refused, and the app shows the
 * school's message. One child still on roll keeps the family in.
 */

process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://localhost";

const row = (id: string, adm: string, ay: string, status: "active" | "inactive") =>
  ({ id, admissionNo: adm, academicYearCode: ay, status, householdId: "hh" }) as unknown as SisStudent;

void (async () => {
  const { familyRollStatus, FAMILY_INACTIVE_MESSAGE } = await import("./parentFamilyStatus.server");

  // Left this year: 2026-27 inactive, older rows still "active" — inactive.
  assert.equal(familyRollStatus([row("a", "1", "2025-26", "active"), row("b", "1", "2026-27", "inactive")], "2026-27"), "inactive");
  // One sibling still on roll keeps the family in.
  assert.equal(
    familyRollStatus([row("b", "1", "2026-27", "inactive"), row("c", "2", "2026-27", "active")], "2026-27"),
    "on_roll",
  );
  // No rows is a lookup question, never a block.
  assert.equal(familyRollStatus([], "2026-27"), "unknown");
  assert.ok(FAMILY_INACTIVE_MESSAGE.includes("contact the school office") && FAMILY_INACTIVE_MESSAGE.includes("स्कूल कार्यालय"), "says what to do, in both languages");
  assert.equal(FAMILY_INACTIVE_MESSAGE.split(" / ").length, 2, "the app shows one half by language");

  // ── Wiring ─────────────────────────────────────────────────────────────
  const read = (f: string) => readFileSync(join(__dirname, f), "utf8");
  assert.ok(/=== "inactive"\) \{\s*throw new ApiError\("family_inactive", FAMILY_INACTIVE_MESSAGE, 403\)/.test(read("api/v1/auth.ts")), "every app request");
  assert.ok(/familyRollStatus\(found\.students, ""\) === "inactive"/.test(read("../app/api/auth/otp/request/route.ts")), "no code is sent");
  assert.ok(/readFamilyRollStatus\(hh\.id, resolvedAy\)\) === "inactive"/.test(read("parentSession.server.ts")), "no session is signed");
  assert.ok(/checkInactive: !isReviewLogin/.test(read("../app/api/auth/otp/verify/route.ts")), "OTP login signs in through it");
  const status = read("parentFamilyStatus.server.ts");
  assert.ok(/if \(error\) return "unknown";/.test(status) && /if \(!ctx\) return "unknown";/.test(status), "a failed read never blocks");
  const app = readFileSync(join(__dirname, "../../../../cbse_school_mobile/lib/core/api/api_client.dart"), "utf8");
  assert.ok(/if \(code == "family_inactive"\) AppBuild\.familyInactive\.value = message;/.test(app), "the app closes with the message");
  assert.ok(/_FamilyInactiveScreen\(/.test(readFileSync(join(__dirname, "../../../../cbse_school_mobile/lib/core/update/app_update_gate.dart"), "utf8")));

  console.log("parentFamilyInactive.selftest: all assertions passed");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
