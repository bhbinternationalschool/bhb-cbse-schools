/**
 * Function grants: the function-only "send" action, the built-in grant
 * additions that reach schools' stored roles, and mobile screens opened by a
 * function (director, 12 Oct 2026 — "every function of every module
 * grantable, like the old ERP"; the office sends parent-app invitations).
 *
 * Run: npx tsx src/lib/rbacFunctionGrants.selftest.ts
 */
import assert from "node:assert/strict";

import { defaultMobileAccess, resolveMobileFeatures } from "./mobileFeatures";
import {
  BUILT_IN_GRANT_ADDITIONS,
  canSeeModuleTab,
  defaultBuiltInRoles,
  featureAccess,
  featureGrantHeld,
  hasPermission,
  normalizeRbacState,
  roleHasAction,
  type RbacRole,
  type RbacState,
  type SessionLike,
} from "./rbac";

console.log("rbacFunctionGrants.selftest.ts");

const FN = "notices.parent_app_usage";
const ADD = "2026-10-12.office.parent_app_invite";

function role(code: string, over: Partial<RbacRole> = {}): RbacRole {
  return {
    id: `role_${code}`,
    code,
    name: code,
    isBuiltIn: true,
    isActive: true,
    makerChecker: false,
    permissions: [],
    featureGrants: [],
    note: "",
    ...over,
  };
}
function state(roles: RbacRole[]): RbacState {
  return { version: 1, roles, assignments: [], audit: [], userGrants: [], mobile: defaultMobileAccess() };
}
// No masters → roles come from the session's roleCode (inferRoleCodes).
const as = (roleCode: string): SessionLike => ({ roleCode, fullName: "X", persona: "staff" });

/* ── "send": implied by the module's edit, grantable on its own ─────── */
{
  const st = state([
    role("office", { permissions: [{ module: "notices", actions: ["view", "edit"] }] }),
    role("teacher", { permissions: [{ module: "notices", actions: ["view"] }] }),
    role("driver", { featureGrants: [{ feature: FN, actions: ["send"] }] }),
  ]);
  assert.ok(hasPermission(as("office"), null, "notices", "send", st), "module edit implies send");
  assert.ok(!hasPermission(as("teacher"), null, "notices", "send", st), "module view does not");
  assert.ok(roleHasAction(st.roles[0]!, "notices", "send"));
  assert.ok(featureAccess(as("driver"), null, FN, "send", st).allowed, "function send grants send");
  assert.ok(!featureAccess(as("driver"), null, FN, "view", st).allowed, "…and nothing else");
  assert.ok(!hasPermission(as("driver"), null, "notices", "send", st), "a function is not the module");
  assert.ok(canSeeModuleTab(as("driver"), null, "notices", "onapp", st), "send alone opens its tab");
  assert.ok(!canSeeModuleTab(as("driver"), null, "notices", "popups", st), "but no other tab");
  // featureGrantHeld ignores the module grant on purpose.
  assert.ok(!featureGrantHeld(as("office"), null, FN, "view", st));
  assert.ok(featureGrantHeld(as("driver"), null, FN, "send", st));
}

/* ── Built-in grant additions reach stored roles once, adding only ───── */
{
  assert.ok(BUILT_IN_GRANT_ADDITIONS.some((a) => a.id === ADD && a.roleCode === "office"));
  const tmpl = defaultBuiltInRoles().find((r) => r.code === "office")!;
  assert.ok(tmpl.featureGrants?.some((g) => g.feature === FN && g.actions.includes("send")), "fresh office carries it");
  assert.ok(tmpl.defaultsApplied?.includes(ADD));

  // Prod shape on 12 Oct: stored office role, featureGrants [], no defaultsApplied.
  const stored = { ...tmpl, featureGrants: [], defaultsApplied: undefined } as Partial<RbacRole>;
  delete (stored as { defaultsApplied?: unknown }).defaultsApplied;
  const once = normalizeRbacState({ version: 1, roles: [stored as RbacRole] });
  const office = once.roles.find((r) => r.code === "office")!;
  assert.deepEqual(office.featureGrants?.find((g) => g.feature === FN)?.actions.sort(), ["send", "view"]);
  assert.ok(office.defaultsApplied?.includes(ADD));
  assert.ok(once.audit.some((e) => e.detail.includes(ADD)), "the addition is audited");
  assert.ok(featureAccess(as("office"), null, FN, "send", once).allowed);

  // Idempotent: normalising the saved result changes nothing, adds no audit.
  const twice = normalizeRbacState(once);
  assert.deepEqual(twice.roles.find((r) => r.code === "office")!.featureGrants, office.featureGrants);
  assert.equal(twice.audit.filter((e) => e.detail.includes(ADD)).length, 1);

  // The office cleared the box afterwards → that decision stands.
  const cleared = normalizeRbacState({
    ...once,
    roles: once.roles.map((r) => (r.code === "office" ? { ...r, featureGrants: [] } : r)),
  });
  assert.equal(cleared.roles.find((r) => r.code === "office")!.featureGrants?.length, 0);

  // Never removes: other grants on the stored role survive, actions union.
  const other = normalizeRbacState({
    version: 1,
    roles: [{ ...(stored as RbacRole), featureGrants: [{ feature: FN, actions: ["view"] }, { feature: "news.stories", actions: ["view"] }] }],
  });
  const o2 = other.roles.find((r) => r.code === "office")!;
  assert.ok(o2.featureGrants?.some((g) => g.feature === "news.stories"));
  assert.deepEqual(o2.featureGrants?.find((g) => g.feature === FN)?.actions.sort(), ["send", "view"]);

  // A custom (non-built-in) role named office is not touched.
  const custom = normalizeRbacState({ version: 1, roles: [role("office", { id: "role_x", isBuiltIn: false })] });
  assert.equal(custom.roles.find((r) => r.id === "role_x")!.featureGrants?.length, 0);
}

/* ── Mobile: a function opens its mapped screen, additively ──────────── */
{
  const access = defaultMobileAccess();
  access.roleFeatures.gate = ["visitor_gate", "gate_pass_release"];
  const none = resolveMobileFeatures({ roleCodes: ["gate"], access, can: () => false });
  assert.deepEqual(none.features, []);
  const fn = resolveMobileFeatures({
    roleCodes: ["gate"],
    access,
    can: () => false,
    canFeature: (id, a) => id === "visitors.register" && a === "create",
  });
  assert.deepEqual(fn.features, ["visitor_gate"]);
  assert.deepEqual(fn.blockedByRbac, ["gate_pass_release"]);
  const mod = resolveMobileFeatures({ roleCodes: ["gate"], access, can: () => true });
  assert.equal(mod.features.length, 2, "module holders unchanged");
}

console.log("rbacFunctionGrants.selftest.ts: OK");
