import { writeAudit } from "@/lib/audit.server";
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, requestMeta, resolveApiAuth } from "@/lib/api/v1/auth";
import { ensureAdmissionsHydratedServer } from "@/lib/admissionsPersistence";
import { loadAdmissions } from "@/lib/admissions";
import {
  istDateAndTime,
  listSurveyDays,
  memberKeyOf,
  startSurveyPairing,
  surveyPhones,
} from "@/lib/surveyDay.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET  /api/v1/admissions/survey-days?date=YYYY-MM-DD — the office's view of
 *      the field survey: each team member's start mode and registered phone,
 *      and every survey day on that date with its GPS-stamped captures.
 * POST {action: "pair_start", memberId} → {code, expiresAt} — a one-time
 *      code that registers that surveyor's phone (director, 5 Oct 2026).
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    assertPermission(ctx, "admissions", "view");
    const url = new URL(request.url);
    const raw = url.searchParams.get("date") || "";
    const date = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : istDateAndTime().date;

    await ensureAdmissionsHydratedServer();
    const adm = loadAdmissions();
    const team = adm.surveyTeam ?? [];
    const keys = team.map(memberKeyOf).filter(Boolean);
    const [phones, list] = await Promise.all([surveyPhones(keys), listSurveyDays(date)]);
    if (!phones || !list) throw new ApiError("server_error", "Could not read the survey days — try again.", 503);

    return apiOk({
      date,
      team: team.map((m) => ({
        memberId: m.id,
        memberKey: memberKeyOf(m),
        name: m.fullName,
        kind: m.kind,
        startMode: m.startMode,
        assigned: m.assigned,
        phone: phones.get(memberKeyOf(m)) || null,
      })),
      beats: (adm.surveyBeats ?? []).map((b) => ({ id: b.id, name: b.name })),
      days: list.days,
      captures: list.captures,
    });
  } catch (e) {
    return apiErr(e);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    assertPermission(ctx, "admissions", "edit");
    const body = (await request.json().catch(() => ({}))) as { action?: string; memberId?: string };
    if (body.action !== "pair_start") throw new ApiError("bad_request", "Unknown action", 400);

    await ensureAdmissionsHydratedServer();
    const member = (loadAdmissions().surveyTeam ?? []).find((m) => m.id === body.memberId);
    if (!member) throw new ApiError("not_found", "That surveyor is not on the team.", 404);
    const key = memberKeyOf(member);
    if (!key) throw new ApiError("bad_request", "This team member has no staff or outside-surveyor record.", 400);

    const r = await startSurveyPairing(key, ctx.session.fullName || "Office");
    if (!r.ok) throw new ApiError("server_error", r.error, 503);
    const meta = requestMeta(request);
    await writeAudit({
      session: ctx.session,
      module: "admissions",
      action: "edit",
      entityType: "survey_phone",
      entityId: key,
      summary: `Survey phone pairing code opened for ${member.fullName}`,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return apiOk({ code: r.code, expiresAt: r.expiresAt, name: member.fullName });
  } catch (e) {
    return apiErr(e);
  }
}
