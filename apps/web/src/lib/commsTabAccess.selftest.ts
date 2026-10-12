import assert from "node:assert/strict";
import { commsTabIsOfficeOnly, commsTabOfHref, commsTabOpenedByFunction } from "./commsTabAccess";
import { defaultMobileAccess } from "./mobileFeatures";
import type { RbacRole, RbacState, SessionLike } from "./rbac";

console.log("commsTabAccess.selftest.ts");
// A teacher's view grant reads these…
for (const t of ["notices", "news", "gallery", "inbox"]) assert.equal(commsTabIsOfficeOnly(t), false, t);
// …and never these: family chats, phone numbers, app pop-ups.
for (const t of ["whatsapp", "onapp", "popups", "email", "social", "answers", "reports", "dashboard"]) assert.equal(commsTabIsOfficeOnly(t), true, t);
assert.equal(commsTabOfHref("/comms?tab=whatsapp&wa=classes"), "whatsapp");
assert.equal(commsTabOfHref("/comms"), "notices");
assert.equal(commsTabOfHref("/attendance"), null);
assert.equal(commsTabIsOfficeOnly(commsTabOfHref("/attendance")), false);

// An office tab opens for a FUNCTION naming it — never for the module grant.
{
  const role = (code: string, over: Partial<RbacRole>): RbacRole => ({
    id: `role_${code}`, code, name: code, isBuiltIn: true, isActive: true,
    makerChecker: false, permissions: [], featureGrants: [], note: "", ...over,
  });
  const st: RbacState = {
    version: 1,
    roles: [
      role("teacher", { permissions: [{ module: "notices", actions: ["view"] }, { module: "notifications", actions: ["view"] }, { module: "wa_chatbot", actions: ["view", "edit"] }] }),
      role("driver", { featureGrants: [{ feature: "notices.app_popups", actions: ["view"] }, { feature: "notices.wa_chats", actions: ["view"] }] }),
    ],
    assignments: [], audit: [], userGrants: [], mobile: defaultMobileAccess(),
  };
  const as = (roleCode: string): SessionLike => ({ roleCode, fullName: "X", persona: "staff" });
  for (const t of ["popups", "whatsapp", "chats", "answers", "email", "reports", "dashboard", "onapp"]) {
    assert.equal(commsTabOpenedByFunction(as("teacher"), null, t, st), false, `teacher ${t}`);
  }
  assert.equal(commsTabOpenedByFunction(as("driver"), null, "popups", st), true);
  assert.equal(commsTabOpenedByFunction(as("driver"), null, "whatsapp", st), true);
  assert.equal(commsTabOpenedByFunction(as("driver"), null, "chats", st), true);
  assert.equal(commsTabOpenedByFunction(as("driver"), null, "classes", st), false);
  assert.equal(commsTabOpenedByFunction(as("driver"), null, "reports", st), false);
}
console.log("commsTabAccess.selftest: all assertions passed");
