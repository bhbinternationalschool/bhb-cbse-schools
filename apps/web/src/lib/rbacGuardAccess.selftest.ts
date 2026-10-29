/**
 * Data-layer 2.3b: the lib/ save checks (lib/rbacGuard) decide with this
 * tab's rbac + staff-list view answers (lib/data/client/tabCache), and a
 * check made before those answered REFUSES WITH "not_loaded" — never the
 * "You do not have permission" a real refusal raises.
 *
 *  1. Nothing answered yet (loading) → refused, reason "not_loaded".
 *  2. The reads failed with no answer → refused, reason "not_loaded".
 *  3. Both answered → a person whose grant is a school-made role by
 *     assignment (only in the stored rbac) is allowed — the page copies,
 *     which never loaded here, are not what decides.
 *  4. Both answered, no grant → refused WITHOUT a reason (a real "no").
 *  5. A failed background refetch keeps the earlier answer: still decides.
 *  6. Export and Roles & permissions checks follow the same rule.
 *  7. No staff shell (no query provider) → the page copies, as before.
 *
 * Cases 1–3 and 6 fail on the code before 2.3b (it read loadMasters().staff +
 * loadRbac(): an empty roster and the built-in roles, so the clerk was told
 * "no", with no reason).
 *
 *   npx tsx src/lib/rbacGuardAccess.selftest.ts
 */
import assert from "node:assert/strict";
import { QueryClient } from "@tanstack/react-query";

// A browser tab with a database configured (isSupabaseConfigured).
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:1";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "selftest";
type Detail = { module: string; action: string; label: string; reason?: string };
const events: Detail[] = [];
const target = new EventTarget();
(globalThis as unknown as { window: unknown }).window = {
  dispatchEvent: (e: Event) => {
    if (e.type === "bhb-rbac-denied") events.push((e as CustomEvent<Detail>).detail);
    return target.dispatchEvent(e);
  },
  addEventListener: target.addEventListener.bind(target),
  removeEventListener: target.removeEventListener.bind(target),
};

async function main() {
  const { setSessionActor } = await import("@/lib/sessionActor");
  const guard = await import("@/lib/rbacGuard");
  const { defaultRbacState } = await import("@/lib/rbac");
  const tab = await import("@/lib/data/client/tabCache");

  let failures = 0;
  function check(name: string, fn: () => void) {
    events.length = 0;
    try {
      fn();
      console.log(`  ok  ${name}`);
    } catch (e) {
      failures += 1;
      console.error(`  FAIL ${name}\n       ${(e as Error).message}`);
    }
  }

  // The certificates clerk of the e2e fixture: a peon on the roster whose
  // Students / Certificates grants come only from a school-made role
  // assigned to her in the stored rbac.
  const CLERK = "stf_clerk";
  const base = defaultRbacState();
  const clerkRole = {
    id: "role_clerk",
    code: "cert_clerk",
    name: "Certificates clerk",
    isBuiltIn: false,
    isActive: true,
    makerChecker: false,
    permissions: [
      { module: "home", actions: ["view"] },
      { module: "students", actions: ["view", "edit"] },
      { module: "certificates", actions: ["view", "create", "edit", "export"] },
    ],
    note: "",
  };
  const rbacView = {
    rbac: {
      ...base,
      roles: [...base.roles, clerkRole],
      assignments: [
        {
          id: "asg_clerk",
          staffId: CLERK,
          roleId: clerkRole.id,
          isPrimary: true,
          scope: { campusIds: [], classIds: [], departmentIds: [] },
          expiresOn: "",
          note: "",
        },
      ],
    },
  };
  const staffView = {
    staff: [
      {
        id: CLERK,
        empCode: "E-31",
        fullName: "Ekta Clerk",
        stream: "non_teaching",
        status: "active",
        departmentId: "dep_support",
        designationId: "des_peon",
        classTeacherLinks: [],
        subjectTeachingLinks: [],
        vehicleLinks: [],
        dutyLinks: [],
      },
    ],
    departments: [{ id: "dep_support", code: "SUP", name: "Support", isActive: true }],
    designations: [{ id: "des_peon", code: "PEON", name: "Peon", departmentId: "dep_support", isActive: true }],
  };
  setSessionActor({ persona: "staff", staffId: CLERK, fullName: "Ekta Clerk", roleCode: "staff" } as never);

  const answer = (client: QueryClient, key: readonly string[], data: unknown) =>
    client.setQueryData([...key], { data, builtFrom: null });
  const fail = (client: QueryClient, key: readonly string[]) => {
    const q = client.getQueryCache().build(client, { queryKey: [...key] });
    q.setState({ ...q.state, status: "error", error: new Error("503"), fetchStatus: "idle" });
  };
  const notLoaded = () => {
    assert.equal(events.length, 1, `one refusal event, got ${JSON.stringify(events)}`);
    assert.equal(events[0]!.reason, "not_loaded", `the refusal says "not loaded", got ${JSON.stringify(events[0])}`);
  };

  console.log("not answered yet");
  const loading = new QueryClient();
  tab.setTabQueryClient(loading);
  check("1. a save before the roles and roster answered is refused as not loaded, not as no permission", () => {
    assert.equal(guard.assertModulePermission("students", "edit", "saveSis"), false);
    notLoaded();
  });
  check("1b. only one of the two answered: still not loaded", () => {
    answer(loading, tab.RBAC_VIEW_KEY, rbacView);
    assert.equal(guard.assertModulePermission("students", "edit", "saveSis"), false);
    notLoaded();
  });

  console.log("the reads failed");
  const failed = new QueryClient();
  tab.setTabQueryClient(failed);
  fail(failed, tab.RBAC_VIEW_KEY);
  fail(failed, tab.STAFF_LIST_VIEW_KEY);
  check("2. failed reads: refused as not loaded", () => {
    assert.equal(tab.tabAccessCopy().status, "failed");
    assert.equal(guard.assertModulePermission("students", "edit", "saveSis"), false);
    notLoaded();
  });
  check("6a. export before the answers: refused as not loaded", () => {
    assert.equal(guard.actorMayExport("students"), false);
    notLoaded();
  });
  check("6b. Roles & permissions save before the answers: refused as not loaded", () => {
    assert.equal(guard.assertCanConfigureRbac(), false);
    notLoaded();
  });
  check("6c. self-or-module before the answers: refused as not loaded", () => {
    assert.equal(guard.assertSelfOrModulePermission("staff", "edit", "someone_else"), false);
    notLoaded();
  });

  console.log("both answered");
  const ready = new QueryClient();
  tab.setTabQueryClient(ready);
  answer(ready, tab.RBAC_VIEW_KEY, rbacView);
  answer(ready, tab.STAFF_LIST_VIEW_KEY, staffView);
  check("3. the clerk's role by assignment (stored rbac only) allows her Students save", () => {
    assert.equal(guard.assertModulePermission("students", "edit", "saveSis"), true);
    assert.equal(events.length, 0);
  });
  check("3b. and her certificate export", () => {
    assert.equal(guard.actorMayExport("certificates"), true);
  });
  check("4. a module she does not hold is a real no — refused without a reason", () => {
    assert.equal(guard.assertModulePermission("fees", "edit", "saveFees"), false);
    assert.equal(events.length, 1);
    assert.equal(events[0]!.reason, undefined);
  });
  check("5. a failed background refetch keeps the answer: still decides", () => {
    const q = ready.getQueryCache().find({ queryKey: [...tab.RBAC_VIEW_KEY], exact: true })!;
    q.setState({ ...q.state, status: "error", error: new Error("503") });
    assert.equal(guard.assertModulePermission("students", "edit", "saveSis"), true);
  });

  console.log("no staff shell");
  tab.setTabQueryClient(null);
  check("7. no query provider: the page copies decide, as before (no not_loaded)", () => {
    // Decided from whatever the page copies hold (the legacy read) — this
    // file asserts only that it is decided, not refused as not loaded.
    guard.assertModulePermission("students", "edit", "saveSis");
    assert.ok(events.every((e) => e.reason !== "not_loaded"));
  });

  if (failures) {
    console.error(`\n${failures} failed`);
    process.exit(1);
  }
  console.log("\nall passed");
}

void main();
