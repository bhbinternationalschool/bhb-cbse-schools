import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { handleErpStaffCommand, type ErpCommandFlow } from "@/lib/erpCommands.server";
import { staffRolesFor } from "@/lib/waRoleResolver";

export const runtime = "nodejs";

/**
 * POST /api/v1/commands  { text }
 *
 * The staff app's command bar. Same engine as the WhatsApp branch — same
 * catalogue, RBAC through the caller's staff record, section scope, pause
 * switch, hourly cap, audit — keyed by staff id instead of mobile. A confirm
 * card comes back as `confirm: { token, yesId, noId }`; the app posts the
 * chosen id back as `text` exactly like a WhatsApp button tap.
 *
 * Unlike WhatsApp there is no older bot to fall through to, so a message the
 * engine does not recognise gets a short "not a command" reply here.
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }
    let body: { text?: string };
    try {
      body = (await request.json()) as { text?: string };
    } catch {
      throw new ApiError("bad_request", "Invalid JSON", 400);
    }
    const text = (body.text || "").trim();
    if (!text) throw new ApiError("bad_request", "text required", 400);
    if (text.length > 500) throw new ApiError("bad_request", "text too long", 400);

    await ensureSchoolMirrorHydrated();

    const roster = ctx.masters.staff ?? [];
    const email = (ctx.session.email || "").trim().toLowerCase();
    const staff =
      roster.find((s) => s.id === ctx.session.staffId) ??
      (email
        ? roster.find(
            (s) =>
              (s.email || "").trim().toLowerCase() === email ||
              (s.loginUsername || "").trim().toLowerCase() === email,
          )
        : undefined) ??
      null;

    // owner > staff > teacher, the same reading the WhatsApp bot gives a
    // staff record, so one person gets one behaviour on both channels.
    let flow: ErpCommandFlow = "staff";
    if (staff) {
      const kinds = staffRolesFor(staff, ctx.masters.designations ?? []).map((r) => r.kind);
      flow = kinds.includes("owner") ? "owner" : kinds.includes("staff") ? "staff" : "teacher";
    }

    const r = await handleErpStaffCommand({
      actorKey: `staff:${staff?.id || ctx.session.email || ctx.session.fullName}`,
      channel: "app",
      text,
      flow,
      staff,
      displayName: staff?.fullName || ctx.session.fullName,
    });

    if (!r.handled) {
      return apiOk({
        handled: false,
        audience: "erp_command_none",
        text: "I didn't understand that as a command. Try *COMMANDS* to see what you can ask, e.g. _5A me aaj kaun absent hai_.",
        confirm: null,
      });
    }
    return apiOk({
      handled: true,
      audience: r.audience,
      text: r.text || r.menu?.textFallback || "",
      confirm: r.confirm ?? null,
    });
  } catch (e) {
    return apiErr(e);
  }
}
