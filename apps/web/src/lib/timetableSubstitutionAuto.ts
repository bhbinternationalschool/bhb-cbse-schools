/**
 * Auto-run substitution arrangement — the substitution engine
 * (lib/timetableSubstitution.ts) was manual-trigger only: office staff had
 * to remember to open Timetable → Substitutes and click Auto-arrange every
 * time someone was marked absent. This calls the same engine automatically
 * right after a staff-attendance save, and only ever *adds* arrangements
 * for periods that don't already have one — it never overwrites an existing
 * manual or earlier-auto entry, so re-running it (e.g. two absentees marked
 * in the same save) is safe.
 */

import type { MastersState } from "@/lib/masters";
import {
  absentTeachersForDate,
  autoArrangeSubstitutes,
  listSubstitutionsForDate,
  saveSubstitutionsForDate,
  substitutionSlotKey,
} from "@/lib/timetableSubstitution";
import {
  classSectionLabel,
  subjectLabel,
  teacherLabel,
  WEEKDAY_SHORT,
  type TimetableSubstitution,
} from "@/lib/timetable";

export type AutoSubstitutionOutcome = {
  ran: boolean;
  created: TimetableSubstitution[];
  uncovered: number;
  reason?: "no-absentees" | "nothing-new";
};

export function autoRunSubstitutionForDate(
  masters: MastersState,
  academicYearCode: string,
  date: string,
): AutoSubstitutionOutcome {
  const absent = absentTeachersForDate(masters, academicYearCode, date);
  if (!absent.length) {
    return { ran: false, created: [], uncovered: 0, reason: "no-absentees" };
  }

  const already = listSubstitutionsForDate(academicYearCode, date);
  const alreadyCovered = new Set(already.map(substitutionSlotKey));

  const result = autoArrangeSubstitutes({
    masters,
    academicYearCode,
    date,
    absentTeacherIds: absent.map((a) => a.staffId),
  });

  const fresh = result.substitutions.filter(
    (s) => !alreadyCovered.has(substitutionSlotKey(s)),
  );
  if (!fresh.length) {
    return {
      ran: true,
      created: [],
      uncovered: result.uncovered.length,
      reason: "nothing-new",
    };
  }

  saveSubstitutionsForDate(academicYearCode, date, [...already, ...fresh]);
  return { ran: true, created: fresh, uncovered: result.uncovered.length };
}

/** One WhatsApp text per substitute, listing every period just assigned to
 * them today (a teacher covering 3 periods gets one message, not three). */
export function buildSubstituteNotifyMessages(
  created: TimetableSubstitution[],
  masters: MastersState,
  date: string,
): { mobile: string; body: string }[] {
  const byTeacher = new Map<string, TimetableSubstitution[]>();
  for (const s of created) {
    if (!s.substituteTeacherId) continue;
    const list = byTeacher.get(s.substituteTeacherId) ?? [];
    list.push(s);
    byTeacher.set(s.substituteTeacherId, list);
  }

  const out: { mobile: string; body: string }[] = [];
  for (const [teacherId, subs] of byTeacher) {
    const staff = masters.staff.find((s) => s.id === teacherId);
    const mobile = staff?.mobile?.trim();
    if (!mobile) continue;
    const lines = subs
      .sort((a, b) => a.periodNo - b.periodNo)
      .map(
        (s) =>
          `• Period ${s.periodNo} — ${classSectionLabel(masters, s.classId, s.sectionId)} (${subjectLabel(masters, s.subjectId)}), covering for ${teacherLabel(masters, s.absentTeacherId)}`,
      );
    const dayLabel = WEEKDAY_SHORT[subs[0]!.weekday] ?? "";
    out.push({
      mobile,
      body: `You've been arranged as substitute on ${date}${dayLabel ? ` (${dayLabel})` : ""}:\n${lines.join("\n")}`,
    });
  }
  return out;
}

/**
 * Send the substitute-duty WhatsApp notices via the shared dispatch route.
 * Set `dryRun: true` to validate the request without sending (used for
 * testing — this route calls Meta/BSP for real when configured).
 */
export async function notifySubstitutes(
  created: TimetableSubstitution[],
  masters: MastersState,
  date: string,
  opts?: { dryRun?: boolean },
): Promise<{ ok: boolean; sent: number; error?: string }> {
  const messages = buildSubstituteNotifyMessages(created, masters, date);
  if (!messages.length) return { ok: true, sent: 0 };
  try {
    const res = await fetch("/api/wa/dispatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        module: "timetable",
        dryRun: !!opts?.dryRun,
        messages: messages.map((m) => ({ mobile: m.mobile, body: m.body })),
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      accepted?: number;
    };
    if (!res.ok || !data.ok) {
      return { ok: false, sent: 0, error: data.error || `HTTP ${res.status}` };
    }
    return { ok: true, sent: data.accepted ?? messages.length };
  } catch (e) {
    return { ok: false, sent: 0, error: String(e) };
  }
}
