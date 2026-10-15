/**
 * GET /api/data/views/survey-team — the field survey team and beats as the
 * server stores them (admission_survey_members / _beats, 15 Oct 2026), with
 * each member's registered survey phone and the outside workers saved before
 * the move. `versions` = the erp_versions value the copy was built from, so
 * the screen's versions poll refetches it when anyone (another office screen,
 * a team leader's phone) changes the team.
 *
 * Who: Admissions (view) or the "Field survey" function (view). A failed read
 * is 503 — never an empty team.
 */
import { NextResponse } from "next/server";
import { requireStaffPermissionOrFeature } from "@/lib/apiRouteAuth.server";
import { getServerTenantContext } from "@/lib/serverTenant";
import { surveyPhones } from "@/lib/surveyDay.server";
import { readSurveyTeam } from "@/lib/surveyTeam.server";
import { surveyMemberKey, type SurveyTeamView } from "@/lib/surveyTeamShared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };
const fail = (status: number, error: string) => NextResponse.json({ ok: false, error }, { status, headers: NO_STORE });

export async function GET(req: Request) {
  const auth = await requireStaffPermissionOrFeature(req, "admissions", "view", "admissions.field_survey", "view");
  if (!auth.ok) return auth.response;
  const read = await readSurveyTeam();
  if (!read.ok) return fail(503, "Could not load the survey team — please try again.");
  const team = read.value;
  const keys = team.members.map(surveyMemberKey).filter(Boolean);
  const phones = await surveyPhones(keys);
  if (!phones) return fail(503, "Could not load the survey phones — please try again.");

  // Outside workers saved in the old list (before 15 Oct) and not on the team:
  // offered for one-click re-adding; never written back to that list.
  let savedExternals: SurveyTeamView["savedExternals"] = [];
  const ctx = await getServerTenantContext();
  if (ctx) {
    const { data } = await ctx.sb.from("admission_desk_field_ops").select("ops_json").eq("tenant_id", ctx.tenantId).maybeSingle();
    const list = (data as { ops_json?: { surveyExternals?: unknown } } | null)?.ops_json?.surveyExternals;
    if (Array.isArray(list)) {
      const onTeam = new Set(team.members.filter((m) => m.kind === "external").map((m) => m.externalId));
      savedExternals = list
        .map((e) => e as Record<string, unknown>)
        .filter((e) => typeof e.id === "string" && !onTeam.has(e.id))
        .map((e) => ({ id: String(e.id), fullName: String(e.fullName || ""), mobile: String(e.mobile || ""), note: String(e.note || "") }));
    }
  }

  const edit = auth.viaMirrorSecret
    ? { ok: false }
    : await requireStaffPermissionOrFeature(req, "admissions", "edit", "admissions.field_survey", "edit");
  const view: SurveyTeamView = {
    ...team,
    canEdit: edit.ok,
    phones: Object.fromEntries(phones),
    savedExternals,
  };
  return NextResponse.json(
    { ok: true, data: view, versions: read.stale ? null : read.builtFrom, stale: read.stale },
    { headers: NO_STORE },
  );
}
