"use client";

// ratchet-allow: grids_without_row_menu — a line editor inside the scheme form: each row is a part being typed, with its own × to remove it; there is no record to act on

/**
 * Per-subject splits inside an assessment scheme: English = Written 80 +
 * Oral 20 in Half-yearly / Annual, Written 40 + Oral 10 in unit tests, each
 * part with its own pass line if the school wants one. A subject not split
 * here keeps the scheme's common components (or one whole mark).
 *
 * Parts are suggested from the subject's components in Masters, so the
 * office types marks, not codes.
 */

import { useMemo, useState } from "react";
import {
  splitPartCode,
  splitPartsFromMasterComponents,
  type SubjectSplit,
  type SubjectSplitPart,
} from "@/lib/examSchemes";
import type { MastersState } from "@/lib/masters";
import { ErpTable, ErpTableBody, ErpTableHead, ErpTableShell } from "@/components/ui/erp-roster";
import { ncfTagForSubject } from "@/lib/cbseSubjectGroups";

type MasterSubject = MastersState["subjects"][number];

/** Top-level, marked (not co-scholastic) subjects the scheme's classes study. */
export function markedSubjectsForClasses(
  masters: MastersState | null,
  classIds: string[] | null,
): MasterSubject[] {
  if (!masters) return [];
  const want = classIds ? new Set(classIds) : null;
  const linked = new Set(
    (masters.classSubjects ?? [])
      .filter((l) => l.isActive && (!want || want.has(l.classId)))
      .map((l) => l.subjectId),
  );
  const byId = new Map((masters.subjects ?? []).map((s) => [s.id, s] as const));
  const out = new Map<string, MasterSubject>();
  for (const id of linked) {
    const s = byId.get(id);
    if (!s || !s.isActive) continue;
    // A linked component counts for its subject.
    const top = s.parentId ? byId.get(s.parentId) : s;
    if (!top || !top.isActive || top.category === "co_scholastic" || ncfTagForSubject(top) === "CO") continue;
    out.set(top.id, top);
  }
  return [...out.values()].sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
}

function defaultParts(subject: MasterSubject, masters: MastersState | null): SubjectSplitPart[] {
  const kids = (masters?.subjects ?? [])
    .filter((s) => s.parentId === subject.id && s.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const parts = splitPartsFromMasterComponents(subject.code, kids);
  if (parts.length === 0) {
    return [
      { code: "WRIT", label: "Written", termMax: 80, unitTestMax: 0, kind: "exam", passPercent: null },
      { code: "ORAL", label: "Oral", termMax: 20, unitTestMax: 0, kind: "internal", passPercent: null },
    ];
  }
  // A written / theory part takes the larger share (80); the rest split 20.
  const written = parts.findIndex((p) => /writ|theor/i.test(`${p.code} ${p.label}`));
  const others = parts.length - (written >= 0 ? 1 : 0);
  const filled = parts.map((p, i): SubjectSplitPart => {
    if (i === written) return { ...p, termMax: 80, kind: "exam" };
    const share = written >= 0 ? Math.floor(20 / Math.max(1, others)) : Math.floor(100 / parts.length);
    return { ...p, termMax: share, kind: written >= 0 ? "internal" : "exam" };
  });
  // The written paper first — it is the column teachers fill first.
  return written > 0 ? [filled[written]!, ...filled.filter((_, i) => i !== written)] : filled;
}

export function SubjectSplitsEditor({
  splits,
  onChange,
  masters,
  classIds,
  schemePass,
  termMaxHint,
  unitTestMaxHint,
}: {
  splits: SubjectSplit[];
  onChange: (next: SubjectSplit[]) => void;
  masters: MastersState | null;
  /** The scheme's classes; null = every class (the default scheme). */
  classIds: string[] | null;
  schemePass: number;
  /** "Half-yearly 80 · Annual 80" — the exams' own maxima, for context. */
  termMaxHint: string;
  unitTestMaxHint: string;
}) {
  const [pick, setPick] = useState("");
  const subjects = useMemo(() => markedSubjectsForClasses(masters, classIds), [masters, classIds]);
  const available = subjects.filter((s) => !splits.some((x) => x.subjectCode === s.code.trim().toUpperCase()));
  const nameOf = (code: string) =>
    (masters?.subjects ?? []).find((s) => s.code.trim().toUpperCase() === code)?.nameEn ?? code;

  function addSplit() {
    const s = subjects.find((x) => x.id === pick);
    if (!s) return;
    onChange([
      ...splits,
      { subjectCode: s.code.trim().toUpperCase(), parts: defaultParts(s, masters), passPercent: null },
    ]);
    setPick("");
  }

  function patchSplit(i: number, next: Partial<SubjectSplit>) {
    onChange(splits.map((x, j) => (j === i ? { ...x, ...next } : x)));
  }

  function patchPart(i: number, k: number, next: Partial<SubjectSplitPart>) {
    patchSplit(i, { parts: splits[i]!.parts.map((p, j) => (j === k ? { ...p, ...next } : p)) });
  }

  const num = (v: string) => Number(v.replace(/\D/g, "") || 0);
  const pct = (v: string): number | null => {
    const n = Number(v.replace(/\D/g, ""));
    return v.trim() === "" || !n ? null : Math.min(100, n);
  };

  return (
    <div className="rounded-lg border border-[var(--border)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">
            Subject splits{" "}
            <span className="font-normal normal-case">
              — one subject marked in parts (English = Written 80 + Oral 20). Overrides the components above for that subject.
            </span>
          </p>
          <p className="mt-0.5 text-[11px] text-[var(--muted)]">
            Exam maxima: {termMaxHint || "—"} · Unit tests: {unitTestMaxHint || "—"}. A part with 0 is not assessed in that kind of exam.
          </p>
        </div>
        <div className="flex gap-2">
          <select
            className="field !w-auto !py-1 text-xs"
            value={pick}
            onChange={(e) => setPick(e.target.value)}
            aria-label="Subject to split"
          >
            <option value="">Split a subject…</option>
            {available.map((s) => {
              const kids = (masters?.subjects ?? []).filter((k) => k.parentId === s.id && k.isActive).length;
              return (
                <option key={s.id} value={s.id}>
                  {s.code} — {s.nameEn}
                  {kids ? ` (${kids} components in Masters)` : ""}
                </option>
              );
            })}
          </select>
          <button
            type="button"
            className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs font-semibold disabled:opacity-40"
            disabled={!pick}
            onClick={addSplit}
          >
            Add split
          </button>
        </div>
      </div>

      {splits.length === 0 ? (
        <p className="mt-2 text-xs text-[var(--muted)]">No subject is split — every subject uses the components above, or one whole mark.</p>
      ) : null}

      <div className="mt-2 space-y-3">
        {splits.map((split, i) => {
          const termTotal = split.parts.reduce((n, p) => n + p.termMax, 0);
          const utTotal = split.parts.reduce((n, p) => n + p.unitTestMax, 0);
          return (
            <div key={split.subjectCode} className="rounded-lg bg-[var(--surface-sunken)] p-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-bold text-[var(--brand-deep)]">
                  {split.subjectCode} <span className="font-normal text-[var(--muted)]">{nameOf(split.subjectCode)}</span>
                </span>
                <span className="text-[11px] text-[var(--muted)]">
                  Term exams total <b className="text-[var(--brand-deep)]">{termTotal}</b> · Unit tests total{" "}
                  <b className="text-[var(--brand-deep)]">{utTotal || "not split"}</b>
                </span>
                <label className="ml-auto flex items-center gap-1.5 text-[11px] text-[var(--muted)]">
                  Subject pass %
                  <input
                    className="field !w-16 !py-1 text-center tabular-nums"
                    inputMode="numeric"
                    placeholder={String(schemePass)}
                    value={split.passPercent ?? ""}
                    onChange={(e) => patchSplit(i, { passPercent: pct(e.target.value) })}
                    aria-label={`${split.subjectCode} pass percent`}
                    title="Pass line for the subject's total. Blank = the scheme's pass %."
                  />
                </label>
                <button
                  type="button"
                  className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs"
                  onClick={() => onChange(splits.filter((_, j) => j !== i))}
                  aria-label={`Remove ${split.subjectCode} split`}
                >
                  Remove split
                </button>
              </div>

              <ErpTableShell density="compact" className="mt-2 overflow-x-auto">
                <ErpTable minWidth="min-w-[560px]">
                  <ErpTableHead>
                    <tr>
                      <th className="px-2 py-1.5">Code</th>
                      <th className="px-2 py-1.5">Part</th>
                      <th className="px-2 py-1.5 text-center">Term exams</th>
                      <th className="px-2 py-1.5 text-center">Unit tests</th>
                      <th className="px-2 py-1.5 text-center" title="Blank = no separate pass line for this part">
                        Own pass %
                      </th>
                      <th className="px-2 py-1.5">Kind</th>
                      <th aria-label="Actions" />
                    </tr>
                  </ErpTableHead>
                  <ErpTableBody>
                    {split.parts.map((p, k) => (
                      <tr key={k}>
                        <td className="px-2 py-1">
                          <input
                            className="field !w-20 !py-1 uppercase"
                            value={p.code}
                            maxLength={8}
                            onChange={(e) => patchPart(i, k, { code: splitPartCode(e.target.value) })}
                            aria-label={`${split.subjectCode} part ${k + 1} code`}
                          />
                        </td>
                        <td className="px-2 py-1">
                          <input
                            className="field !py-1"
                            value={p.label}
                            maxLength={40}
                            onChange={(e) => patchPart(i, k, { label: e.target.value })}
                            aria-label={`${split.subjectCode} part ${k + 1} name`}
                          />
                        </td>
                        <td className="px-2 py-1">
                          <input
                            className="field !w-16 !py-1 text-center tabular-nums"
                            inputMode="numeric"
                            value={p.termMax || ""}
                            placeholder="0"
                            onChange={(e) => patchPart(i, k, { termMax: num(e.target.value) })}
                            aria-label={`${split.subjectCode} ${p.label} term exam marks`}
                          />
                        </td>
                        <td className="px-2 py-1">
                          <input
                            className="field !w-16 !py-1 text-center tabular-nums"
                            inputMode="numeric"
                            value={p.unitTestMax || ""}
                            placeholder="0"
                            onChange={(e) => patchPart(i, k, { unitTestMax: num(e.target.value) })}
                            aria-label={`${split.subjectCode} ${p.label} unit test marks`}
                          />
                        </td>
                        <td className="px-2 py-1">
                          <input
                            className="field !w-16 !py-1 text-center tabular-nums"
                            inputMode="numeric"
                            value={p.passPercent ?? ""}
                            placeholder="—"
                            onChange={(e) => patchPart(i, k, { passPercent: pct(e.target.value) })}
                            aria-label={`${split.subjectCode} ${p.label} own pass percent`}
                          />
                        </td>
                        <td className="px-2 py-1">
                          <select
                            className="field !w-auto !py-1 text-xs"
                            value={p.kind}
                            onChange={(e) => patchPart(i, k, { kind: e.target.value as "exam" | "internal" })}
                            aria-label={`${split.subjectCode} ${p.label} kind`}
                          >
                            <option value="exam">Written exam</option>
                            <option value="internal">Oral / internal</option>
                          </select>
                        </td>
                        <td className="px-2 py-1">
                          <button
                            type="button"
                            className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs"
                            onClick={() => patchSplit(i, { parts: split.parts.filter((_, j) => j !== k) })}
                            aria-label={`Remove ${split.subjectCode} part ${k + 1}`}
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    ))}
                  </ErpTableBody>
                </ErpTable>
              </ErpTableShell>
              <button
                type="button"
                className="mt-1 text-[11px] font-semibold text-[var(--brand-mid)] underline-offset-2 hover:underline"
                onClick={() =>
                  patchSplit(i, {
                    parts: [
                      ...split.parts,
                      { code: "", label: "", termMax: 0, unitTestMax: 0, kind: "internal", passPercent: null },
                    ],
                  })
                }
              >
                + Add part
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
