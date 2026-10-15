/**
 * The field survey team and beats as the server stores them (15 Oct 2026):
 * one row per member in admission_survey_members, one per beat in
 * admission_survey_beats, each written through desk_write_guarded by
 * lib/surveyTeam.server.ts. Shared by the server, the ERP screen and the
 * self-test; no browser copy is kept anywhere.
 */

/** erp_versions key of the two tables (admission_survey_sync_meta). */
export const SURVEY_TEAM_DESK = "admission_survey";
export const SURVEY_TEAM_VIEW_PATH = "/api/data/views/survey-team";
export const SURVEY_TEAM_WRITE_PATH = "/api/admissions/survey-team";

export type SurveyMemberRow = {
  id: string;
  kind: "staff" | "external";
  staffId: string;
  externalId: string;
  fullName: string;
  mobile: string;
  empCode: string;
  note: string;
  role: "leader" | "agent";
  /** true = may start a survey day on the app. */
  assigned: boolean;
  startMode: "school" | "field";
  /** Beats this member works; [] = any active beat. */
  beatIds: string[];
  createdAt: string;
  /** The row's updated_at — the base of the next write. */
  revision: string;
};

export type SurveyBeatRow = {
  id: string;
  code: string;
  name: string;
  area: string;
  targetHouseholds: number;
  isActive: boolean;
  note: string;
  createdAt: string;
  revision: string;
};

export type SurveyTeamData = { members: SurveyMemberRow[]; beats: SurveyBeatRow[] };

/** What the ERP screen reads (GET /api/data/views/survey-team). */
export type SurveyTeamView = SurveyTeamData & {
  canEdit: boolean;
  /** member key (staff id / ext:<externalId>) → registered phone label */
  phones: Record<string, string>;
  /** Outside workers saved before 15 Oct who are not on the team (read-only, from the old list). */
  savedExternals: { id: string; fullName: string; mobile: string; note: string }[];
};

/**
 * One change, from the office screen or a team leader's phone. The server
 * builds the row; the client names what changes and the revision it loaded.
 */
export type SurveyTeamOp =
  | { op: "member_add_staff"; staffId: string; leader?: boolean }
  | { op: "member_add_external"; fullName: string; mobile: string; note?: string; externalId?: string }
  | {
      op: "member_update";
      id: string;
      base: string;
      assigned?: boolean;
      startMode?: "school" | "field";
      beatIds?: string[];
    }
  | { op: "member_leader"; id: string; base: string }
  | { op: "member_remove"; id: string; base: string }
  | {
      op: "beat_save";
      /** absent = a new beat */
      id?: string;
      base?: string;
      name: string;
      area?: string;
      targetHouseholds?: number;
      note?: string;
    }
  | { op: "beat_active"; id: string; base: string; isActive: boolean };

export const SURVEY_TEAM_OPS = [
  "member_add_staff",
  "member_add_external",
  "member_update",
  "member_leader",
  "member_remove",
  "beat_save",
  "beat_active",
] as const;

/** The ops a team leader may make from the app (the rest are the office's). */
export const LEADER_OPS: readonly SurveyTeamOp["op"][] = ["member_add_staff", "member_remove", "beat_save", "beat_active"];

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));

export function memberFromRow(r: Record<string, unknown>): SurveyMemberRow {
  const beatIds = Array.isArray(r.beat_ids) ? r.beat_ids.map(str).filter(Boolean) : [];
  return {
    id: str(r.id),
    kind: r.kind === "external" ? "external" : "staff",
    staffId: str(r.staff_id),
    externalId: str(r.external_id),
    fullName: str(r.full_name),
    mobile: str(r.mobile),
    empCode: str(r.emp_code),
    note: str(r.note),
    role: r.role === "leader" ? "leader" : "agent",
    assigned: r.assigned !== false,
    startMode: r.start_mode === "field" ? "field" : "school",
    beatIds,
    createdAt: str(r.created_at),
    revision: str(r.updated_at),
  };
}

export function beatFromRow(r: Record<string, unknown>): SurveyBeatRow {
  return {
    id: str(r.id),
    code: str(r.code),
    name: str(r.name),
    area: str(r.area),
    targetHouseholds: Math.max(0, Math.round(Number(r.target_households) || 0)),
    isActive: r.is_active !== false,
    note: str(r.note),
    createdAt: str(r.created_at),
    revision: str(r.updated_at),
  };
}

/** The member key a phone is registered under (lib/surveyDay externalMemberKey). */
export function surveyMemberKey(m: Pick<SurveyMemberRow, "kind" | "staffId" | "externalId">): string {
  return m.kind === "external" ? `ext:${m.externalId}` : m.staffId;
}

export function parseSurveyTeamView(raw: unknown): SurveyTeamView {
  const o = (raw ?? {}) as Partial<SurveyTeamView>;
  if (!Array.isArray(o.members) || !Array.isArray(o.beats)) throw new Error("survey team view: bad shape");
  return {
    members: o.members,
    beats: o.beats,
    canEdit: o.canEdit === true,
    phones: o.phones && typeof o.phones === "object" ? o.phones : {},
    savedExternals: Array.isArray(o.savedExternals) ? o.savedExternals : [],
  };
}
