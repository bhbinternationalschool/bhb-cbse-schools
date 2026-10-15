/**
 * POST /api/admissions/survey-team — the office changes the field survey
 * team or its beats (15 Oct 2026), one change per request, through the write
 * kernel (lib/surveyTeam.server.ts). Also `{op: "pair_start", memberId}`: a
 * one-time 6-digit code that registers that member's phone for the survey
 * (expires in 10 minutes; opening another cancels it).
 *
 * Who: Admissions (edit), or the "Field survey" function (edit) — checked
 * here, on the server. A team leader makes the same changes from the app
 * through POST /api/public/survey-day (signed by their phone).
 * Answers: 200 {ok:true, id} only when the database wrote it; 409 with the
 * server's message when the row changed since the screen loaded it.
 */
import { NextResponse } from "next/server";
import { requireStaffPermissionOrFeature } from "@/lib/apiRouteAuth.server";
import { writeAudit } from "@/lib/audit.server";
import { requestMeta } from "@/lib/api/v1/auth";
import { startSurveyPairing } from "@/lib/surveyDay.server";
import {
  applySurveyTeamPlan,
  newSurveyId,
  parseSurveyTeamOp,
  planSurveyTeamOp,
  readSurveyRoster,
  rosterOfStaff,
  surveyTeamOrNull,
  writeFailStatus,
} from "@/lib/surveyTeam.server";
import { surveyMemberKey } from "@/lib/surveyTeamShared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };
const fail = (status: number, error: string) => NextResponse.json({ ok: false, error }, { status, headers: NO_STORE });

export async function POST(req: Request) {
  const auth = await requireStaffPermissionOrFeature(req, "admissions", "edit", "admissions.field_survey", "edit");
  if (!auth.ok) return auth.response;
  if (auth.viaMirrorSecret) return fail(403, "The survey team is changed by signed-in staff.");
  const ctx = auth.ctx;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const meta = requestMeta(req);
  const by = ctx.session.fullName || "Office";

  const team = await surveyTeamOrNull();
  if (!team) return fail(503, "Could not read the survey team — nothing was changed. Try again.");

  if (body?.op === "pair_start") {
    const m = team.members.find((x) => x.id === body.memberId);
    if (!m) return fail(404, "That person is not on the survey team.");
    const key = surveyMemberKey(m);
    const r = await startSurveyPairing(key, by);
    if (!r.ok) return fail(503, r.error);
    await writeAudit({
      session: ctx.session,
      module: "admissions",
      action: "edit",
      entityType: "survey_phone",
      entityId: key,
      summary: `Survey phone pairing code opened for ${m.fullName}`,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return NextResponse.json({ ok: true, code: r.code, expiresAt: r.expiresAt, name: m.fullName }, { headers: NO_STORE });
  }

  const op = parseSurveyTeamOp(body);
  if (!op) return fail(400, "Unknown change.");
  // The roster is the request's own Masters copy (the same one its auth read).
  const roster = ctx.masters?.staff?.length ? rosterOfStaff(ctx.masters.staff) : await readSurveyRoster();
  if (!roster) return fail(503, "Could not read the staff roster — nothing was changed. Try again.");

  const plan = planSurveyTeamOp(op, { kind: "office", name: by }, team, roster, new Date(), newSurveyId);
  if (!plan.ok) return fail(plan.status, plan.error);
  const w = await applySurveyTeamPlan(plan);
  if (!w.ok) {
    const status = writeFailStatus(w);
    return fail(
      status,
      status === 409 ? "Someone changed this on another screen — the list now shows the newest. Nothing was written." : w.message,
    );
  }
  await writeAudit({
    session: ctx.session,
    module: "admissions",
    action: op.op === "member_remove" ? "delete" : op.op.endsWith("_add_staff") || op.op === "member_add_external" || (op.op === "beat_save" && !op.id) ? "create" : "edit",
    entityType: plan.collection === "admissions.survey-beats" ? "survey_beat" : "survey_member",
    entityId: plan.id,
    summary: plan.summary,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
  return NextResponse.json({ ok: true, id: plan.id }, { headers: NO_STORE });
}
