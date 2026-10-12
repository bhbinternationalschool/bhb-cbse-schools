import { requireStaffApi, type RouteAuthResult } from "@/lib/apiRouteAuth.server";
import { featureGrantHeld, type RbacAction } from "@/lib/rbac";

/**
 * The WhatsApp inbox routes (chats, class channels, household log) sit
 * behind requireWaStaffApi: school-wide staff holding any communications
 * module. This lets a named Comms function (lib/rbacFeatureCatalog/comms.ts)
 * through as well — held as a FUNCTION grant only, so a teacher's notices ·
 * view never counts. Pass the requireWaStaffApi result in:
 *
 *   const auth = await orCommsFunction(req, await requireWaStaffApi(req), "notices.wa_chats", "view");
 *
 * Anything but a plain 403 (not signed in, a bad mirror secret) stands.
 */
export async function orCommsFunction(
  req: Request,
  base: RouteAuthResult,
  featureId: string,
  action: RbacAction,
): Promise<RouteAuthResult> {
  if (base.ok || base.response.status !== 403) return base;
  const staff = await requireStaffApi(req);
  if (!staff.ok) return base;
  const { session, masters, rbac } = staff.ctx;
  return featureGrantHeld(session, masters, featureId, action, rbac) ? staff : base;
}
