/**
 * The field survey team and beats on the server (15 Oct 2026).
 *
 * Each member is one row of admission_survey_members and each beat one row of
 * admission_survey_beats (migration 20261015120000), written ONLY here, one
 * stated change at a time, through desk_write_guarded (data-layer 1.5): the
 * base is the row's updated_at the caller loaded, all-or-none, and
 * admission_survey_sync_meta (erp_versions "admission_survey") moves in the
 * same transaction — so the office screen refetches within one versions poll
 * and the app sees the change on its next status call.
 *
 * Who may change what is decided here, from the server's own records:
 *   office — Admissions (edit) or the "Field survey" function (edit): every op;
 *   leader — a team member whose row says role 'leader', identified by the
 *            phone key registered to them (POST /api/public/survey-day):
 *            add a member of staff, remove an agent (never a leader, never
 *            themselves), add / edit / retire / reactivate a beat.
 *
 * The rules are in lib/surveyTeamPlan.ts (pure, self-tested); this file
 * carries the database.
 */
import { randomUUID } from "node:crypto";
import { referenceCache } from "@/lib/data/server/referenceCache";
import { write as repoWrite } from "@/lib/data/server/repo";
import type { WriteResult } from "@/lib/data/types";
import { getServerTenantContext } from "@/lib/serverTenant";
import {
  SURVEY_TEAM_DESK,
  beatFromRow,
  memberFromRow,
  type SurveyBeatRow,
  type SurveyMemberRow,
  type SurveyTeamData,
} from "@/lib/surveyTeamShared";

export {
  BEATS_COLLECTION,
  MEMBERS_COLLECTION,
  parseSurveyTeamOp,
  planSurveyTeamOp,
  type RosterStaff,
  type SurveyActor,
  type SurveyTeamPlan,
} from "@/lib/surveyTeamPlan";
import type { RosterStaff, SurveyTeamPlan } from "@/lib/surveyTeamPlan";

type Row = Record<string, unknown>;

// ── reads ────────────────────────────────────────────────────────────────

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

/**
 * Per-process copy keyed on erp_versions "admission_survey" (data-layer
 * R5): rebuilt only when a write moved the signal; at most ~2 s behind a
 * write made by another instance.
 */
const teamCache = referenceCache<SurveyTeamData>("survey_team", [SURVEY_TEAM_DESK], async () => {
  try {
    return { ok: true, value: await readSurveyTeamFromDb() };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
});

export async function readSurveyTeam() {
  return teamCache.read();
}

/** The stored team, or null when it cannot be read (refuse, never guess). */
export async function surveyTeamOrNull(): Promise<SurveyTeamData | null> {
  const r = await teamCache.read();
  return r.ok ? r.value : null;
}

// ── writes ───────────────────────────────────────────────────────────────

export async function applySurveyTeamPlan(
  plan: Extract<SurveyTeamPlan, { ok: true }>,
): Promise<WriteResult<Row>> {
  const r = await repoWrite(plan.collection, plan.ops);
  teamCache.invalidate();
  return r;
}

export function newSurveyId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

/** Status for a failed kernel write. */
export function writeFailStatus(r: Extract<WriteResult<Row>, { ok: false }>): number {
  if (r.kind === "conflict") return 409;
  if (r.kind === "invalid") return 400;
  if (r.kind === "auth") return 500; // the table is not on the allowlist: a deploy fault, not the caller's
  return 503;
}

export type { SurveyBeatRow, SurveyMemberRow };

// ── roster (the staff a team may be built from) ──────────────────────────

/** The active staff roster from the server's Masters copy; null = not known (refuse). */
export async function readSurveyRoster(): Promise<RosterStaff[] | null> {
  const { readServerMastersCopy } = await import("@/lib/api/v1/auth");
  const r = await readServerMastersCopy();
  if (!r.ok || r.from === "fallback") return null;
  return rosterOfStaff(r.value.staff ?? []);
}

export function rosterOfStaff(
  staff: readonly { id: string; fullName: string; mobile?: string; empCode?: string; status?: string }[],
): RosterStaff[] {
  return staff.map((x) => ({
    id: x.id,
    fullName: x.fullName,
    mobile: x.mobile || "",
    empCode: x.empCode || "",
    active: x.status === "active",
  }));
}
