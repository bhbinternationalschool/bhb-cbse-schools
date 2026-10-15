/**
 * The survey team and beats, read whole from their rows (15 Oct 2026). Kept
 * apart from lib/surveyTeam.server.ts (which pulls in the write kernel and
 * the API auth, both server-only) because the admissions desk read —
 * reachable from a client module's dynamic import — needs it too.
 */
import { getServerTenantContext } from "@/lib/serverTenant";
import { beatFromRow, memberFromRow, type SurveyTeamData } from "@/lib/surveyTeamShared";

type Row = Record<string, unknown>;

/** Both tables, whole (a school has tens of rows). Throws on a failed read — never "empty". */
export async function readSurveyTeamFromDb(): Promise<SurveyTeamData> {
  const ctx = await getServerTenantContext();
  if (!ctx) throw new Error("School database unavailable");
  const [m, b] = await Promise.all([
    ctx.sb.from("admission_survey_members").select("*").eq("tenant_id", ctx.tenantId).order("created_at", { ascending: true }).limit(2000),
    ctx.sb.from("admission_survey_beats").select("*").eq("tenant_id", ctx.tenantId).order("created_at", { ascending: true }).limit(2000),
  ]);
  if (m.error) throw new Error(`survey team: ${m.error.message}`);
  if (b.error) throw new Error(`survey beats: ${b.error.message}`);
  return {
    members: (m.data ?? []).map((r) => memberFromRow(r as Row)),
    beats: (b.data ?? []).map((r) => beatFromRow(r as Row)).sort((x, y) => x.code.localeCompare(y.code, undefined, { numeric: true })),
  };
}

