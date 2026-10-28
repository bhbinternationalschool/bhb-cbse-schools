/**
 * POST /api/data/sis.staff/sensitive — bank, UPI, Aadhaar, PAN, pay and the
 * login of a staff record (data-layer 2.2b). Rules: lib/data/server/staffSensitive.ts.
 * Any other collection here is a 404.
 */
import { NextResponse } from "next/server";
import { invalidateServerMastersCache } from "@/lib/api/v1/auth";
import { functionGrantHeldOnServer, requireStaffApi } from "@/lib/apiRouteAuth.server";
import { readRowsByIds, signInMobilesInUse, staffSignInLinks, writeStaffSensitive } from "@/lib/data/server/repo";
import { buildSensitiveOps, parseSensitiveOps } from "@/lib/data/server/staffSensitive";
import { clearDeskProbeCache } from "@/lib/deskProbeCache.server";
import { STAFF_SENSITIVE_FEATURE, STAFF_SENSITIVE_NO_AUTHORITY, staffActorOf, staffSensitiveAuthority, takenLinksOf } from "@/lib/staffProtectedFields";
import { withBuildCheck } from "@/lib/staleBuild.server";

export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ collection: string }> };

const fail = (status: number, kind: string, message: string) =>
  NextResponse.json({ ok: false, kind, message, conflicts: [] }, { status });

export const POST = withBuildCheck(async (req: Request, ctx: RouteCtx) => {
  const { collection } = await ctx.params;
  if (collection !== "sis.staff") return fail(404, "not_found", "Unknown collection");

  // The RBAC gate: the owner, or the FUNCTION staff.sensitive_edit as a
  // function grant (director, 21 Oct 2026: owner + accountant). Staff,
  // payroll or accounts · edit as such do not open it — the Office and Admin
  // roles hold those for their daily work.
  const auth = await requireStaffApi(req);
  if (!auth.ok) return auth.response;
  // The mirror-sync secret is a machine, not a person: never an authority.
  if (auth.viaMirrorSecret) return fail(403, "auth", "Protected staff fields are changed only by a signed-in person.");

  const { session, masters, rbac } = auth.ctx;
  const authority = staffSensitiveAuthority(session, masters, rbac, { rbacKnown: auth.ctx.rbacKnown !== false });
  const actor = staffActorOf(session);
  // The same answer, asked the catalog's way: an owner, or the function held as a function grant.
  const gated = authority === "owner" || functionGrantHeldOnServer(auth.ctx, STAFF_SENSITIVE_FEATURE, "edit");
  if (!authority || !gated || !actor) {
    return fail(403, "auth", STAFF_SENSITIVE_NO_AUTHORITY);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail(400, "invalid", "Invalid JSON");
  }
  const parsed = parseSensitiveOps(raw);
  if (typeof parsed === "string") return fail(400, "invalid", parsed);

  let stored: Map<string, Record<string, unknown>>;
  try {
    stored = await readRowsByIds("sis_staff", parsed.map((o) => o.id));
  } catch (e) {
    return fail(503, "unavailable", `Could not read the staff records — nothing was written (${e instanceof Error ? e.message : String(e)}).`);
  }
  let links: Record<string, unknown>[] = [];
  let mobiles = new Set<string>();
  if (parsed.some((o) => "email" in o.fields || "mobile" in o.fields)) {
    try {
      [links, mobiles] = await Promise.all([staffSignInLinks(), signInMobilesInUse()]);
    } catch (e) {
      return fail(503, "unavailable", `Could not check the sign-in details in use — nothing was written (${e instanceof Error ? e.message : String(e)}).`);
    }
  }
  const built = buildSensitiveOps(parsed, stored, authority, (id) => ({
    emails: takenLinksOf(links.filter((l) => String(l.id) !== id)).emails,
    mobiles,
  }));
  if (!built.ok) {
    const kind = built.status === 403 ? "auth" : built.status === 404 ? "not_found" : built.status === 409 ? "conflict" : "invalid";
    return fail(built.status, kind, built.message);
  }

  const result = await writeStaffSensitive(built.ops, authority, actor);
  if (!result.ok) {
    const status = result.kind === "conflict" ? 409 : result.kind === "auth" ? 403 : result.kind === "invalid" ? 400 : 503;
    return NextResponse.json(result, { status });
  }
  if (result.results.some((r) => r.status === "applied")) {
    clearDeskProbeCache("staff-roster");
    invalidateServerMastersCache();
  }
  console.info(`[sis.staff/sensitive] ${actor} (${authority}) wrote ${built.ops.map((o) => o.id).join(", ")}`);
  return NextResponse.json({ ...result, authority });
});
