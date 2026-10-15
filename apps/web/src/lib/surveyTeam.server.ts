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
 * `planSurveyTeamOp` is pure (the self-test drives it); `surveyTeamDeps`
 * carries the database.
 */
import { randomUUID } from "node:crypto";
import { referenceCache } from "@/lib/data/server/referenceCache";
import { write as repoWrite } from "@/lib/data/server/repo";
import { asRevision, type WriteOp, type WriteResult } from "@/lib/data/types";
import { getServerTenantContext } from "@/lib/serverTenant";
import {
  LEADER_OPS,
  SURVEY_TEAM_DESK,
  SURVEY_TEAM_OPS,
  beatFromRow,
  memberFromRow,
  type SurveyBeatRow,
  type SurveyMemberRow,
  type SurveyTeamData,
  type SurveyTeamOp,
} from "@/lib/surveyTeamShared";

export const MEMBERS_COLLECTION = "admissions.survey-members";
export const BEATS_COLLECTION = "admissions.survey-beats";

export type SurveyActor =
  | { kind: "office"; name: string }
  | { kind: "leader"; memberId: string; name: string };

/** A roster entry the server trusts (Masters staff, active only). */
export type RosterStaff = { id: string; fullName: string; mobile: string; empCode: string; active: boolean };

type Row = Record<string, unknown>;

export type SurveyTeamPlan =
  | {
      ok: true;
      collection: typeof MEMBERS_COLLECTION | typeof BEATS_COLLECTION;
      ops: WriteOp<Row>[];
      /** Audit line. */
      summary: string;
      /** The id the op created or changed. */
      id: string;
    }
  | { ok: false; status: number; error: string };

const refuse = (status: number, error: string): SurveyTeamPlan => ({ ok: false, status, error });
const s = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const mobile10 = (v: unknown) => String(v ?? "").replace(/\D/g, "").slice(-10);

/** Parse an untrusted body into an op (or null). */
export function parseSurveyTeamOp(raw: unknown): SurveyTeamOp | null {
  const o = (raw ?? {}) as Record<string, unknown>;
  const op = o.op;
  if (typeof op !== "string" || !(SURVEY_TEAM_OPS as readonly string[]).includes(op)) return null;
  return o as unknown as SurveyTeamOp;
}

/**
 * The rows one change writes, or why it is refused. `data` is the stored
 * team (read just before), `roster` the active staff, `now` / `newId` injected.
 */
export function planSurveyTeamOp(
  op: SurveyTeamOp,
  actor: SurveyActor,
  data: SurveyTeamData,
  roster: readonly RosterStaff[],
  now: Date,
  newId: (prefix: string) => string,
): SurveyTeamPlan {
  if (actor.kind === "leader") {
    if (!LEADER_OPS.includes(op.op)) return refuse(403, "Only the office can do this — ask them in Admissions → Field survey.");
    const me = data.members.find((m) => m.id === actor.memberId);
    if (!me || me.role !== "leader") return refuse(403, "Only the survey team leader can change the team or the beats.");
  }
  const member = (id: unknown) => data.members.find((m) => m.id === id);
  const beat = (id: unknown) => data.beats.find((b) => b.id === id);
  const base = (v: unknown) => (typeof v === "string" && v ? asRevision(v) : null);
  const by = actor.name.slice(0, 80);

  switch (op.op) {
    case "member_add_staff": {
      const st = roster.find((r) => r.id === op.staffId);
      if (!st || !st.active) return refuse(400, "Choose a member of staff who is on the roster.");
      if (data.members.some((m) => m.kind === "staff" && m.staffId === st.id)) {
        return refuse(409, `${st.fullName} is already on the survey team.`);
      }
      const leader = op.leader === true && actor.kind === "office";
      const id = newId("stm");
      const ops: WriteOp<Row>[] = [];
      if (leader) {
        for (const m of data.members) {
          if (m.role === "leader") ops.push({ op: "upsert", id: m.id, base: base(m.revision), row: { role: "agent" } });
        }
      }
      ops.push({
        op: "upsert",
        id,
        base: null,
        row: {
          kind: "staff",
          staff_id: st.id,
          external_id: "",
          full_name: st.fullName,
          mobile: mobile10(st.mobile),
          emp_code: st.empCode,
          role: leader ? "leader" : "agent",
          assigned: true,
          start_mode: "school",
          beat_ids: [],
          created_by: by,
          created_at: now.toISOString(),
        },
      });
      return { ok: true, collection: MEMBERS_COLLECTION, ops, id, summary: `${st.fullName} added to the survey team${leader ? " as team leader" : ""} by ${by}` };
    }
    case "member_add_external": {
      const fullName = s(op.fullName, 120);
      const mob = mobile10(op.mobile);
      if (fullName.length < 2) return refuse(400, "Name is required.");
      if (!/^[6-9]\d{9}$/.test(mob)) return refuse(400, "Mobile must be 10 digits.");
      const externalId = s(op.externalId, 60) || newId("sve");
      if (data.members.some((m) => m.kind === "external" && (m.externalId === externalId || m.mobile === mob))) {
        return refuse(409, "An outside worker with this mobile is already on the team.");
      }
      const id = newId("stm");
      return {
        ok: true,
        collection: MEMBERS_COLLECTION,
        id,
        summary: `Outside surveyor ${fullName} added to the survey team by ${by}`,
        ops: [
          {
            op: "upsert",
            id,
            base: null,
            row: {
              kind: "external",
              staff_id: "",
              external_id: externalId,
              full_name: fullName,
              mobile: mob,
              emp_code: "EXT",
              note: s(op.note, 300),
              role: "agent",
              assigned: true,
              start_mode: "field",
              beat_ids: [],
              created_by: by,
              created_at: now.toISOString(),
            },
          },
        ],
      };
    }
    case "member_update": {
      const m = member(op.id);
      if (!m) return refuse(404, "That person is no longer on the team.");
      const row: Row = {};
      if (typeof op.assigned === "boolean") row.assigned = op.assigned;
      if (op.startMode === "school" || op.startMode === "field") row.start_mode = op.startMode;
      if (Array.isArray(op.beatIds)) {
        const ids = [...new Set(op.beatIds.map(String))];
        if (ids.some((b) => !beat(b))) return refuse(400, "One of those beats does not exist.");
        row.beat_ids = ids;
      }
      if (Object.keys(row).length === 0) return refuse(400, "Nothing to change.");
      return { ok: true, collection: MEMBERS_COLLECTION, id: m.id, summary: `Survey team: ${m.fullName} changed (${Object.keys(row).join(", ")}) by ${by}`, ops: [{ op: "upsert", id: m.id, base: base(op.base), row }] };
    }
    case "member_leader": {
      const m = member(op.id);
      if (!m) return refuse(404, "That person is no longer on the team.");
      const ops: WriteOp<Row>[] = [];
      for (const o of data.members) {
        if (o.id !== m.id && o.role === "leader") ops.push({ op: "upsert", id: o.id, base: base(o.revision), row: { role: "agent" } });
      }
      ops.push({ op: "upsert", id: m.id, base: base(op.base), row: { role: "leader" } });
      return { ok: true, collection: MEMBERS_COLLECTION, id: m.id, summary: `${m.fullName} made survey team leader by ${by}`, ops };
    }
    case "member_remove": {
      const m = member(op.id);
      if (!m) return refuse(404, "That person is no longer on the team.");
      if (actor.kind === "leader") {
        if (m.id === actor.memberId) return refuse(403, "You cannot remove yourself — ask the office.");
        if (m.role === "leader") return refuse(403, "Only the office can remove a team leader.");
        if (m.kind !== "staff") return refuse(403, "Only the office can remove an outside surveyor.");
      }
      return { ok: true, collection: MEMBERS_COLLECTION, id: m.id, summary: `${m.fullName} removed from the survey team by ${by}`, ops: [{ op: "delete", id: m.id, base: base(op.base) }] };
    }
    case "beat_save": {
      const name = s(op.name, 80);
      if (name.length < 2) return refuse(400, "Beat name is required.");
      const target = Math.max(0, Math.min(100_000, Math.round(Number(op.targetHouseholds) || 0)));
      const fields: Row = { name, area: s(op.area, 120), target_households: target, note: s(op.note, 300) };
      if (op.id) {
        const b = beat(op.id);
        if (!b) return refuse(404, "That beat no longer exists.");
        if (data.beats.some((x) => x.id !== b.id && x.name.toLowerCase() === name.toLowerCase())) {
          return refuse(409, `A beat called ${name} already exists.`);
        }
        return { ok: true, collection: BEATS_COLLECTION, id: b.id, summary: `Survey beat ${name} edited by ${by}`, ops: [{ op: "upsert", id: b.id, base: base(op.base), row: fields }] };
      }
      if (data.beats.some((x) => x.name.toLowerCase() === name.toLowerCase())) return refuse(409, `A beat called ${name} already exists.`);
      const used = new Set(data.beats.map((b) => b.code));
      let n = data.beats.length + 1;
      while (used.has(`B${n}`)) n++;
      const id = newId("beat");
      return {
        ok: true,
        collection: BEATS_COLLECTION,
        id,
        summary: `Survey beat ${name} added by ${by}`,
        ops: [{ op: "upsert", id, base: null, row: { ...fields, code: `B${n}`, is_active: true, created_by: by, created_at: now.toISOString() } }],
      };
    }
    case "beat_active": {
      const b = beat(op.id);
      if (!b) return refuse(404, "That beat no longer exists.");
      if (typeof op.isActive !== "boolean") return refuse(400, "Say whether the beat is on or off.");
      return { ok: true, collection: BEATS_COLLECTION, id: b.id, summary: `Survey beat ${b.name} ${op.isActive ? "reactivated" : "retired"} by ${by}`, ops: [{ op: "upsert", id: b.id, base: base(op.base), row: { is_active: op.isActive } }] };
    }
  }
  return refuse(400, "Unknown change.");
}

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
