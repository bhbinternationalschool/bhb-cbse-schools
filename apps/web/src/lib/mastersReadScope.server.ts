import "server-only";

import {
  authorizeSchoolDataDesk,
  requireStaffApi,
  SCHOOL_DATA_DESK_RBAC,
  type RouteAuthFailure,
  type RouteAuthResult,
  type RouteAuthSuccess,
} from "@/lib/apiRouteAuth.server";

/**
 * Who may read Masters, and how much (one rule for every reader — data-layer
 * 1.4: GET /api/school-data/masters-desk and GET /api/data/views/masters).
 *
 *   full      the Masters view grant (masters.view, or a function standing
 *             in for it on the route — requireStaffPermission), or the
 *             mirror sync secret (masters-desk only; the views refuse it
 *             before asking);
 *   teaching  any other member of staff with a staff session: the teaching
 *             subset (lib/mastersTeachingSubset). Staff without the Masters
 *             grant used to get 403 — and with it an EMPTY class list on every
 *             screen; every teacher who signed in on 2026-09-29 saw
 *             "Select class…" with nothing under it;
 *   refused   everything else, with the guard's own answer: 401 without a
 *             session, 403 for a parent or an inactive family, 503 when the
 *             guard's reads failed.
 */
export type MastersReadScope =
  | { ok: true; scope: "full" | "teaching"; auth: RouteAuthSuccess }
  | RouteAuthFailure;

export type MastersReadScopeDeps = {
  authorizeDesk: (req: Request) => Promise<RouteAuthResult>;
  requireStaff: (req: Request) => Promise<RouteAuthResult>;
};

const defaultDeps: MastersReadScopeDeps = {
  authorizeDesk: (req) => authorizeSchoolDataDesk(req, SCHOOL_DATA_DESK_RBAC["masters-desk"], "GET"),
  requireStaff: requireStaffApi,
};

export async function resolveMastersReadScope(
  req: Request,
  deps: MastersReadScopeDeps = defaultDeps,
): Promise<MastersReadScope> {
  const auth = await deps.authorizeDesk(req);
  if (auth.ok) return { ok: true, scope: "full", auth };
  if (auth.response.status === 403) {
    const staff = await deps.requireStaff(req);
    if (staff.ok && !staff.viaMirrorSecret && staff.ctx.session.persona === "staff") {
      return { ok: true, scope: "teaching", auth: staff };
    }
  }
  return auth;
}
