/**
 * Merging the admissions survey lists onto what is stored (2026-10-10).
 *
 * Survey beats, survey attendance, external agents, the survey team, work
 * sessions and the lead-caller list live in one JSON row
 * (admission_desk_field_ops) that every admissions save — the office desk,
 * a survey capture, a call log, the WhatsApp bot — wrote whole from its own
 * copy. A copy read before a field agent checked in, or before a session
 * was started on the staff app, deleted that check-in or session; an older
 * copy put back an ended session as running.
 *
 * Now each list is merged by id onto the stored one:
 *  - nothing is dropped for being absent from this copy — a team member or
 *    a lead caller leaves only when named (the two removals the desk makes);
 *  - a copy's row replaces the stored one, except where that would move it
 *    backwards: an ended session stays ended and keeps its breaks, a
 *    check-out is never blanked.
 */

import type {
  AdmissionsState,
  SurveyAttendance,
  SurveyWorkSession,
} from "@/lib/admissions";

export type FieldOpsLists = Pick<
  AdmissionsState,
  "surveyBeats" | "surveyAttendance" | "surveyExternals" | "surveyTeam" | "surveySessions" | "leadCallerStaffIds"
>;

/** Named removals a save may carry, by list. */
export const FIELD_OPS_DELETABLE = ["admission_survey_team", "admission_lead_callers"] as const;

type WithId = { id: string };

function mergeById<T extends WithId>(
  stored: T[] | undefined,
  mine: T[] | undefined,
  behind: (stored: T, mine: T) => boolean = () => false,
  gone: ReadonlySet<string> = new Set(),
): T[] {
  const out = new Map<string, T>();
  for (const s of stored ?? []) if (s?.id && !gone.has(s.id)) out.set(s.id, s);
  for (const m of mine ?? []) {
    if (!m?.id || gone.has(m.id)) continue;
    const s = out.get(m.id);
    if (s && behind(s, m)) continue;
    out.set(m.id, m);
  }
  return [...out.values()];
}

const sessionBehind = (s: SurveyWorkSession, m: SurveyWorkSession) =>
  (s.status === "ended" && m.status !== "ended") || (s.breaks?.length ?? 0) > (m.breaks?.length ?? 0);

const attendanceBehind = (s: SurveyAttendance, m: SurveyAttendance) => !!s.checkOutAt && !m.checkOutAt;

export function mergeFieldOps(
  stored: Partial<FieldOpsLists> | null,
  mine: FieldOpsLists,
  deletes: Partial<Record<(typeof FIELD_OPS_DELETABLE)[number], readonly string[]>> = {},
): FieldOpsLists {
  // A removal this copy has since undone (re-added) does not apply.
  const mineTeam = new Set((mine.surveyTeam ?? []).map((m) => m.id));
  const mineCallers = new Set(mine.leadCallerStaffIds ?? []);
  const goneTeam = new Set((deletes.admission_survey_team ?? []).filter((id) => !mineTeam.has(id)));
  const goneCallers = new Set((deletes.admission_lead_callers ?? []).filter((id) => !mineCallers.has(id)));
  const callers = new Set<string>();
  for (const id of [...(stored?.leadCallerStaffIds ?? []), ...(mine.leadCallerStaffIds ?? [])]) {
    if (id && !goneCallers.has(id)) callers.add(id);
  }
  return {
    surveyBeats: mergeById(stored?.surveyBeats, mine.surveyBeats),
    surveyAttendance: mergeById(stored?.surveyAttendance, mine.surveyAttendance, attendanceBehind),
    surveyExternals: mergeById(stored?.surveyExternals, mine.surveyExternals),
    surveyTeam: mergeById(stored?.surveyTeam, mine.surveyTeam, undefined, goneTeam),
    surveySessions: mergeById(stored?.surveySessions, mine.surveySessions, sessionBehind),
    leadCallerStaffIds: [...callers],
  };
}
