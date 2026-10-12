/**
 * Function grants: the function-only "send" action, the built-in grant
 * additions that reach schools' stored roles, and mobile screens opened by a
 * function (director, 12 Oct 2026 — "every function of every module
 * grantable, like the old ERP"; the office sends parent-app invitations).
 *
 * Run: npx tsx src/lib/rbacFunctionGrants.selftest.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { defaultMobileAccess, resolveMobileFeatures } from "./mobileFeatures";
import { libraryDeskKeysFor } from "./rbacFeatureCatalog/store";
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
  // Before the role row is saved, every load rebuilds the same line.
  const again = normalizeRbacState({ version: 1, roles: [stored as RbacRole] });
  assert.deepEqual(again.audit.find((e) => e.detail.includes(ADD)), once.audit.find((e) => e.detail.includes(ADD)));
  assert.equal(once.audit.find((e) => e.detail.includes(ADD))!.at, "2026-10-12T00:00:00.000Z");

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

/* ── Library desk: each function reads its own keys ───────────────── */
{
  const counter = libraryDeskKeysFor(["store.library_counter"]);
  assert.ok(counter.has("copies") && counter.has("issues") && counter.has("settings"));
  assert.ok(!counter.has("procurementDocs") && !counter.has("ebooks"), "the counter clerk sees no procurement or e-books");
  assert.ok(libraryDeskKeysFor(["store.library_reports"]).has("procurementDocs"));
  assert.equal(libraryDeskKeysFor(["store.counter"]).size, 0, "a non-library store function reads nothing");
}

/* ── Visiting pay: Payroll or its function, never the Staff module ──── */
{
  const st = state([
    role("teacher", { permissions: [{ module: "staff", actions: ["view", "edit"] }] }),
    role("driver", { featureGrants: [{ feature: "staff.visiting_pay", actions: ["view"] }] }),
    role("accounts", { permissions: [{ module: "payroll", actions: ["view"] }] }),
  ]);
  // The route's rule (requireStaffPermissionOrFeature(payroll, a, staff.visiting_pay, a)).
  const routeAllows = (s: SessionLike, a: "view" | "edit") =>
    hasPermission(s, null, "payroll", a, st) || featureGrantHeld(s, null, "staff.visiting_pay", a, st);
  assert.ok(!routeAllows(as("teacher"), "view"), "a teacher (Staff view/edit) is refused → 403");
  assert.ok(!routeAllows(as("teacher"), "edit"));
  assert.ok(routeAllows(as("driver"), "view"), "the function opens it");
  assert.ok(!routeAllows(as("driver"), "edit"), "…at its own actions only");
  assert.ok(routeAllows(as("accounts"), "view"), "Payroll view as before");
  const src = readFileSync(join(__dirname, "../app/api/staff/visiting-pay/route.ts"), "utf8");
  assert.ok(!/requireStaffPermission\(req, "staff"/.test(src), "the route never asks the Staff module");
  assert.ok(/requireStaffPermissionOrFeature\(req, "payroll", action, "staff\.visiting_pay", action\)/.test(src));
}

console.log("rbacFunctionGrants.selftest.ts: OK");
