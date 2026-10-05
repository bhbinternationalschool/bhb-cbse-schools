"use client";
// ratchet-allow: grids_without_row_menu — settings editors (bell rows, class
// switches, per-subject rules); each row is a form, not a record.

/**
 * Timetable setup added on 5 Oct 2026 (director):
 *  - PrePrimaryBellPanel   — a separate bell timing for Nursery–UKG (or any
 *                            classes picked);
 *  - ClassTeacherAllPanel  — classes whose class teacher takes every subject
 *                            unless a specialist is linked;
 *  - SubjectRulesPanel     — per class subject: periods/week, double periods,
 *                            time of day, most a day, periods to avoid — with
 *                            an AI suggestion the office reviews and saves.
 */

import { useMemo, useState } from "react";
import {
  bellForClass,
  classTeacherTakesAll,
  setClassTeacherAllClassIds,
  setExtraBellTemplates,
  setSubjectRulesForClass,
  teachingPeriods,
  type BellPeriod,
  type ExtraBellTemplate,
  type TimetableState,
} from "@/lib/timetable";
import { classGroupCodeForName, saveMasters, type MastersState } from "@/lib/masters";
import { classTeachersOf, isPrePrimaryClass } from "@/lib/timetableSolver";
import { bellFacts, effectiveSubjectRule, toMinutes, type TimeOfDay, type TimetableSubjectRule } from "@/lib/timetableRules";
import type { TimetableRulesSuggestion } from "@/lib/timetableRulesAi";
import { reportAiOutcome } from "@/lib/aiOutcomeClient";

type Common = {
  masters: MastersState;
  state: TimetableState;
  ay: string;
  canEdit: boolean;
  onSaved: () => void;
  flash: (msg: string) => void;
};

const inp = "rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-sm";
const card = "rounded-xl border border-[var(--border)] bg-[var(--card)] p-4";

function activeClasses(masters: MastersState) {
  return masters.classes.filter((c) => c.isActive !== false).sort((a, b) => a.sortOrder - b.sortOrder);
}

function groupOf(masters: MastersState, classId: string) {
  const c = masters.classes.find((x) => x.id === classId);
  return c?.groupCode ?? classGroupCodeForName(c?.name ?? "");
}

// ── 1. Pre-primary bell timing ──

export function PrePrimaryBellPanel({ masters, state, canEdit, onSaved, flash }: Common) {
  const classes = activeClasses(masters);
  const [draft, setDraft] = useState<ExtraBellTemplate[]>(() => state.extraBellTemplates ?? []);
  const t = draft[0] ?? null;

  function create() {
    const pre = classes.filter((c) => isPrePrimaryClass(masters, c.id)).map((c) => c.id);
    setDraft([
      {
        id: `bell_${Date.now().toString(36)}`,
        name: "Nursery–UKG timing",
        classIds: pre,
        periods: state.bellTemplate.map((p) => ({ ...p })),
      },
    ]);
  }
  function patchPeriod(i: number, patch: Partial<BellPeriod>) {
    if (!t) return;
    setDraft([{ ...t, periods: t.periods.map((p, j) => (j === i ? { ...p, ...patch } : p)) }]);
  }
  function save() {
    const r = setExtraBellTemplates(draft);
    if (!r.ok) {
      flash(r.error);
      return;
    }
    flash(draft.length ? "Separate timing saved" : "Separate timing removed — all classes use the main bell");
    onSaved();
  }

  return (
    <div className={card}>
      <h2 className="text-sm font-bold text-[var(--brand-deep)]">Separate timing for some classes</h2>
      <p className="mt-1 text-[12px] text-[var(--muted)]">
        Nursery, LKG and UKG can keep their own bell (shorter periods, earlier home time). Their period numbers then
        run on this timing; a teacher who also teaches older classes is checked by clock time, so they are never
        booked in two rooms at once.
      </p>
      {!t ? (
        canEdit ? (
          <button type="button" className="mt-3 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-semibold" onClick={create}>
            Create a separate timing for Nursery–UKG
          </button>
        ) : (
          <p className="mt-2 text-sm text-[var(--muted)]">All classes use the main bell.</p>
        )
      ) : (
        <div className="mt-3 space-y-3">
          <label className="block text-xs font-semibold text-[var(--muted)]">
            Name
            <input className={`${inp} mt-1 w-full max-w-xs`} disabled={!canEdit} value={t.name} onChange={(e) => setDraft([{ ...t, name: e.target.value }])} />
          </label>
          <div>
            <p className="text-xs font-semibold text-[var(--muted)]">Classes on this timing</p>
            <div className="mt-1 flex flex-wrap gap-3">
              {classes.map((c) => (
                <label key={c.id} className="inline-flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    disabled={!canEdit}
                    checked={t.classIds.includes(c.id)}
                    onChange={(e) =>
                      setDraft([
                        {
                          ...t,
                          classIds: e.target.checked ? [...t.classIds, c.id] : t.classIds.filter((x) => x !== c.id),
                        },
                      ])
                    }
                  />
                  {c.name}
                </label>
              ))}
            </div>
          </div>
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase text-[var(--muted)]">
              <tr>
                <th className="py-1 text-left">Label</th>
                <th className="py-1 text-left">Kind</th>
                <th className="py-1 text-left">Start</th>
                <th className="py-1 text-left">End</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {t.periods
                .map((p, i) => ({ p, i }))
                .sort((a, b) => toMinutes(a.p.startTime) - toMinutes(b.p.startTime))
                .map(({ p, i }) => (
                  <tr key={i}>
                    <td className="py-1 pr-2">
                      <input className={`${inp} w-32`} disabled={!canEdit} value={p.label} onChange={(e) => patchPeriod(i, { label: e.target.value })} />
                    </td>
                    <td className="py-1 pr-2">
                      <select
                        className={inp}
                        disabled={!canEdit}
                        value={p.kind}
                        onChange={(e) => patchPeriod(i, { kind: e.target.value as BellPeriod["kind"] })}
                      >
                        <option value="teaching">Teaching</option>
                        <option value="break">Break</option>
                        <option value="assembly">Assembly</option>
                      </select>
                    </td>
                    <td className="py-1 pr-2">
                      <input type="time" className={inp} disabled={!canEdit} value={p.startTime} onChange={(e) => patchPeriod(i, { startTime: e.target.value })} />
                    </td>
                    <td className="py-1 pr-2">
                      <input type="time" className={inp} disabled={!canEdit} value={p.endTime} onChange={(e) => patchPeriod(i, { endTime: e.target.value })} />
                    </td>
                    <td className="py-1 text-right">
                      {canEdit ? (
                        <button
                          type="button"
                          className="text-xs text-[var(--danger)] underline"
                          onClick={() => setDraft([{ ...t, periods: t.periods.filter((_, j) => j !== i) }])}
                        >
                          Remove
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          {canEdit ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm"
                onClick={() => {
                  const teach = t.periods.filter((p) => p.kind === "teaching");
                  const nextNo = Math.max(0, ...teach.map((p) => p.no)) + 1;
                  const last = [...t.periods].sort((a, b) => toMinutes(b.endTime) - toMinutes(a.endTime))[0];
                  setDraft([
                    {
                      ...t,
                      periods: [
                        ...t.periods,
                        {
                          no: nextNo,
                          label: `Period ${teach.length + 1}`,
                          startTime: last?.endTime || "09:00",
                          endTime: last?.endTime || "09:30",
                          kind: "teaching",
                        },
                      ],
                    },
                  ]);
                }}
              >
                Add period
              </button>
              <button type="button" className="rounded-lg bg-[var(--brand-deep)] px-3 py-1.5 text-sm font-semibold text-white" onClick={save}>
                Save timing
              </button>
              <button type="button" className="rounded-lg px-3 py-1.5 text-sm text-[var(--danger)] underline" onClick={() => setDraft([])}>
                Remove separate timing
              </button>
            </div>
          ) : null}
          <p className="text-[11px] text-[var(--muted)]">
            After changing a timing, run Auto-assign again for those classes: their period numbers now mean these times.
          </p>
        </div>
      )}
    </div>
  );
}

// ── 2. Class teacher takes all subjects ──

export function ClassTeacherAllPanel({ masters, state, ay, canEdit, onSaved, flash }: Common) {
  const classes = activeClasses(masters);
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(classes.filter((c) => classTeacherTakesAll(state, c.id, groupOf(masters, c.id))).map((c) => c.id)),
  );
  return (
    <div className={card}>
      <h2 className="text-sm font-bold text-[var(--brand-deep)]">Class teacher takes all subjects</h2>
      <p className="mt-1 text-[12px] text-[var(--muted)]">
        Ticked classes: the class teacher teaches every subject, with no ticking per subject. A subject that has its own
        teacher linked for that class (e.g. PE, music) goes to that specialist instead. Nursery–UKG are ticked unless you
        change it.
      </p>
      <ul className="mt-3 divide-y divide-[var(--border)]">
        {classes.map((c) => {
          const secs = masters.sections.filter((s) => s.classId === c.id && s.isActive !== false);
          return (
            <li key={c.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <label className="inline-flex w-28 items-center gap-2 font-semibold">
                <input
                  type="checkbox"
                  disabled={!canEdit}
                  checked={checked.has(c.id)}
                  onChange={(e) => {
                    const next = new Set(checked);
                    if (e.target.checked) next.add(c.id);
                    else next.delete(c.id);
                    setChecked(next);
                  }}
                />
                {c.name}
              </label>
              {checked.has(c.id) ? (
                <span className="flex flex-wrap gap-2 text-xs">
                  {secs.map((s) => {
                    const ct = classTeachersOf(masters, c.id, s.id, ay)[0];
                    return (
                      <span
                        key={s.id}
                        className={`rounded-md px-2 py-0.5 ${ct ? "bg-[var(--surface-sunken)]" : "bg-[var(--warning-soft)] text-[var(--warning)]"}`}
                      >
                        {c.name}-{s.name}: {ct ? ct.fullName : "no class teacher set (Masters → Section teachers)"}
                      </span>
                    );
                  })}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      {canEdit ? (
        <button
          type="button"
          className="mt-3 rounded-lg bg-[var(--brand-deep)] px-3 py-1.5 text-sm font-semibold text-white"
          onClick={() => {
            setClassTeacherAllClassIds([...checked]);
            flash("Saved — run Auto-assign to apply");
            onSaved();
          }}
        >
          Save
        </button>
      ) : null}
    </div>
  );
}

// ── 3. Subject rules, with AI suggestion ──

type Row = {
  subjectId: string;
  name: string;
  kind: "scholastic" | "co-scholastic";
  linkId: string;
  periods: number;
  rule: TimetableSubjectRule;
  why?: string;
  aiChanged?: boolean;
};

export function SubjectRulesPanel({ masters, state, canEdit, onSaved, flash }: Common) {
  const classes = activeClasses(masters);
  const [classId, setClassId] = useState(classes[0]?.id ?? "");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [ai, setAi] = useState<{ generationId: string } | null>(null);

  const preprimary = classId ? isPrePrimaryClass(masters, classId) : false;
  const facts = useMemo(() => bellFacts(bellForClass(state, classId)), [state, classId]);
  const days = state.workingWeekdays.length || 6;
  const capacity = facts.order.length * days;

  const baseRows = useMemo<Row[]>(() => {
    const subjectById = new Map((masters.subjects ?? []).map((s) => [s.id, s]));
    return (masters.classSubjects ?? [])
      .filter((l) => l.classId === classId && l.isActive !== false)
      .map((l) => {
        const s = subjectById.get(l.subjectId);
        const like = {
          id: l.subjectId,
          code: s?.code ?? "",
          nameEn: s?.nameEn ?? "",
          category: s?.category,
          coScholasticArea: (s as { coScholasticArea?: string } | undefined)?.coScholasticArea,
        };
        return {
          subjectId: l.subjectId,
          name: s?.nameEn || s?.code || l.subjectId,
          kind: s?.category === "co_scholastic" ? ("co-scholastic" as const) : ("scholastic" as const),
          linkId: (l as { id?: string }).id ?? "",
          periods: l.periodsPerWeek,
          rule: effectiveSubjectRule(state.subjectRules ?? [], classId, like, l.periodsPerWeek, preprimary),
        };
      })
      .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "scholastic" ? -1 : 1));
  }, [masters, state.subjectRules, classId, preprimary]);

  const view = rows ?? baseRows;
  const total = view.reduce((n, r) => n + r.periods, 0);
  const patch = (i: number, p: Partial<Row>, rp: Partial<TimetableSubjectRule> = {}) =>
    setRows(view.map((r, j) => (j === i ? { ...r, ...p, rule: { ...r.rule, ...rp } } : r)));

  async function suggest() {
    setBusy(true);
    const minutes = facts.order.length
      ? Math.round(
          [...facts.interval.values()].reduce((n, [a, b]) => n + (b - a), 0) / facts.order.length,
        )
      : 0;
    const cls = masters.classes.find((c) => c.id === classId);
    const res = await fetch("/api/ai/timetable-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        classId,
        facts: {
          className: cls?.name ?? "",
          stage: preprimary
            ? "pre-primary (Nursery–UKG, NCF foundational stage)"
            : String(groupOf(masters, classId) || "").toLowerCase(),
          weeklyCapacity: capacity,
          periodsPerDay: facts.order.length,
          periodMinutes: minutes,
          subjects: view.map((r) => ({ id: r.subjectId, name: r.name, kind: r.kind, currentPeriodsPerWeek: r.periods })),
        },
      }),
    }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as {
      ok?: boolean;
      // A plain string from the route, or {code, message} from apiErr.
      error?: string | { message?: string };
      generationId?: string;
      suggestions?: TimetableRulesSuggestion[];
    } | null;
    setBusy(false);
    if (!res?.ok || !body?.ok || !body.suggestions) {
      const err = typeof body?.error === "string" ? body.error : body?.error?.message;
      flash(err || "AI suggestion failed — try again");
      return;
    }
    const bySub = new Map(body.suggestions.map((s) => [s.subjectId, s]));
    setRows(
      view.map((r) => {
        const s = bySub.get(r.subjectId);
        return s ? { ...r, periods: s.periodsPerWeek, rule: { ...s.rule, classId }, why: s.why, aiChanged: true } : r;
      }),
    );
    setAi(body.generationId ? { generationId: body.generationId } : null);
    flash("AI suggestion loaded — review the highlighted rows, change anything, then Save");
  }

  async function save() {
    const current = rows;
    if (!current) return;
    setSubjectRulesForClass(classId, current.map((r) => r.rule));
    const changedPeriods = current.filter((r) => baseRows.find((b) => b.subjectId === r.subjectId)?.periods !== r.periods);
    if (changedPeriods.length) {
      const next = {
        ...masters,
        classSubjects: (masters.classSubjects ?? []).map((l) => {
          const r = changedPeriods.find((x) => x.subjectId === l.subjectId && l.classId === classId);
          return r ? { ...l, periodsPerWeek: r.periods } : l;
        }),
      };
      const out = await saveMasters(next);
      if (!out.ok) {
        flash("Rules saved, but periods/week could not be saved to Masters (needs Masters edit permission).");
        onSaved();
        return;
      }
    }
    if (ai) {
      const edited = current.some((r) => r.aiChanged === false);
      reportAiOutcome({ ids: [ai.generationId], outcome: edited ? "edited" : "accepted", targetType: "timetable_rules", targetId: classId });
      setAi(null);
    }
    setRows(null);
    flash("Subject rules saved — run Auto-assign to apply");
    onSaved();
  }

  return (
    <div className={card}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-[var(--brand-deep)]">Subject rules</h2>
          <p className="mt-1 text-[12px] text-[var(--muted)]">
            How Auto-assign places each subject. Defaults come from the subject&apos;s kind in Masters: core subjects in
            the morning, co-scholastic after the break, art and games as double periods, PE never first or straight
            after lunch.
          </p>
        </div>
        <label className="text-xs font-semibold text-[var(--muted)]">
          Class
          <select
            className={`${inp} mt-1 block`}
            value={classId}
            onChange={(e) => {
              setClassId(e.target.value);
              setRows(null);
              if (ai) reportAiOutcome({ ids: [ai.generationId], outcome: "rejected", targetType: "timetable_rules", targetId: classId });
              setAi(null);
            }}
          >
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className={`mt-2 text-xs ${total > capacity ? "font-semibold text-[var(--danger)]" : "text-[var(--muted)]"}`}>
        {total} periods a week asked · {capacity} available ({facts.order.length} a day × {days} days
        {bellForClass(state, classId) !== state.bellTemplate ? ", separate timing" : ""})
        {total > capacity ? " — reduce some subjects" : ""}
      </p>
      {view.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--muted)]">This class has no subjects linked yet — add them in Masters → Subjects.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="text-[11px] uppercase text-[var(--muted)]">
              <tr>
                <th className="py-1 text-left">Subject</th>
                <th className="py-1 text-left">Periods / wk</th>
                <th className="py-1 text-left">Doubles / wk</th>
                <th className="py-1 text-left">Time of day</th>
                <th className="py-1 text-left">Most a day</th>
                <th className="py-1 text-left">Never in</th>
              </tr>
            </thead>
            <tbody>
              {view.map((r, i) => (
                <tr key={r.subjectId} className={`border-t border-[var(--border)] ${r.aiChanged ? "bg-[var(--info-soft)]" : ""}`}>
                  <td className="py-1.5 pr-2">
                    <div className="font-medium text-[var(--brand-deep)]">{r.name}</div>
                    <div className="text-[10px] text-[var(--muted)]">
                      {r.kind}
                      {r.why ? ` · AI: ${r.why}` : ""}
                    </div>
                  </td>
                  <td className="py-1.5 pr-2">
                    <input
                      type="number"
                      min={0}
                      max={20}
                      className={`${inp} w-16`}
                      disabled={!canEdit}
                      value={r.periods}
                      onChange={(e) => patch(i, { periods: Math.max(0, Math.min(20, Number(e.target.value) || 0)), aiChanged: r.aiChanged ? false : undefined })}
                    />
                  </td>
                  <td className="py-1.5 pr-2">
                    <input
                      type="number"
                      min={0}
                      max={5}
                      className={`${inp} w-14`}
                      disabled={!canEdit}
                      value={r.rule.doublesPerWeek}
                      onChange={(e) =>
                        patch(i, { aiChanged: r.aiChanged ? false : undefined }, { doublesPerWeek: Math.max(0, Math.min(5, Number(e.target.value) || 0)) })
                      }
                    />
                  </td>
                  <td className="py-1.5 pr-2">
                    <select
                      className={inp}
                      disabled={!canEdit}
                      value={r.rule.timeOfDay}
                      onChange={(e) => patch(i, { aiChanged: r.aiChanged ? false : undefined }, { timeOfDay: e.target.value as TimeOfDay })}
                    >
                      <option value="morning">Morning</option>
                      <option value="after_break">After break</option>
                      <option value="any">Any time</option>
                    </select>
                  </td>
                  <td className="py-1.5 pr-2">
                    <select
                      className={inp}
                      disabled={!canEdit}
                      value={r.rule.maxPerDay}
                      onChange={(e) => patch(i, { aiChanged: r.aiChanged ? false : undefined }, { maxPerDay: Number(e.target.value) })}
                    >
                      {[1, 2, 3].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1.5 text-xs">
                    {(
                      [
                        ["avoidFirstPeriod", "First"],
                        ["avoidLastPeriod", "Last"],
                        ["avoidAfterLunch", "After lunch"],
                      ] as const
                    ).map(([k, label]) => (
                      <label key={k} className="mr-2 inline-flex items-center gap-1">
                        <input
                          type="checkbox"
                          disabled={!canEdit}
                          checked={r.rule[k]}
                          onChange={(e) => patch(i, { aiChanged: r.aiChanged ? false : undefined }, { [k]: e.target.checked })}
                        />
                        {label}
                      </label>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canEdit && view.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-semibold text-[var(--brand-deep)] disabled:opacity-50"
            onClick={() => void suggest()}
          >
            {busy ? "Asking AI…" : "Suggest with AI"}
          </button>
          <button
            type="button"
            disabled={!rows}
            className="rounded-lg bg-[var(--brand-deep)] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
            onClick={() => void save()}
          >
            Save rules
          </button>
          {rows ? (
            <button
              type="button"
              className="rounded-lg px-3 py-1.5 text-sm underline"
              onClick={() => {
                if (ai) reportAiOutcome({ ids: [ai.generationId], outcome: "rejected", targetType: "timetable_rules", targetId: classId });
                setAi(null);
                setRows(null);
              }}
            >
              Discard changes
            </button>
          ) : null}
        </div>
      ) : null}
      <p className="mt-2 text-[11px] text-[var(--muted)]">
        Teaching periods in this class&apos;s day: {teachingPeriods(bellForClass(state, classId)).length}. AI only
        suggests — nothing changes until you press Save, and Auto-assign still checks every clash.
      </p>
    </div>
  );
}
