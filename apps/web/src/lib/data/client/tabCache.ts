/**
 * Data-layer 2.3b: this tab's reference answers, read from the shared React
 * Query cache by lib/ code that runs outside React — the save checks
 * (lib/rbacGuard) and the printed identity (lib/schoolIdentity).
 *
 * Until 2.3b those read the tab's PAGE copies (loadMasters().staff +
 * loadRbac()). A copy that had not landed was an empty roster and the
 * built-in roles, so a check made before it landed said "You do not have
 * permission" to someone who had it (R6: unknown became "no").
 *
 * Here "not answered yet" and "the read failed" are their own outcomes —
 * `loading` / `failed` — and never a roster or a role list. The rules are
 * the access copy's (./accessCopy accessStatusOf): `ready` only once BOTH the
 * rbac and the staff-list views have answered.
 *
 * No React, no "use client": a plain module that only holds the provider's
 * client (set by ErpQueryProvider) and reads its cache. Self-tested in
 * tabCache.selftest.ts.
 */
import type { QueryClient } from "@tanstack/react-query";
import type { MastersState } from "@/lib/masters";
import type { RbacState } from "@/lib/rbac";
import type { MastersView, RbacView, StaffListView } from "../viewTypes";
import { accessMastersOf, accessRbacOf, accessStatusOf } from "./accessCopy";

let tabClient: QueryClient | null = null;

/** ErpQueryProvider registers its client (one per tab). */
export function setTabQueryClient(client: QueryClient | null): void {
  tabClient = client;
}

export function getTabQueryClient(): QueryClient | null {
  return tabClient;
}

/** The query keys useMasters / useRbac / useStaffList store their answers under (useErpQuery: [name, path]). */
export const MASTERS_VIEW_KEY = ["masters", "/api/data/views/masters"] as const;
export const RBAC_VIEW_KEY = ["rbac", "/api/data/views/rbac"] as const;
export const STAFF_LIST_VIEW_KEY = ["staff-list", "/api/data/views/staff-list"] as const;

type Raw<T> = { data: T };

function viewOf<T>(client: QueryClient, key: readonly string[]): { data: T | undefined; isError: boolean } {
  const q = client.getQueryCache().find({ queryKey: [...key], exact: true });
  const raw = q?.state.data as Raw<T> | undefined;
  return { data: raw?.data, isError: q?.state.status === "error" };
}

export type TabAccess =
  | { status: "ready"; masters: MastersState; rbac: RbacState }
  /** A view has not answered yet. */
  | { status: "loading" }
  /** A view failed and never answered. */
  | { status: "failed" }
  /** No staff shell in this tab (no query provider): nothing to read. */
  | { status: "no-client" };

/**
 * The roles and roster this tab's permission checks decide with — the same
 * two answers the sidebar and the module gate use (useAccessData) — or why
 * there are none.
 */
export function tabAccessCopy(client: QueryClient | null = tabClient): TabAccess {
  if (!client) return { status: "no-client" };
  const rbac = viewOf<RbacView>(client, RBAC_VIEW_KEY);
  const staff = viewOf<StaffListView>(client, STAFF_LIST_VIEW_KEY);
  const status = accessStatusOf({
    remote: true,
    mounted: true,
    rbac: { hasData: rbac.data !== undefined, isError: rbac.isError },
    staff: { hasData: staff.data !== undefined, isError: staff.isError },
  });
  if (status === "ready" && rbac.data && staff.data) {
    return { status: "ready", masters: accessMastersOf(staff.data), rbac: accessRbacOf(rbac.data) };
  }
  return { status: status === "failed" ? "failed" : "loading" };
}

/** Ask the two access reads again (after a check could not decide). */
export function retryTabAccess(client: QueryClient | null = tabClient): void {
  if (!client) return;
  void client.refetchQueries({ queryKey: [...RBAC_VIEW_KEY], exact: true }).catch(() => undefined);
  void client.refetchQueries({ queryKey: [...STAFF_LIST_VIEW_KEY], exact: true }).catch(() => undefined);
}

/**
 * The Masters book of this tab's masters answer (full, or the teaching
 * subset — which carries schoolProfile), or null when there is none yet.
 * The staff shell renders no screen before it (ShellDataWait).
 */
export function tabMastersBook(client: QueryClient | null = tabClient): MastersState | null {
  if (!client) return null;
  const view = viewOf<MastersView>(client, MASTERS_VIEW_KEY).data;
  return view ? (view.masters as unknown as MastersState) : null;
}
