"use client";

import { useMemo, useState } from "react";
import { Layers, Plus, Trash2 } from "lucide-react";
import {
  saveExamPolicy,
  type ExamPolicy,
  type ExamTerm,
} from "@/lib/exams";
import {
  CBSE_CO_SCHOLASTIC_AREAS,
  componentsTotalMax,
  displayModeLabel,
  gradeBandsForPreset,
  gradeScaleLabel,
  promotionRuleLabel,
  SCHEME_PRESETS,
  schemeFromPreset,
  schemeSummary,
  type AssessmentScheme,
  type DisplayMode,
  type GradeScalePreset,
  type PromotionRule,
} from "@/lib/examSchemes";
import { CLASS_GROUPS, type MastersState } from "@/lib/masters";

/**
 * Assessment schemes — the school decides how each class band is assessed.
 *
 * Everything CBSE / NEP leave to the school is a setting here: the grade
 * scale and its cut-offs, whether the card prints marks or only grades or
 * descriptors, the split of a subject into components (80 + 20, theory +
 * practical) and whether each must be passed separately, the promotion
 * rule (no detention, re-examination, detain), rank and class average on
 * the card, the co-scholastic areas, and which exams the band sits. The
 * CBSE presets fill a scheme in one click; every field stays editable.
 */
export function AssessmentSchemesPanel({
  policy,
  masters,
  terms,
  onSaved,
  onFlash,
  onError,
}: {
  policy: ExamPolicy;
  masters: MastersState | null;
  terms: ExamTerm[];
  onSaved: () => void;
  onFlash: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [draft, setDraft] = useState<AssessmentScheme | null>(null);
  const [presetKey, setPresetKey] = useState(SCHEME_PRESETS[0]!.key);

  const classes = useMemo(() => {
    const list = (masters?.classes ?? []).filter((c) => c.isActive !== false);
    return [...list].sort((a, b) => a.sortOrder - b.sortOrder);
  }, [masters]);
  const classNameById = useMemo(
    () => new Map(classes.map((c) => [c.id, c.name])),
    [classes],
  );
  const assignedElsewhere = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of policy.schemes) {
      if (s.isDefault || (draft && s.id === draft.id)) continue;
      for (const c of s.classIds) m.set(c, s.name);
    }
    return m;
  }, [policy.schemes, draft]);

  function persist(next: AssessmentScheme[], done: string) {
    const r = saveExamPolicy({ schemes: next });
    if (!r.ok) {
      onError(r.error);
      return;
    }
    setDraft(null);
    onSaved();
    onFlash(done);
  }

  function addFromPreset() {
    const preset = SCHEME_PRESETS.find((p) => p.key === presetKey);
    if (!preset) return;
    // Suggest the band's classes that no other scheme has claimed yet.
    const band = CLASS_GROUPS.find((g) => g.code === preset.band);
    const names = new Set(band?.classNames ?? []);
    const claimed = new Set(
      policy.schemes.filter((s) => !s.isDefault).flatMap((s) => s.classIds),
    );
    const classIds = classes
      .filter((c) => names.has(c.name) && !claimed.has(c.id))
      .map((c) => c.id);
    setDraft(schemeFromPreset(preset, policy.passPercent, classIds));
  }

  function remove(scheme: AssessmentScheme) {
    if (scheme.isDefault) return;
    if (
      !window.confirm(
        `Remove the scheme "${scheme.name}"? Its classes go back to the school default. Marks already entered are kept.`,
      )
    ) {
      return;
    }
    persist(
      policy.schemes.filter((s) => s.id !== scheme.id),
      `Removed ${scheme.name}`,
    );
  }

  function save() {
    if (!draft) return;
    if (!draft.name.trim()) {
      onError("Give the scheme a name");
      return;
    }
    if (!draft.isDefault && draft.classIds.length === 0) {
      onError("Tick at least one class for this scheme, or remove it");
      return;
    }
    const exists = policy.schemes.some((s) => s.id === draft.id);
    const next = exists
      ? policy.schemes.map((s) => (s.id === draft.id ? draft : s))
      : [...policy.schemes, draft];
    persist(next, `Saved ${draft.name}`);
  }

  const set = <K extends keyof AssessmentScheme>(key: K, value: AssessmentScheme[K]) =>
    setDraft((d) => (d ? { ...d, [key]: value } : d));

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 lg:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold text-[var(--brand-deep)]">
            <Layers className="size-4" aria-hidden />
            Assessment schemes
          </h2>
          <p className="mt-1 max-w-2xl text-xs text-[var(--muted)]">
            How each class band is assessed — grade scale, marks or grades or
            descriptors, subject components (80 + 20, theory + practical),
            pass and promotion rules, co-scholastic areas. Classes not named
            in any scheme follow the school default.
          </p>
        </div>
        {!draft ? (
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="field !py-1.5 text-xs"
              value={presetKey}
              onChange={(e) => setPresetKey(e.target.value)}
              aria-label="CBSE preset"
            >
              {SCHEME_PRESETS.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn-accent inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold"
              onClick={addFromPreset}
            >
              <Plus className="size-3.5" aria-hidden />
              Add from preset
            </button>
          </div>
        ) : null}
      </div>

      {!draft ? (
        <ul className="mt-4 divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
          {policy.schemes.map((s) => (
            <li key={s.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="font-semibold text-[var(--brand-deep)]">
                  {s.name}
                  {s.isDefault ? (
                    <span className="ml-2 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--muted)] ring-1 ring-[var(--border)]">
                      default
                    </span>
                  ) : null}
                </p>
                <p className="mt-0.5 text-xs text-[var(--muted)]">
                  {s.isDefault
                    ? "Every class not named in another scheme"
                    : s.classIds.map((id) => classNameById.get(id) ?? id).join(", ") || "No classes"}
                </p>
                <p className="mt-0.5 text-xs text-[var(--muted)]">{schemeSummary(s)}</p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs font-semibold"
                  onClick={() => setDraft(s)}
                >
                  Edit
                </button>
                {!s.isDefault ? (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs font-semibold text-[var(--danger)]"
                    onClick={() => remove(s)}
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                    Remove
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <SchemeEditor
          draft={draft}
          set={set}
          setDraft={setDraft}
          classes={classes}
          assignedElsewhere={assignedElsewhere}
          terms={terms}
          policyPass={policy.passPercent}
          onCancel={() => setDraft(null)}
          onSave={save}
        />
      )}
    </section>
  );
}

const SCALES: GradeScalePreset[] = ["cbse8", "five", "three", "custom"];
const MODES: DisplayMode[] = ["marks_grade", "grade_only", "descriptors"];
const RULES: PromotionRule[] = ["no_detention", "reexam_then_detain", "detain_on_fail"];

function SchemeEditor({
  draft,
  set,
  setDraft,
  classes,
  assignedElsewhere,
  terms,
  policyPass,
  onCancel,
  onSave,
}: {
  draft: AssessmentScheme;
  set: <K extends keyof AssessmentScheme>(key: K, value: AssessmentScheme[K]) => void;
  setDraft: (d: AssessmentScheme | null) => void;
  classes: MastersState["classes"];
  assignedElsewhere: Map<string, string>;
  terms: ExamTerm[];
  policyPass: number;
  onCancel: () => void;
  onSave: () => void;
}) {
  const label = "mb-1 block text-[11px] text-[var(--muted)]";
  const box = "rounded-lg border border-[var(--border)] p-3";
  const total = componentsTotalMax(draft.components);

  return (
    <div className="mt-4 space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className={label}>Scheme name</span>
          <input
            className="field !py-1.5"
            value={draft.name}
            onChange={(e) => set("name", e.target.value)}
            maxLength={60}
          />
        </label>
        <label className="block text-sm">
          <span className={label}>Note (printed nowhere; for the office)</span>
          <input
            className="field !py-1.5"
            value={draft.note}
            onChange={(e) => set("note", e.target.value)}
            maxLength={400}
          />
        </label>
      </div>

      <div className={box}>
        <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">Classes</p>
        {draft.isDefault ? (
          <p className="mt-1 text-xs text-[var(--muted)]">
            The default scheme covers every class not ticked in another scheme.
          </p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2">
            {classes.map((c) => {
              const taken = assignedElsewhere.get(c.id);
              const on = draft.classIds.includes(c.id);
              return (
                <label
                  key={c.id}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs ${
                    on ? "border-[var(--brand-deep)] bg-[var(--surface-sunken)]" : "border-[var(--border)]"
                  } ${taken ? "opacity-50" : ""}`}
                  title={taken ? `Assessed under ${taken}` : ""}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={!!taken}
                    onChange={(e) =>
                      set(
                        "classIds",
                        e.target.checked
                          ? [...draft.classIds, c.id]
                          : draft.classIds.filter((x) => x !== c.id),
                      )
                    }
                  />
                  {c.name}
                </label>
              );
            })}
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-sm">
          <span className={label}>Grade scale</span>
          <select
            className="field !py-1.5"
            value={draft.gradeScale}
            onChange={(e) => {
              const scale = e.target.value as GradeScalePreset;
              setDraft({
                ...draft,
                gradeScale: scale,
                gradeBands: gradeBandsForPreset(scale, draft.passPercent ?? policyPass),
              });
            }}
          >
            {SCALES.map((s) => (
              <option key={s} value={s}>
                {gradeScaleLabel(s)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className={label}>Report card shows</span>
          <select
            className="field !py-1.5"
            value={draft.displayMode}
            onChange={(e) => set("displayMode", e.target.value as DisplayMode)}
          >
            {MODES.map((m) => (
              <option key={m} value={m}>
                {displayModeLabel(m)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className={label}>Pass % (blank = school policy {policyPass}%)</span>
          <input
            className="field !py-1.5"
            inputMode="numeric"
            value={draft.passPercent ?? ""}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, "");
              set("passPercent", v ? Math.min(100, Math.max(1, Number(v))) : null);
            }}
            placeholder={String(policyPass)}
          />
        </label>
      </div>

      <div className={box}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">
            Grade bands (highest first · the last band is the failing one)
          </p>
          <button
            type="button"
            className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs font-semibold"
            onClick={() =>
              set("gradeBands", [
                ...draft.gradeBands.slice(0, -1),
                { grade: "", minPercent: 0, label: "" },
                draft.gradeBands[draft.gradeBands.length - 1]!,
              ])
            }
          >
            Add band
          </button>
        </div>
        <div className="mt-2 space-y-1.5">
          {draft.gradeBands.map((b, i) => (
            <div key={i} className="grid grid-cols-[5rem_5rem_1fr_auto] items-center gap-2 text-sm">
              <input
                className="field !py-1 text-center"
                value={b.grade}
                placeholder="A1"
                maxLength={12}
                onChange={(e) =>
                  set(
                    "gradeBands",
                    draft.gradeBands.map((x, j) => (j === i ? { ...x, grade: e.target.value } : x)),
                  )
                }
                aria-label={`Band ${i + 1} grade`}
              />
              <input
                className="field !py-1 text-center tabular-nums"
                inputMode="numeric"
                value={b.minPercent}
                disabled={i === draft.gradeBands.length - 1}
                onChange={(e) =>
                  set(
                    "gradeBands",
                    draft.gradeBands.map((x, j) =>
                      j === i ? { ...x, minPercent: Number(e.target.value.replace(/\D/g, "") || 0) } : x,
                    ),
                  )
                }
                aria-label={`Band ${i + 1} minimum percent`}
              />
              <input
                className="field !py-1"
                value={b.label}
                placeholder="Label on descriptor cards"
                maxLength={60}
                onChange={(e) =>
                  set(
                    "gradeBands",
                    draft.gradeBands.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)),
                  )
                }
                aria-label={`Band ${i + 1} label`}
              />
              <button
                type="button"
                className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs"
                disabled={draft.gradeBands.length <= 2}
                onClick={() => set("gradeBands", draft.gradeBands.filter((_, j) => j !== i))}
                aria-label={`Remove band ${i + 1}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className={box}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">
            Subject components{" "}
            <span className="font-normal normal-case">
              — none = one mark per subject out of the exam&apos;s maximum
              {total > 0 ? ` · total ${total}` : ""}
            </span>
          </p>
          <div className="flex gap-2">
            <select
              className="field !py-1 text-xs"
              value={draft.componentsApplyTo}
              onChange={(e) => set("componentsApplyTo", e.target.value as "term_exams" | "all")}
              aria-label="Components apply to"
            >
              <option value="term_exams">Term exams only (unit tests stay single-mark)</option>
              <option value="all">Every exam</option>
            </select>
            <button
              type="button"
              className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs font-semibold"
              onClick={() =>
                set("components", [
                  ...draft.components,
                  { code: "", label: "", maxMarks: 0, kind: "internal" },
                ])
              }
            >
              Add component
            </button>
          </div>
        </div>
        {draft.components.length > 0 ? (
          <div className="mt-2 space-y-1.5">
            {draft.components.map((c, i) => (
              <div key={i} className="grid grid-cols-[5rem_1fr_5rem_8rem_auto] items-center gap-2 text-sm">
                <input
                  className="field !py-1 uppercase"
                  value={c.code}
                  placeholder="TE"
                  maxLength={8}
                  onChange={(e) =>
                    set(
                      "components",
                      draft.components.map((x, j) =>
                        j === i ? { ...x, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") } : x,
                      ),
                    )
                  }
                  aria-label={`Component ${i + 1} code`}
                />
                <input
                  className="field !py-1"
                  value={c.label}
                  placeholder="Term exam"
                  maxLength={40}
                  onChange={(e) =>
                    set(
                      "components",
                      draft.components.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)),
                    )
                  }
                  aria-label={`Component ${i + 1} label`}
                />
                <input
                  className="field !py-1 text-center tabular-nums"
                  inputMode="numeric"
                  value={c.maxMarks || ""}
                  placeholder="80"
                  onChange={(e) =>
                    set(
                      "components",
                      draft.components.map((x, j) =>
                        j === i ? { ...x, maxMarks: Number(e.target.value.replace(/\D/g, "") || 0) } : x,
                      ),
                    )
                  }
                  aria-label={`Component ${i + 1} max marks`}
                />
                <select
                  className="field !py-1 text-xs"
                  value={c.kind}
                  onChange={(e) =>
                    set(
                      "components",
                      draft.components.map((x, j) =>
                        j === i ? { ...x, kind: e.target.value as "exam" | "internal" } : x,
                      ),
                    )
                  }
                  aria-label={`Component ${i + 1} kind`}
                >
                  <option value="exam">Written exam</option>
                  <option value="internal">Internal assessment</option>
                </select>
                <button
                  type="button"
                  className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs"
                  onClick={() => set("components", draft.components.filter((_, j) => j !== i))}
                  aria-label={`Remove component ${i + 1}`}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <label className="mt-2 flex items-center gap-2 text-sm text-[var(--brand-deep)]">
          <input
            type="checkbox"
            checked={draft.passEachComponent}
            onChange={(e) => set("passEachComponent", e.target.checked)}
            disabled={draft.components.length === 0}
          />
          Each component must be passed separately (CBSE XI–XII: theory and practical)
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className={label}>Promotion rule</span>
          <select
            className="field !py-1.5"
            value={draft.promotionRule}
            onChange={(e) => set("promotionRule", e.target.value as PromotionRule)}
          >
            {RULES.map((r) => (
              <option key={r} value={r}>
                {promotionRuleLabel(r)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className={label}>A subject below pass fails the student</span>
          <select
            className="field !py-1.5"
            value={draft.requireAllSubjectsPass == null ? "policy" : draft.requireAllSubjectsPass ? "yes" : "no"}
            onChange={(e) =>
              set(
                "requireAllSubjectsPass",
                e.target.value === "policy" ? null : e.target.value === "yes",
              )
            }
          >
            <option value="policy">As the school policy says</option>
            <option value="yes">Yes — every subject must pass</option>
            <option value="no">No — the aggregate decides</option>
          </select>
        </label>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <label className="flex items-center gap-2 text-sm text-[var(--brand-deep)]">
          <input type="checkbox" checked={draft.showRank} onChange={(e) => set("showRank", e.target.checked)} />
          Print rank in class
        </label>
        <label className="flex items-center gap-2 text-sm text-[var(--brand-deep)]">
          <input
            type="checkbox"
            checked={draft.showClassAverage}
            onChange={(e) => set("showClassAverage", e.target.checked)}
          />
          Print class average
        </label>
        <label className="flex items-center gap-2 text-sm text-[var(--brand-deep)]">
          <input
            type="checkbox"
            checked={draft.showResultOnCard}
            onChange={(e) => set("showResultOnCard", e.target.checked)}
          />
          Print the result (promoted / detained) once decided
        </label>
      </div>

      <div className={box}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">
            Co-scholastic areas (rated A / B / C){" "}
            <span className="font-normal normal-case">— none = the school-wide NEP switch</span>
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs font-semibold"
              onClick={() => set("coScholasticAreas", CBSE_CO_SCHOLASTIC_AREAS)}
            >
              Use CBSE areas
            </button>
            <button
              type="button"
              className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs font-semibold"
              onClick={() => set("coScholasticAreas", [...draft.coScholasticAreas, { code: "", label: "" }])}
            >
              Add area
            </button>
          </div>
        </div>
        {draft.coScholasticAreas.length > 0 ? (
          <div className="mt-2 space-y-1.5">
            {draft.coScholasticAreas.map((a, i) => (
              <div key={i} className="grid grid-cols-[6rem_1fr_auto] items-center gap-2 text-sm">
                <input
                  className="field !py-1"
                  value={a.code}
                  placeholder="HPE"
                  maxLength={24}
                  onChange={(e) =>
                    set(
                      "coScholasticAreas",
                      draft.coScholasticAreas.map((x, j) =>
                        j === i ? { ...x, code: e.target.value.replace(/\s+/g, "_") } : x,
                      ),
                    )
                  }
                  aria-label={`Area ${i + 1} code`}
                />
                <input
                  className="field !py-1"
                  value={a.label}
                  placeholder="Health & Physical Education"
                  maxLength={60}
                  onChange={(e) =>
                    set(
                      "coScholasticAreas",
                      draft.coScholasticAreas.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)),
                    )
                  }
                  aria-label={`Area ${i + 1} label`}
                />
                <button
                  type="button"
                  className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs"
                  onClick={() => set("coScholasticAreas", draft.coScholasticAreas.filter((_, j) => j !== i))}
                  aria-label={`Remove area ${i + 1}`}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className={box}>
        <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">
          Exams these classes sit{" "}
          <span className="font-normal normal-case">— none ticked = every exam</span>
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {terms.map((t) => {
            const on = draft.termIds.includes(t.id);
            return (
              <label
                key={t.id}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs ${
                  on ? "border-[var(--brand-deep)] bg-[var(--surface-sunken)]" : "border-[var(--border)]"
                }`}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) =>
                    set(
                      "termIds",
                      e.target.checked ? [...draft.termIds, t.id] : draft.termIds.filter((x) => x !== t.id),
                    )
                  }
                />
                {t.code} · {t.label}
              </label>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn-accent rounded-lg px-3 py-1.5 text-xs font-semibold"
          onClick={onSave}
        >
          Save scheme
        </button>
      </div>
    </div>
  );
}
