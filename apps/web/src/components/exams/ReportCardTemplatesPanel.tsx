"use client";

import { useMemo, useState } from "react";
import { FileText, Plus, Trash2 } from "lucide-react";
import { saveExamPolicy, type ExamPolicy } from "@/lib/exams";
import {
  blankTemplate,
  duplicateTemplate,
  layoutLabel,
  TEMPLATE_PRESETS,
  templateFromPreset,
  templateSummary,
  type CardLayout,
  type ReportCardTemplate,
} from "@/lib/examReportTemplates";
import { CLASS_GROUPS, type MastersState } from "@/lib/masters";

/**
 * Report card templates — how each class's printed card looks.
 *
 * Prefilled layouts (classic, Holistic Progress Card, grades card,
 * board-style, term-wise, compact) that the school assigns to classes one
 * by one or a whole band at a time, then edits field by field: title,
 * which identity lines, photo, attendance, components, grade legend,
 * rank, average, result, co-scholastic, remarks, signatures, footer.
 */
export function ReportCardTemplatesPanel({
  policy,
  masters,
  onSaved,
  onFlash,
  onError,
}: {
  policy: ExamPolicy;
  masters: MastersState | null;
  onSaved: () => void;
  onFlash: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [draft, setDraft] = useState<ReportCardTemplate | null>(null);
  const [presetKey, setPresetKey] = useState(TEMPLATE_PRESETS[0]!.key);

  const classes = useMemo(() => {
    const list = (masters?.classes ?? []).filter((c) => c.isActive !== false);
    return [...list].sort((a, b) => a.sortOrder - b.sortOrder);
  }, [masters]);
  const classNameById = useMemo(() => new Map(classes.map((c) => [c.id, c.name])), [classes]);
  const assignedElsewhere = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of policy.reportTemplates) {
      if (draft && t.id === draft.id) continue;
      for (const c of t.classIds) m.set(c, t.name);
    }
    return m;
  }, [policy.reportTemplates, draft]);

  function persist(next: ReportCardTemplate[], done: string) {
    const r = saveExamPolicy({ reportTemplates: next });
    if (!r.ok) {
      onError(r.error);
      return;
    }
    setDraft(null);
    onSaved();
    onFlash(done);
  }

  function addFromPreset() {
    const preset = TEMPLATE_PRESETS.find((p) => p.key === presetKey);
    if (!preset) return;
    const band = CLASS_GROUPS.find((g) => g.code === preset.band);
    const names = new Set(band?.classNames ?? []);
    const claimed = new Set(policy.reportTemplates.flatMap((t) => t.classIds));
    const classIds =
      preset.band === "ALL"
        ? []
        : classes.filter((c) => names.has(c.name) && !claimed.has(c.id)).map((c) => c.id);
    setDraft(templateFromPreset(preset, classIds));
  }

  function makeFallback(t: ReportCardTemplate) {
    persist(
      policy.reportTemplates.map((x) => ({ ...x, isDefault: x.id === t.id })),
      `${t.name} is now the fallback template`,
    );
  }

  function remove(t: ReportCardTemplate) {
    if (t.isDefault) return;
    if (!window.confirm(`Remove the template "${t.name}"? Its classes go back to the fallback template.`)) return;
    persist(
      policy.reportTemplates.filter((x) => x.id !== t.id),
      `Removed ${t.name}`,
    );
  }

  function save() {
    if (!draft) return;
    if (!draft.name.trim()) {
      onError("Give the template a name");
      return;
    }
    if (!draft.isDefault && draft.classIds.length === 0) {
      onError("Tick at least one class for this template, or remove it (the fallback may have none)");
      return;
    }
    const exists = policy.reportTemplates.some((t) => t.id === draft.id);
    persist(
      exists
        ? policy.reportTemplates.map((t) => (t.id === draft.id ? draft : t))
        : [...policy.reportTemplates, draft],
      `Saved ${draft.name}`,
    );
  }

  const set = <K extends keyof ReportCardTemplate>(key: K, value: ReportCardTemplate[K]) =>
    setDraft((d) => (d ? { ...d, [key]: value } : d));

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 lg:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold text-[var(--brand-deep)]">
            <FileText className="size-4" aria-hidden />
            Report card templates
          </h2>
          <p className="mt-1 max-w-2xl text-xs text-[var(--muted)]">
            How each class&apos;s printed card looks — layout, title, identity lines, photo,
            attendance, components, grade legend, rank, result, remarks, signatures. Assign a
            template to classes one by one or a whole band at once; classes not named use the
            fallback.
          </p>
        </div>
        {!draft ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold"
              onClick={() => setDraft(blankTemplate())}
            >
              <Plus className="size-3.5" aria-hidden />
              New template
            </button>
            <select
              className="field !py-1.5 text-xs"
              value={presetKey}
              onChange={(e) => setPresetKey(e.target.value)}
              aria-label="Template preset"
            >
              {TEMPLATE_PRESETS.map((p) => (
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
              Add prefilled
            </button>
          </div>
        ) : null}
      </div>

      {!draft ? (
        <ul className="mt-4 divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
          {policy.reportTemplates.map((t) => (
            <li key={t.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="font-semibold text-[var(--brand-deep)]">
                  {t.name}
                  {t.isDefault ? (
                    <span className="ml-2 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--muted)] ring-1 ring-[var(--border)]">
                      fallback
                    </span>
                  ) : null}
                </p>
                <p className="mt-0.5 text-xs text-[var(--muted)]">
                  {t.classIds.map((id) => classNameById.get(id) ?? id).join(", ") ||
                    (t.isDefault ? "" : "No classes")}
                  {t.isDefault ? `${t.classIds.length ? " · plus " : ""}every class not named elsewhere` : ""}
                </p>
                <p className="mt-0.5 text-xs text-[var(--muted)]">
                  &ldquo;{t.title}&rdquo; · {templateSummary(t)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs font-semibold" onClick={() => setDraft(t)}>
                  Customise
                </button>
                <button type="button" className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs font-semibold" onClick={() => setDraft(duplicateTemplate(t))}>
                  Duplicate
                </button>
                {!t.isDefault ? (
                  <button type="button" className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs font-semibold" onClick={() => makeFallback(t)}>
                    Make fallback
                  </button>
                ) : null}
                {!t.isDefault ? (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs font-semibold text-[var(--danger)]"
                    onClick={() => remove(t)}
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
        <TemplateEditor
          draft={draft}
          set={set}
          classes={classes}
          assignedElsewhere={assignedElsewhere}
          onCancel={() => setDraft(null)}
          onSave={save}
        />
      )}
    </section>
  );
}

const LAYOUTS: CardLayout[] = ["classic", "hpc", "compact", "termwise"];

type Tri = boolean | null;

function TriSelect({
  label,
  value,
  onChange,
  fallbackText = "As the assessment scheme says",
}: {
  label: string;
  value: Tri;
  onChange: (v: Tri) => void;
  fallbackText?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-[11px] text-[var(--muted)]">{label}</span>
      <select
        className="field !py-1.5"
        value={value == null ? "scheme" : value ? "yes" : "no"}
        onChange={(e) => onChange(e.target.value === "scheme" ? null : e.target.value === "yes")}
      >
        <option value="scheme">{fallbackText}</option>
        <option value="yes">Show</option>
        <option value="no">Hide</option>
      </select>
    </label>
  );
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-[var(--brand-deep)]">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function TemplateEditor({
  draft,
  set,
  classes,
  assignedElsewhere,
  onCancel,
  onSave,
}: {
  draft: ReportCardTemplate;
  set: <K extends keyof ReportCardTemplate>(key: K, value: ReportCardTemplate[K]) => void;
  classes: MastersState["classes"];
  assignedElsewhere: Map<string, string>;
  onCancel: () => void;
  onSave: () => void;
}) {
  const label = "mb-1 block text-[11px] text-[var(--muted)]";
  const box = "rounded-lg border border-[var(--border)] p-3";

  /** Bulk: tick every free class of a band, or every free class. */
  function tickBand(code: string | "ALL") {
    const band = CLASS_GROUPS.find((g) => g.code === code);
    const names = band ? new Set(band.classNames) : null;
    const ids = classes
      .filter((c) => (!names || names.has(c.name)) && !assignedElsewhere.has(c.id))
      .map((c) => c.id);
    set("classIds", [...new Set([...draft.classIds, ...ids])]);
  }

  return (
    <div className="mt-4 space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-sm">
          <span className={label}>Template name</span>
          <input className="field !py-1.5" value={draft.name} onChange={(e) => set("name", e.target.value)} maxLength={60} />
        </label>
        <label className="block text-sm">
          <span className={label}>Layout</span>
          <select className="field !py-1.5" value={draft.layout} onChange={(e) => set("layout", e.target.value as CardLayout)}>
            {LAYOUTS.map((l) => (
              <option key={l} value={l}>
                {layoutLabel(l)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className={label}>Card title</span>
          <input className="field !py-1.5" value={draft.title} onChange={(e) => set("title", e.target.value)} maxLength={60} />
        </label>
        <label className="block text-sm sm:col-span-3">
          <span className={label}>Subtitle (optional, under the title)</span>
          <input className="field !py-1.5" value={draft.subtitle} onChange={(e) => set("subtitle", e.target.value)} maxLength={120} />
        </label>
      </div>

      <div className={box}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">
            Classes{draft.isDefault ? " (plus every class not named elsewhere)" : ""}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {CLASS_GROUPS.map((g) => (
              <button
                key={g.code}
                type="button"
                className="rounded-lg border border-[var(--border)] px-2 py-0.5 text-[11px] font-semibold"
                onClick={() => tickBand(g.code)}
                title={`Tick every free class in ${g.label}`}
              >
                + {g.shortLabel}
              </button>
            ))}
            <button
              type="button"
              className="rounded-lg border border-[var(--border)] px-2 py-0.5 text-[11px] font-semibold"
              onClick={() => tickBand("ALL")}
            >
              + All free
            </button>
            <button
              type="button"
              className="rounded-lg border border-[var(--border)] px-2 py-0.5 text-[11px] font-semibold"
              onClick={() => set("classIds", [])}
            >
              None
            </button>
          </div>
        </div>
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
                title={taken ? `Uses ${taken}` : ""}
              >
                <input
                  type="checkbox"
                  checked={on}
                  disabled={!!taken}
                  onChange={(e) =>
                    set("classIds", e.target.checked ? [...draft.classIds, c.id] : draft.classIds.filter((x) => x !== c.id))
                  }
                />
                {c.name}
              </label>
            );
          })}
        </div>
      </div>

      <div className={box}>
        <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">Identity block</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <TriSelect label="Student photo" value={draft.showPhoto} onChange={(v) => set("showPhoto", v)} />
          <div className="space-y-1.5 sm:col-span-2 sm:pt-5">
            <Check label="Father / mother" checked={draft.showParents} onChange={(v) => set("showParents", v)} />
            <Check label="Admission number" checked={draft.showAdmissionNo} onChange={(v) => set("showAdmissionNo", v)} />
            <Check label="Roll number" checked={draft.showRollNo} onChange={(v) => set("showRollNo", v)} />
            <Check label="Date of birth" checked={draft.showDob} onChange={(v) => set("showDob", v)} />
            <Check label="Height, weight, blood group (when recorded)" checked={draft.showHealth} onChange={(v) => set("showHealth", v)} />
          </div>
        </div>
      </div>

      <div className={box}>
        <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">Marks and summary</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <TriSelect label="Attendance" value={draft.showAttendance} onChange={(v) => set("showAttendance", v)} />
          <TriSelect label="Rank in class" value={draft.showRank} onChange={(v) => set("showRank", v)} />
          <TriSelect label="Class average" value={draft.showClassAverage} onChange={(v) => set("showClassAverage", v)} />
          <TriSelect label="Result (promoted / detained)" value={draft.showResult} onChange={(v) => set("showResult", v)} />
          <div className="space-y-1.5 sm:col-span-2 sm:pt-5">
            <Check label="Component breakdown (80 + 20, theory + practical, contributing exams)" checked={draft.showComponents} onChange={(v) => set("showComponents", v)} />
            <Check label="Per-subject remarks column" checked={draft.showSubjectRemarks} onChange={(v) => set("showSubjectRemarks", v)} />
            <Check label="Grade legend (what each grade means)" checked={draft.showGradeLegend} onChange={(v) => set("showGradeLegend", v)} />
            <Check label="Percentage" checked={draft.showPercent} onChange={(v) => set("showPercent", v)} />
            <Check label="Overall grade" checked={draft.showOverallGrade} onChange={(v) => set("showOverallGrade", v)} />
            <Check label="Co-scholastic areas" checked={draft.showCoScholastic} onChange={(v) => set("showCoScholastic", v)} />
            <Check label="Class teacher's remarks" checked={draft.showRemarks} onChange={(v) => set("showRemarks", v)} />
          </div>
        </div>
      </div>

      <div className={box}>
        <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">Foot of the card</p>
        <div className="mt-2 space-y-2">
          <Check label="Signature lines" checked={draft.showSignatures} onChange={(v) => set("showSignatures", v)} />
          {draft.showSignatures ? (
            <div className="grid gap-2 sm:grid-cols-4">
              {draft.signatureLabels.map((l, i) => (
                <div key={i} className="flex items-center gap-1">
                  <input
                    className="field !py-1 text-sm"
                    value={l}
                    maxLength={40}
                    onChange={(e) =>
                      set("signatureLabels", draft.signatureLabels.map((x, j) => (j === i ? e.target.value : x)))
                    }
                    aria-label={`Signature ${i + 1}`}
                  />
                  <button
                    type="button"
                    className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs"
                    disabled={draft.signatureLabels.length <= 1}
                    onClick={() => set("signatureLabels", draft.signatureLabels.filter((_, j) => j !== i))}
                    aria-label={`Remove signature ${i + 1}`}
                  >
                    ×
                  </button>
                </div>
              ))}
              {draft.signatureLabels.length < 4 ? (
                <button
                  type="button"
                  className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs font-semibold"
                  onClick={() => set("signatureLabels", [...draft.signatureLabels, "Parent"])}
                >
                  Add signature
                </button>
              ) : null}
            </div>
          ) : null}
          <label className="block text-sm">
            <span className={label}>Footer note (optional)</span>
            <input className="field !py-1.5" value={draft.footerNote} onChange={(e) => set("footerNote", e.target.value)} maxLength={300} />
          </label>
          <Check label="School watermark" checked={draft.showWatermark} onChange={(v) => set("showWatermark", v)} />
        </div>
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn-accent rounded-lg px-3 py-1.5 text-xs font-semibold" onClick={onSave}>
          Save template
        </button>
      </div>
    </div>
  );
}
