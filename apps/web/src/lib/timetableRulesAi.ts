/**
 * AI suggestion of one class's weekly load and placement rules (director,
 * 5 Oct 2026). Pure: the facts, the prompt, and the parser that keeps the
 * model to the class's own subjects and the week's real capacity.
 *
 * The model only PROPOSES — periods/week and rules per subject. The office
 * sees it beside the current values and saves what it accepts. The solver
 * (lib/timetablePlacement) still places every period; a model never writes
 * a timetable, so it can never double-book a teacher.
 */

import { normalizeSubjectRule, type TimeOfDay, type TimetableSubjectRule } from "@/lib/timetableRules";

export type TimetableRulesFacts = {
  className: string;
  /** "pre-primary (Nursery–UKG, NCF foundational stage)", "primary (I–V)", … */
  stage: string;
  /** Teaching periods in one week for this class (days × periods/day). */
  weeklyCapacity: number;
  periodsPerDay: number;
  periodMinutes: number;
  subjects: {
    id: string;
    name: string;
    kind: "scholastic" | "co-scholastic";
    currentPeriodsPerWeek: number;
  }[];
};

export type TimetableRulesSuggestion = {
  subjectId: string;
  periodsPerWeek: number;
  rule: TimetableSubjectRule;
  why: string;
};

export function buildTimetableRulesPrompt(f: TimetableRulesFacts): { system: string; userMessage: string } {
  const system = `You plan the weekly subject load for one class of an Indian CBSE-pattern school, following NEP 2020 / NCF.
For EACH subject listed, propose: periods per week, how many of them are double (back-to-back) periods, the time of day, the most periods in one day, and periods to avoid.
Rules you must follow:
- Use ONLY the subject ids given. Do not add or rename subjects.
- The total of periodsPerWeek must not exceed the weekly capacity given.
- Scholastic core subjects (languages, mathematics, EVS/science, social science) go in the morning, one a day unless the load needs more.
- Co-scholastic subjects (art, music, dance, physical education, games, yoga, work education) go after the break; physical education and games never in the first period nor straight after lunch.
- Double periods only where a longer stretch helps (art & craft, games, computer/science practical); never for languages or maths below Class VI.
- For pre-primary (Nursery, LKG, UKG): play-based; literacy and numeracy may come twice a day in short sessions; more time for play, art, music and movement than older classes.
- Never comment on anything not given to you.
Respond with JSON only:
{"subjects":[{"id":"<subject id>","periodsPerWeek":n,"doublesPerWeek":n,"timeOfDay":"morning"|"after_break"|"any","maxPerDay":n,"avoidFirstPeriod":bool,"avoidLastPeriod":bool,"avoidAfterLunch":bool,"why":"one short reason"}]}`;
  const userMessage = `Class: ${f.className}
Stage: ${f.stage}
Weekly capacity: ${f.weeklyCapacity} teaching periods (${f.periodsPerDay} a day, about ${f.periodMinutes} minutes each)
Subjects (id · name · kind · periods/week now):
${f.subjects.map((s) => `- ${s.id} · ${s.name} · ${s.kind} · ${s.currentPeriodsPerWeek}`).join("\n")}`;
  return { system, userMessage };
}

/**
 * Keep only what is usable: known subject ids, numbers in range, totals
 * within capacity (scaled down proportionally if the model overshoots).
 * Null when nothing usable came back.
 */
export function parseTimetableRulesSuggestion(
  text: string,
  facts: Pick<TimetableRulesFacts, "subjects" | "weeklyCapacity">,
  classId: string,
): TimetableRulesSuggestion[] | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const list = (raw as { subjects?: unknown })?.subjects;
  if (!Array.isArray(list)) return null;
  const known = new Set(facts.subjects.map((s) => s.id));
  const seen = new Set<string>();
  const out: TimetableRulesSuggestion[] = [];
  for (const item of list) {
    const r = item as Record<string, unknown>;
    const id = String(r.id ?? "");
    if (!known.has(id) || seen.has(id)) continue;
    seen.add(id);
    const ppw = Math.max(0, Math.min(15, Math.round(Number(r.periodsPerWeek) || 0)));
    const tod: TimeOfDay = r.timeOfDay === "morning" || r.timeOfDay === "after_break" ? r.timeOfDay : "any";
    const rule = normalizeSubjectRule({
      classId,
      subjectId: id,
      doublesPerWeek: Math.min(Math.floor(ppw / 2), Number(r.doublesPerWeek) || 0),
      timeOfDay: tod,
      maxPerDay: Number(r.maxPerDay) || 1,
      avoidFirstPeriod: r.avoidFirstPeriod === true,
      avoidLastPeriod: r.avoidLastPeriod === true,
      avoidAfterLunch: r.avoidAfterLunch === true,
    });
    if (!rule) continue;
    out.push({ subjectId: id, periodsPerWeek: ppw, rule, why: String(r.why ?? "").trim().slice(0, 160) });
  }
  if (!out.length) return null;
  const total = out.reduce((n, s) => n + s.periodsPerWeek, 0);
  if (facts.weeklyCapacity > 0 && total > facts.weeklyCapacity) {
    // Over the week: scale down, never below 1 for a subject that had any.
    const k = facts.weeklyCapacity / total;
    for (const s of out) {
      s.periodsPerWeek = s.periodsPerWeek > 0 ? Math.max(1, Math.floor(s.periodsPerWeek * k)) : 0;
      s.rule = { ...s.rule, doublesPerWeek: Math.min(s.rule.doublesPerWeek, Math.floor(s.periodsPerWeek / 2)) };
    }
  }
  return out;
}
