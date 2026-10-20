/**
 * Who may change the field survey team, and the rows one change writes
 * (15 Oct 2026). Pure: no database, so the self-test drives it directly;
 * lib/surveyTeam.server.ts applies the plan through the write kernel.
 */
import { asRevision, type WriteOp } from "@/lib/data/types";
import {
  LEADER_OPS,
  SURVEY_TEAM_OPS,
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

