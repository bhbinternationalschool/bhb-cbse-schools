"use client";
// ratchet-allow: grids_without_row_menu — an append-only change log; entries are never edited

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  STUDENT_TYPES,
  STUDENT_TYPE_HINTS,
  loadMasters,
  resolveFeeGroupId,
  type FeeStudentType,
  type MastersState,
} from "@/lib/masters";
import {
  loadSis,
  studentTypeShort,
  type SisState,
  type SisStudent,
} from "@/lib/sis";
import {
  listClassUpgrades,
  upgradeStudentClass,
} from "@/lib/classUpgrade";
import { StudentNameLabel } from "@/components/students/StudentAvatar";
import { ErpTable, ErpTableBody, ErpTableHead } from "@/components/ui/erp-roster";

type UpgradeMode = "section" | "class" | "type";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function classSectionLabel(
  classId: string,
  sectionId: string,
  masters: MastersState,
): string {
  const cls = masters.classes.find((c) => c.id === classId)?.name ?? "—";
  const sec = masters.sections.find((s) => s.id === sectionId)?.name ?? "";
  return sec ? `${cls}-${sec}` : cls;
}

function feeGroupLabel(id: string | null, masters: MastersState): string {
  if (!id) return "—";
  const g = masters.feeGroups.find((x) => x.id === id);
  return g ? g.name || g.code : id;
}

function typeLabel(code: string): string {
  return STUDENT_TYPES.find((t) => t.value === code)?.label ?? (code || "—");
}

export function StudentUpgradePanel({
  tick = 0,
  onChanged,
}: {
  tick?: number;
  onChanged?: (sis: SisState) => void;
}) {
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [sis, setSis] = useState<SisState | null>(null);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [mode, setMode] = useState<UpgradeMode>("section");
  const [toClassId, setToClassId] = useState("");
  const [toSectionId, setToSectionId] = useState("");
  const [toStudentType, setToStudentType] = useState<FeeStudentType>("NEW");
  const [remapFee, setRemapFee] = useState(false);
  const [resetCurriculum, setResetCurriculum] = useState(false);
  const [reason, setReason] = useState("");
  const [effectiveOn, setEffectiveOn] = useState(todayIso);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function refresh() {
    setMasters(loadMasters());
    setSis(loadSis());
  }

  useEffect(() => {
    refresh();
  }, [tick]);

  const hits = useMemo(() => {
    if (!sis || !masters) return [] as SisStudent[];
    const q = query.trim().toLowerCase();
    let rows = sis.students.filter((s) => s.status === "active");
    if (q) {
      rows = rows.filter(
        (s) =>
          s.fullName.toLowerCase().includes(q) ||
          s.admissionNo.toLowerCase().includes(q) ||
          s.rollNo.toLowerCase().includes(q) ||
          s.fatherName.toLowerCase().includes(q),
      );
    }
    return rows
      .slice()
      .sort((a, b) => a.fullName.localeCompare(b.fullName))
      .slice(0, 12);
  }, [sis, masters, query]);

  const selected = useMemo(() => {
    if (!sis || !selectedId) return null;
    return sis.students.find((s) => s.id === selectedId) ?? null;
  }, [sis, selectedId]);

  const effectiveClassId =
    mode === "class" ? toClassId : selected?.classId ?? "";

  const targetSections = useMemo(() => {
    if (!masters || !effectiveClassId) return [];
    return masters.sections.filter(
      (s) => s.isActive && s.classId === effectiveClassId,
    );
  }, [masters, effectiveClassId]);

  const classWillChange = !!(
    selected &&
    mode === "class" &&
    toClassId &&
    toClassId !== selected.classId
  );
  const typeWillChange = !!(selected && toStudentType !== selected.studentType);

  const suggestedFeeGroupId = useMemo(() => {
    if (!masters || !selected || !remapFee) return null;
    if (!classWillChange && !typeWillChange) return null;
    const classId =
      mode === "class" && toClassId ? toClassId : selected.classId;
    return resolveFeeGroupId(masters, {
      studentType: toStudentType,
      classId,
      academicYearCode: selected.academicYearCode,
    });
  }, [
    masters,
    selected,
    toClassId,
    toStudentType,
    remapFee,
    classWillChange,
    typeWillChange,
    mode,
  ]);

  const history = useMemo(
    () => (sis ? listClassUpgrades(sis).slice(0, 40) : []),
    [sis],
  );

  function flash(msg: string) {
    setNotice(msg);
    setError(null);
    window.setTimeout(() => setNotice(null), 3600);
  }

  function applyMode(next: UpgradeMode, student?: SisStudent | null) {
    const s = student ?? selected;
    setMode(next);
    if (!s) {
      setToClassId("");
      setToSectionId("");
      return;
    }
    setToStudentType(s.studentType);
    if (next === "section") {
      setToClassId(s.classId);
      setToSectionId("");
      setRemapFee(false);
      setResetCurriculum(false);
    } else if (next === "type") {
      setToClassId(s.classId);
      setToSectionId(s.sectionId);
      setRemapFee(true);
      setResetCurriculum(false);
    } else {
      setToClassId("");
      setToSectionId("");
      setRemapFee(true);
      setResetCurriculum(true);
    }
  }

  function pickStudent(s: SisStudent) {
    setSelectedId(s.id);
    setQuery("");
    setError(null);
    applyMode(mode, s);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!selected) {
      setError("Select a student first");
      return;
    }
    const targetClassId =
      mode === "class" ? toClassId : selected.classId;
    const targetSectionId =
      mode === "type" ? selected.sectionId : toSectionId;

    if (mode === "class" && (!targetClassId || !targetSectionId)) {
      setError("Pick the new class and section");
      return;
    }
    if (mode === "section" && !targetSectionId) {
      setError("Pick the new section");
      return;
    }
    if (mode === "type" && toStudentType === selected.studentType) {
      setError("Pick a different student type (e.g. NEW → PROMOTE)");
      return;
    }

    setSaving(true);
    const res = upgradeStudentClass({
      studentId: selected.id,
      toClassId: targetClassId,
      toSectionId: targetSectionId || selected.sectionId,
      toStudentType,
      remapFeeGroup:
        (mode === "class" || mode === "type" || typeWillChange) && remapFee,
      resetCurriculum: mode === "class" && resetCurriculum,
      reason,
      effectiveOn,
      masters: masters ?? undefined,
    });
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSis(res.state);
    onChanged?.(res.state);
    const bits: string[] = [];
    if (res.record.fromClassId !== res.record.toClassId) bits.push("class");
    else if (res.record.fromSectionId !== res.record.toSectionId) {
      bits.push("section");
    }
    if (res.record.fromStudentType !== res.record.toStudentType) {
      bits.push(
        `type ${res.record.fromStudentType}→${res.record.toStudentType}`,
      );
    }
    flash(
      `Updated ${res.student.fullName} (${bits.join(", ") || "saved"}) → ${classSectionLabel(
        res.student.classId,
        res.student.sectionId,
        masters!,
      )}`,
    );
    applyMode(mode, res.student);
    setReason("");
  }

  if (!sis || !masters) {
    return (
      <p className="mt-4 text-sm text-[var(--muted)]">Loading upgrade…</p>
    );
  }

  return (
    <div className="mt-4 space-y-5">
      <div className="rounded-xl border border-[rgba(32,48,80,0.1)] bg-white px-4 py-3">
        <h2 className="text-base font-semibold text-[var(--brand-deep)]">
          Class / section / type upgrade
        </h2>
        <p className="mt-0.5 text-xs text-[var(--muted)]">
          Change section only, upgrade class + section, or switch fee status
          (e.g. New → Promoted / Promoted → New). Fee group can rematch when
          class or type changes.
        </p>
      </div>

      {notice ? (
        <p className="rounded-lg bg-[rgba(67,160,71,0.12)] px-3 py-2 text-sm text-[#2e7d32]">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-lg bg-[#dc2626]/10 px-3 py-2 text-sm text-[#dc2626]">
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <section className="rounded-xl border border-[rgba(32,48,80,0.1)] bg-white p-4">
          <h3 className="text-sm font-semibold text-[var(--brand-deep)]">
            Select student
          </h3>
          <input
            className="field mt-2"
            placeholder="Search name, admission no, roll…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {selected ? (
            <div className="mt-3 rounded-lg border border-[rgba(32,48,80,0.1)] bg-[rgba(32,48,80,0.03)] px-3 py-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium text-[var(--brand-deep)]">
                    <StudentNameLabel student={selected} sis={sis} />
                  </div>
                  <div className="mt-0.5 text-[11px] text-[var(--muted)]">
                    {selected.admissionNo} · Current:{" "}
                    {classSectionLabel(
                      selected.classId,
                      selected.sectionId,
                      masters,
                    )}
                  </div>
                  <div className="mt-0.5 text-[11px] text-[var(--muted)]">
                    Type: {studentTypeShort(selected.studentType).code} ·{" "}
                    {typeLabel(selected.studentType)} · Fee:{" "}
                    {feeGroupLabel(selected.feeGroupId, masters)}
                  </div>
                </div>
                <button
                  type="button"
                  className="text-[11px] font-semibold text-[#b71c1c]"
                  onClick={() => {
                    setSelectedId("");
                    setToClassId("");
                    setToSectionId("");
                  }}
                >
                  Clear
                </button>
              </div>
            </div>
          ) : null}
          {!selected && query.trim() ? (
            <ul className="mt-2 max-h-64 overflow-auto rounded-lg border border-[rgba(32,48,80,0.08)]">
              {hits.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-[rgba(32,48,80,0.04)]"
                    onClick={() => pickStudent(s)}
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-[var(--brand-deep)]">
                        <StudentNameLabel student={s} sis={sis} />
                      </div>
                      <div className="text-[11px] text-[var(--muted)]">
                        {s.admissionNo} ·{" "}
                        {classSectionLabel(s.classId, s.sectionId, masters)} ·{" "}
                        {studentTypeShort(s.studentType).code}
                      </div>
                    </div>
                  </button>
                </li>
              ))}
              {!hits.length ? (
                <li className="px-3 py-4 text-center text-xs text-[var(--muted)]">
                  No match
                </li>
              ) : null}
            </ul>
          ) : null}
          {!selected && !query.trim() ? (
            <p className="mt-3 text-xs text-[var(--muted)]">
              Type to search an admitted student to upgrade.
            </p>
          ) : null}
        </section>

        <section className="rounded-xl border border-[rgba(32,48,80,0.1)] bg-white p-4">
          <h3 className="text-sm font-semibold text-[var(--brand-deep)]">
            What to change
          </h3>

          <div
            className="mt-3 inline-flex flex-wrap rounded-2xl border border-[rgba(32,48,80,0.12)] bg-[rgba(32,48,80,0.03)] p-1.5"
            role="group"
            aria-label="Upgrade mode"
          >
            {(
              [
                ["section", "Section only", "sky"],
                ["class", "Class + section", "amber"],
                ["type", "Type only", "violet"],
              ] as const
            ).map(([id, label, tone]) => (
              <button
                key={id}
                type="button"
                onClick={() => applyMode(id)}
                className={`rounded-xl px-4 py-2.5 text-sm font-extrabold tracking-wide transition ${
                  mode === id
                    ? tone === "sky"
                      ? "bg-[#0284c7] text-white shadow-[0_3px_12px_rgba(2,132,199,0.35)]"
                      : tone === "amber"
                        ? "bg-[#b8860b] text-white shadow-[0_3px_12px_rgba(184,134,11,0.4)]"
                        : "bg-[#6d28d9] text-white shadow-[0_3px_12px_rgba(109,40,217,0.35)]"
                    : "text-[var(--muted)] hover:bg-white hover:text-[var(--brand-deep)]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-[var(--muted)]">
            {mode === "section"
              ? "Keep class; move to another section. Type can also be changed below."
              : mode === "class"
                ? "Move to a different class and section. Type can also be changed below."
                : "Keep class & section; only change fee status (NEW ↔ PROMOTE, etc.)."}
          </p>

          <form onSubmit={onSubmit} className="mt-3 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              {mode === "class" ? (
                <label className="text-sm">
                  <span className="mb-1 block text-[11px] text-[var(--muted)]">
                    New class
                  </span>
                  <select
                    className="field"
                    value={toClassId}
                    required
                    disabled={!selected}
                    onChange={(e) => {
                      setToClassId(e.target.value);
                      setToSectionId("");
                    }}
                  >
                    <option value="">Select class</option>
                    {masters.classes
                      .filter((c) => c.isActive)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                          {selected && c.id === selected.classId
                            ? " (current)"
                            : ""}
                        </option>
                      ))}
                  </select>
                </label>
              ) : (
                <label className="text-sm">
                  <span className="mb-1 block text-[11px] text-[var(--muted)]">
                    Class (locked)
                  </span>
                  <input
                    className="field bg-[rgba(32,48,80,0.04)]"
                    readOnly
                    disabled={!selected}
                    value={
                      selected
                        ? masters.classes.find((c) => c.id === selected.classId)
                            ?.name ?? "—"
                        : ""
                    }
                  />
                </label>
              )}

              {mode === "type" ? (
                <label className="text-sm">
                  <span className="mb-1 block text-[11px] text-[var(--muted)]">
                    Section (locked)
                  </span>
                  <input
                    className="field bg-[rgba(32,48,80,0.04)]"
                    readOnly
                    disabled={!selected}
                    value={
                      selected
                        ? masters.sections.find(
                            (s) => s.id === selected.sectionId,
                          )?.name ?? "—"
                        : ""
                    }
                  />
                </label>
              ) : (
                <label className="text-sm">
                  <span className="mb-1 block text-[11px] text-[var(--muted)]">
                    New section
                  </span>
                  <select
                    className="field"
                    value={toSectionId}
                    required
                    disabled={!selected || (mode === "class" && !toClassId)}
                    onChange={(e) => setToSectionId(e.target.value)}
                  >
                    <option value="">Select section</option>
                    {targetSections.map((s) => (
                      <option
                        key={s.id}
                        value={s.id}
                        disabled={selected?.sectionId === s.id}
                      >
                        {s.name}
                        {selected?.sectionId === s.id ? " (current)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <label className="text-sm sm:col-span-2">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  Student type (fee status)
                </span>
                <select
                  className="field"
                  value={toStudentType}
                  disabled={!selected}
                  onChange={(e) => {
                    const next = e.target.value as FeeStudentType;
                    setToStudentType(next);
                    if (selected && next !== selected.studentType) {
                      setRemapFee(true);
                    }
                  }}
                >
                  {STUDENT_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                      {selected?.studentType === t.value ? " (current)" : ""}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-[var(--muted)]">
                  {STUDENT_TYPE_HINTS[toStudentType]}
                  {selected && typeWillChange
                    ? ` · Changing ${selected.studentType} → ${toStudentType}`
                    : ""}
                </p>
              </label>

              <label className="text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  Effective on
                </span>
                <input
                  type="date"
                  className="field"
                  value={effectiveOn}
                  onChange={(e) => setEffectiveOn(e.target.value)}
                  disabled={!selected}
                />
              </label>
              <label className="text-sm sm:col-span-2">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  Reason
                </span>
                <input
                  className="field"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={
                    mode === "type"
                      ? "e.g. Corrected — was marked New, actually Promoted"
                      : mode === "section"
                        ? "e.g. Section reshuffle — A → B"
                        : "e.g. Parent request — Nursery → LKG"
                  }
                  disabled={!selected}
                />
              </label>
            </div>

            {(mode === "class" || mode === "type" || typeWillChange) && (
              <label className="flex items-start gap-2 text-xs text-[var(--brand-deep)]">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={remapFee}
                  onChange={(e) => setRemapFee(e.target.checked)}
                  disabled={!selected}
                />
                <span>
                  Remap fee group for new class / type
                  {suggestedFeeGroupId ? (
                    <span className="text-[var(--muted)]">
                      {" "}
                      → {feeGroupLabel(suggestedFeeGroupId, masters)}
                    </span>
                  ) : remapFee && (toClassId || typeWillChange) ? (
                    <span className="text-[var(--muted)]">
                      {" "}
                      (no matching group found — keep current)
                    </span>
                  ) : null}
                </span>
              </label>
            )}

            {mode === "class" ? (
              <label className="flex items-start gap-2 text-xs text-[var(--brand-deep)]">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={resetCurriculum}
                  onChange={(e) => setResetCurriculum(e.target.checked)}
                  disabled={!selected}
                />
                <span>
                  Reset subject cart when class changes (recommended)
                </span>
              </label>
            ) : mode === "section" && !typeWillChange ? (
              <p className="rounded-lg bg-[rgba(32,48,80,0.04)] px-3 py-2 text-[11px] text-[var(--muted)]">
                Section-only move keeps the fee group and subject cart
                unchanged (unless you also change type above).
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="submit"
                disabled={!selected || saving}
                className="btn-accent rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-50"
              >
                {saving
                  ? "Saving…"
                  : mode === "section"
                    ? "Change section"
                    : mode === "type"
                      ? "Change type"
                      : "Upgrade class"}
              </button>
              {selected ? (
                <Link
                  href={`/students/${selected.id}/edit`}
                  className="text-xs font-medium text-[var(--brand-mid)]"
                >
                  Open full profile
                </Link>
              ) : null}
            </div>
          </form>
        </section>
      </div>

      <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <h3 className="text-sm font-semibold text-[var(--brand-deep)]">
          Upgrade history
        </h3>
        {!history.length ? (
          <p className="mt-3 text-sm text-[var(--muted)]">
            No upgrades recorded yet.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <ErpTable>
              <ErpTableHead>
                <tr>
                  <th className="px-2 py-1.5 font-semibold">When</th>
                  <th className="px-2 py-1.5 font-semibold">Student</th>
                  <th className="px-2 py-1.5 font-semibold">Change</th>
                  <th className="px-2 py-1.5 font-semibold">Class / section</th>
                  <th className="px-2 py-1.5 font-semibold">Type</th>
                  <th className="px-2 py-1.5 font-semibold">Fee</th>
                  <th className="px-2 py-1.5 font-semibold">Reason</th>
                </tr>
              </ErpTableHead>
              <ErpTableBody>
                {history.map((u) => {
                  const sectionOnly =
                    u.fromClassId === u.toClassId &&
                    u.fromSectionId !== u.toSectionId;
                  const classMoved = u.fromClassId !== u.toClassId;
                  const typeMoved =
                    u.fromStudentType &&
                    u.toStudentType &&
                    u.fromStudentType !== u.toStudentType;
                  const typeOnly =
                    typeMoved &&
                    u.fromClassId === u.toClassId &&
                    u.fromSectionId === u.toSectionId;
                  return (
                    <tr key={u.id}>
                      <td className="whitespace-nowrap px-2 py-2 text-xs text-[var(--muted)]">
                        {u.effectiveOn}
                        <div className="text-[10px]">
                          {new Date(u.createdAt).toLocaleString("en-IN")}
                        </div>
                      </td>
                      <td className="px-2 py-2">
                        <div className="font-medium text-[var(--brand-deep)]">
                          {u.studentName}
                        </div>
                        <div className="text-[11px] text-[var(--muted)]">
                          {u.admissionNo}
                        </div>
                      </td>
                      <td className="px-2 py-2">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                            typeOnly
                              ? "bg-[rgba(21,101,192,0.12)] text-[#1565c0]"
                              : classMoved
                                ? "bg-[rgba(197,160,40,0.2)] text-[var(--brand-deep)]"
                                : "bg-[rgba(32,48,80,0.08)] text-[var(--brand-mid)]"
                          }`}
                        >
                          {typeOnly
                            ? "Type"
                            : classMoved
                              ? "Class"
                              : sectionOnly
                                ? "Section"
                                : "Update"}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-xs">
                        {classSectionLabel(
                          u.fromClassId,
                          u.fromSectionId,
                          masters,
                        )}
                        <span className="mx-1 text-[var(--muted)]">→</span>
                        {classSectionLabel(
                          u.toClassId,
                          u.toSectionId,
                          masters,
                        )}
                      </td>
                      <td className="px-2 py-2 text-xs">
                        {u.fromStudentType || "—"}
                        <span className="mx-1 text-[var(--muted)]">→</span>
                        {u.toStudentType || "—"}
                      </td>
                      <td className="px-2 py-2 text-xs text-[var(--muted)]">
                        {feeGroupLabel(u.fromFeeGroupId, masters)}
                        <span className="mx-1">→</span>
                        {feeGroupLabel(u.toFeeGroupId, masters)}
                      </td>
                      <td className="px-2 py-2 text-xs text-[var(--muted)]">
                        {u.reason}
                      </td>
                    </tr>
                  );
                })}
              </ErpTableBody>
            </ErpTable>
          </div>
        )}
      </section>
    </div>
  );
}
