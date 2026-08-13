"use client";

import {
  CLASS_GROUPS,
  SESSION_MONTHS,
  STUDENT_TYPES,
  annualTotalForGroup,
  applyInstallmentPattern,
  checkFeeGroupRemoval,
  classesInGroup,
  cloneFeeSetupToAcademicYear,
  currentAcademicYearCode,
  ensureAprToMarInstallments,
  feeGroupClassBandLabel,
  formatInr,
  groupFeeGroupsByClassBand,
  midYearFeePolicySummary,
  newId,
  parseInrToPaise,
  removeFeeGroup,
  repairFeeGroupClassIds,
  sortClassIdsByClassBand,
  sortFeeGroupsByClassBand,
  type FeeGroup,
  type FeeStudentType,
  type InstallmentPattern,
  type LateFeeMode,
  type LateFeeRule,
  type MastersState,
} from "@/lib/masters";
import { EditControl } from "@/components/masters/EditControl";
import { RemoveControl } from "@/components/masters/RemoveControl";
import {
  MastersEmptyRow,
  MastersTabStack,
  MastersTableCard,
  MastersTablesRow,
  MastersWorkCard,
} from "@/components/masters/MastersLayout";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDemoSessionOptional } from "@/components/shell/SessionContext";

type Commit = (s: MastersState, msg?: string) => void;

/** Header-selected session, falling back to the masters "current" year. */
function useFeeSetupAy(state: MastersState): string {
  const session = useDemoSessionOptional();
  return session?.academicYearCode || currentAcademicYearCode(state);
}

/** Sessions that already have fee groups (copy sources), newest first. */
function feeSetupSourceYears(state: MastersState, excludeAy: string): string[] {
  return [
    ...new Set(
      state.feeGroups
        .filter((g) => g.isActive && g.academicYearCode)
        .map((g) => g.academicYearCode as string),
    ),
  ]
    .filter((code) => code !== excludeAy)
    .sort((a, b) => b.localeCompare(a));
}

/** Banner offering to copy a prior session's fee setup into an empty session. */
export function CopyFeeSetupBanner({
  state,
  commit,
  ay,
}: {
  state: MastersState;
  commit: Commit;
  ay: string;
}) {
  const sources = feeSetupSourceYears(state, ay);
  const [fromAy, setFromAy] = useState(sources[0] ?? "");
  const hasGroupsForAy = state.feeGroups.some(
    (g) => g.isActive && g.academicYearCode === ay,
  );
  useEffect(() => {
    if (!sources.includes(fromAy)) setFromAy(sources[0] ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources.join("|")]);

  if (hasGroupsForAy || sources.length === 0) return null;

  function copyNow() {
    if (!fromAy) return;
    const next = cloneFeeSetupToAcademicYear(state, fromAy, ay);
    if (next === state) {
      commit(state, `Nothing to copy from ${fromAy}`);
      return;
    }
    commit(
      next,
      `Fee setup copied ${fromAy} → ${ay} (groups + amounts, unpublished)`,
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[rgba(197,160,40,0.4)] bg-[rgba(197,160,40,0.08)] px-3 py-2.5 text-sm">
      <span className="text-[var(--brand-deep)]">
        <strong>No fee setup for {ay} yet.</strong> Copy groups &amp; amounts
        from
      </span>
      <select
        className="field !w-auto !py-1 !text-xs"
        value={fromAy}
        onChange={(e) => setFromAy(e.target.value)}
        aria-label="Copy fee setup from session"
      >
        {sources.map((code) => (
          <option key={code} value={code}>
            {code}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="btn-accent rounded-lg px-3 py-1.5 text-xs font-semibold"
        onClick={copyNow}
      >
        Copy to {ay}
      </button>
      <span className="text-xs text-[var(--muted)]">
        Copies fee groups, month amounts &amp; calendar — review, then publish.
      </span>
    </div>
  );
}

export function FeeGroupsPanel({
  state,
  commit,
}: {
  state: MastersState;
  commit: Commit;
}) {
  const ay = useFeeSetupAy(state);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [studentType, setStudentType] = useState<FeeStudentType>("NEW");
  const [selectedClasses, setSelectedClasses] = useState<string[]>([]);

  // Remap orphaned classIds (stale cls_* after roster rebuild) onto live classes — once
  const repairedRef = useRef(false);
  useEffect(() => {
    if (repairedRef.current) return;
    const repaired = repairFeeGroupClassIds(state);
    const changed =
      JSON.stringify(repaired.feeGroups.map((g) => [...g.classIds].sort())) !==
      JSON.stringify(state.feeGroups.map((g) => [...g.classIds].sort()));
    if (!changed) {
      repairedRef.current = true;
      return;
    }
    repairedRef.current = true;
    commit(repaired, "Fee groups re-linked to class bands");
  }, [state, commit]);

  const groupsForAy = useMemo(
    () =>
      state.feeGroups.filter(
        (g) => !g.academicYearCode || g.academicYearCode === ay,
      ),
    [state.feeGroups, ay],
  );

  const bandSections = useMemo(
    () => groupFeeGroupsByClassBand(state, groupsForAy),
    [state, groupsForAy],
  );

  const groupCount = groupsForAy.length;

  function resetForm() {
    setEditingId(null);
    setCode("");
    setName("");
    setStudentType("NEW");
    setSelectedClasses([]);
  }

  function startEdit(g: FeeGroup) {
    setEditingId(g.id);
    setCode(g.code);
    setName(g.name);
    setStudentType(g.studentType);
    setSelectedClasses(sortClassIdsByClassBand(state, g.classIds));
  }

  function toggleClass(classId: string) {
    setSelectedClasses((prev) =>
      sortClassIdsByClassBand(
        state,
        prev.includes(classId)
          ? prev.filter((id) => id !== classId)
          : [...prev, classId],
      ),
    );
  }

  function toggleClassBand(groupCode: (typeof CLASS_GROUPS)[number]["code"]) {
    const ids = classesInGroup(state.classes, groupCode).map((c) => c.id);
    if (!ids.length) return;
    setSelectedClasses((prev) => {
      const allOn = ids.every((id) => prev.includes(id));
      const next = allOn
        ? prev.filter((id) => !ids.includes(id))
        : [...new Set([...prev, ...ids])];
      return sortClassIdsByClassBand(state, next);
    });
  }

  function saveGroup(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim() || !name.trim()) return;
    const nextCode = code.trim().toUpperCase();
    if (
      state.feeGroups.some(
        (g) => g.code === nextCode && g.id !== editingId,
      )
    ) {
      commit(state, "Group code already exists");
      return;
    }

    const classIds = sortClassIdsByClassBand(state, selectedClasses);

    if (editingId) {
      commit(
        {
          ...state,
          feeGroups: sortFeeGroupsByClassBand(
            state,
            state.feeGroups.map((g) =>
              g.id === editingId
                ? {
                    ...g,
                    code: nextCode,
                    name: name.trim(),
                    studentType,
                    classIds,
                    academicYearCode: g.academicYearCode || ay,
                  }
                : g,
            ),
          ),
        },
        "Fee group updated",
      );
      resetForm();
      return;
    }

    const group: FeeGroup = {
      id: newId("fg"),
      code: nextCode,
      name: name.trim(),
      academicYearCode: ay,
      studentType,
      classIds,
      isActive: true,
      structurePublishedAt: null,
      structurePublishedBy: "",
    };
    commit(
      {
        ...state,
        feeGroups: sortFeeGroupsByClassBand(state, [
          ...state.feeGroups,
          group,
        ]),
      },
      "Fee group added — set amounts in Fee structure",
    );
    resetForm();
  }

  return (
    <div className="space-y-3">
    <CopyFeeSetupBanner state={state} commit={commit} ay={ay} />
    <MastersTabStack
      intro={
        <>
          Session <strong className="text-[var(--brand-deep)]">{ay}</strong> ·{" "}
          <strong className="text-[var(--brand-deep)]">New</strong> = admission
          bundle ·{" "}
          <strong className="text-[var(--brand-deep)]">Promoted</strong> =
          continuing ·{" "}
          <strong className="text-[var(--brand-deep)]">Mid-year</strong> = class
          group + mid-year rules (
          {midYearFeePolicySummary(state.midYearFeePolicy)}) ·{" "}
          <strong className="text-[var(--brand-deep)]">RTE</strong> = EWS.
          Listed by class band: Pre-Primary → Primary → Middle → Secondary →
          Senior.
        </>
      }
      tables={
        <MastersTablesRow cols={2}>
          <MastersTableCard
            title={`Fee groups · ${ay} · ${groupCount}`}
            maxHeight="max-h-[min(70vh,560px)]"
          >
            {groupCount === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-[var(--muted)]">
                No fee groups yet
              </div>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {bandSections.map((section) => {
                  const bandClasses =
                    section.key === "ALL"
                      ? []
                      : classesInGroup(
                          state.classes,
                          section.key as (typeof CLASS_GROUPS)[number]["code"],
                        );
                  return (
                    <li key={section.key}>
                      <div className="sticky top-0 z-[1] border-b border-[var(--border)] bg-[#eef2f8] px-4 py-2.5">
                        <div className="text-xs font-bold uppercase tracking-wide text-[var(--brand-deep)]">
                          {section.label}
                          <span className="ml-1.5 font-semibold text-[var(--brand-mid)]">
                            ({section.shortLabel})
                          </span>
                        </div>
                        {bandClasses.length > 0 ? (
                          <div className="mt-0.5 text-[11px] text-[var(--muted)]">
                            {bandClasses.map((c) => c.name).join(" · ")}
                          </div>
                        ) : null}
                      </div>
                      {section.groups.length === 0 ? (
                        <p className="px-4 py-3 text-[11px] text-[var(--muted)]">
                          No fee group for this band yet
                        </p>
                      ) : (
                        <ul className="divide-y divide-[var(--border)]">
                          {section.groups.map((g) => {
                            const total = annualTotalForGroup(state, g.id);
                            const orderedIds = sortClassIdsByClassBand(
                              state,
                              g.classIds,
                            );
                            const classLabel =
                              orderedIds.length === 0
                                ? "All classes"
                                : orderedIds
                                    .map(
                                      (id) =>
                                        state.classes.find((c) => c.id === id)
                                          ?.name ?? id,
                                    )
                                    .join(", ");
                            const bandSpan = feeGroupClassBandLabel(state, g);
                            const typeLabel =
                              STUDENT_TYPES.find(
                                (t) => t.value === g.studentType,
                              )?.label ?? g.studentType;
                            return (
                              <li
                                key={g.id}
                                className="flex items-start justify-between gap-3 px-4 py-3"
                              >
                                <div>
                                  <div className="font-medium text-[var(--brand-deep)]">
                                    {g.name}{" "}
                                    <span className="text-xs font-normal text-[var(--muted)]">
                                      {g.code}
                                    </span>
                                  </div>
                                  <div className="mt-0.5 text-xs text-[var(--muted)]">
                                    {typeLabel} · {bandSpan}
                                    {!g.isActive ? " · inactive" : ""}
                                  </div>
                                  <div className="mt-0.5 text-[11px] text-[var(--muted)]">
                                    {classLabel}
                                  </div>
                                  <div className="mt-1 text-sm font-semibold text-[var(--brand-deep)]">
                                    {formatInr(total)}
                                    <span className="ml-1 text-xs font-normal text-[var(--muted)]">
                                      / year
                                    </span>
                                  </div>
                                </div>
                                <div className="flex shrink-0 flex-col items-end gap-1.5">
                                  <EditControl
                                    active={editingId === g.id}
                                    onEdit={() => startEdit(g)}
                                  />
                                  <button
                                    type="button"
                                    className="text-xs font-medium text-[var(--brand-mid)]"
                                    onClick={() =>
                                      commit(
                                        {
                                          ...state,
                                          feeGroups: state.feeGroups.map(
                                            (x) =>
                                              x.id === g.id
                                                ? {
                                                    ...x,
                                                    isActive: !x.isActive,
                                                  }
                                                : x,
                                          ),
                                        },
                                        g.isActive
                                          ? "Group inactivated"
                                          : "Group activated",
                                      )
                                    }
                                  >
                                    {g.isActive ? "Inactivate" : "Activate"}
                                  </button>
                                  <RemoveControl
                                    check={checkFeeGroupRemoval(state, g.id)}
                                    onRemove={() => {
                                      const result = removeFeeGroup(
                                        state,
                                        g.id,
                                      );
                                      if (!result.ok) {
                                        commit(state, result.reason);
                                        return;
                                      }
                                      if (editingId === g.id) resetForm();
                                      commit(result.state, "Fee group removed");
                                    }}
                                  />
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </MastersTableCard>

          <MastersWorkCard
            title={editingId ? "Edit fee group" : "Add fee group"}
            hint="Pick classes by band — saved in Pre-Primary → Senior order"
          >
            <form onSubmit={saveGroup} className="space-y-1">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Code">
                  <input
                    className="field"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="NEW_NUR_V"
                    required
                  />
                </Field>
                <Field label="Name">
                  <input
                    className="field"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="New admission · Nursery–V"
                    required
                  />
                </Field>
              </div>
              <Field label="Student type">
                <select
                  className="field"
                  value={studentType}
                  onChange={(e) =>
                    setStudentType(e.target.value as FeeStudentType)
                  }
                >
                  {STUDENT_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="mt-3">
                <div className="mb-1.5 text-sm text-[var(--muted)]">
                  Classes by band (leave empty = all)
                </div>
                <div className="max-h-[min(40vh,320px)] space-y-3 overflow-y-auto rounded-xl border border-[var(--border)] p-2">
                  {CLASS_GROUPS.map((band) => {
                    const classes = classesInGroup(state.classes, band.code);
                    if (!classes.length) return null;
                    const ids = classes.map((c) => c.id);
                    const allOn = ids.every((id) =>
                      selectedClasses.includes(id),
                    );
                    const someOn =
                      !allOn && ids.some((id) => selectedClasses.includes(id));
                    return (
                      <div key={band.code}>
                        <div className="mb-1.5 flex items-center justify-between gap-2">
                          <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--brand-deep)]">
                            {band.label}
                            <span className="ml-1 font-normal text-[var(--muted)]">
                              ({band.shortLabel})
                            </span>
                          </span>
                          <button
                            type="button"
                            onClick={() => toggleClassBand(band.code)}
                            className="text-[11px] font-medium text-[var(--brand-mid)]"
                          >
                            {allOn
                              ? "Clear"
                              : someOn
                                ? "Select all"
                                : "Select band"}
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {classes.map((c) => {
                            const on = selectedClasses.includes(c.id);
                            return (
                              <button
                                key={c.id}
                                type="button"
                                onClick={() => toggleClass(c.id)}
                                className={`rounded-lg px-2 py-1 text-xs font-medium ${
                                  on
                                    ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                                    : "bg-[var(--surface)] text-[var(--brand-deep)]"
                                }`}
                              >
                                {c.name}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="mt-4 flex gap-2">
                {editingId ? (
                  <button
                    type="button"
                    className="rounded-xl border border-[var(--border)] px-4 py-2.5 text-sm font-semibold text-[var(--brand-deep)]"
                    onClick={resetForm}
                  >
                    Cancel
                  </button>
                ) : null}
                <button
                  type="submit"
                  className="btn-accent flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold"
                >
                  {editingId ? "Update fee group" : "Save fee group"}
                </button>
              </div>
            </form>
          </MastersWorkCard>
        </MastersTablesRow>
      }
    />
    </div>
  );
}

export function InstallmentsPanel({
  state,
  commit,
}: {
  state: MastersState;
  commit: Commit;
}) {
  const ay = useFeeSetupAy(state);
  const list = state.installments
    .filter((i) => i.academicYearCode === ay)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const activeCount = list.filter((i) => i.isActive).length;

  function ensureCalendar() {
    commit(
      ensureAprToMarInstallments(state, ay),
      "Apr–Mar session calendar ready",
    );
  }

  function applyPattern(pattern: InstallmentPattern) {
    const labels = {
      monthly: "Monthly Apr–Mar (12 dues)",
      quarterly: "Quarterly (Apr, Jul, Oct, Jan)",
      half_yearly: "Half-yearly (Apr, Oct)",
    };
    commit(applyInstallmentPattern(state, pattern, ay), labels[pattern]);
  }

  function toggleMonth(code: string) {
    const next = ensureAprToMarInstallments(state, ay);
    commit(
      {
        ...next,
        installments: next.installments.map((i) =>
          i.academicYearCode === ay && i.code === code
            ? { ...i, isActive: !i.isActive }
            : i,
        ),
      },
      `Toggled ${code}`,
    );
  }

  function updateDue(id: string, due: string) {
    commit(
      {
        ...state,
        installments: state.installments.map((i) =>
          i.id === id ? { ...i, dueOn: due } : i,
        ),
      },
      "Due date updated",
    );
  }

  function updateDueDay(day: number) {
    const d = Math.min(28, Math.max(1, day));
    const next = ensureAprToMarInstallments(state, ay);
    commit(
      {
        ...next,
        installments: next.installments.map((i) => {
          if (i.academicYearCode !== ay) return i;
          const meta = SESSION_MONTHS.find((m) => m.code === i.code);
          if (!meta) return i;
          return {
            ...i,
            dueOn: i.dueOn.replace(/-\d{2}$/, `-${String(d).padStart(2, "0")}`),
          };
        }),
      },
      `Due day set to ${d} for all months`,
    );
  }

  return (
    <MastersTabStack
      intro="Turn months on/off for collection. Then in Fee structure, attach heads to installments."
      tables={
        <MastersTablesRow>
          <MastersTableCard
            title={`Session months · ${ay}`}
            maxHeight="none"
          >
            <div className="p-4">
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {SESSION_MONTHS.map((m) => {
                  const row = list.find((i) => i.code === m.code);
                  const on = row?.isActive ?? false;
                  return (
                    <button
                      key={m.code}
                      type="button"
                      onClick={() => toggleMonth(m.code)}
                      className={`rounded-xl px-2 py-3 text-center transition ${
                        on
                          ? "bg-[var(--primary)] text-[var(--primary-foreground)] shadow-sm"
                          : "bg-[var(--surface)] text-[var(--muted)] ring-1 ring-[var(--border)]"
                      }`}
                    >
                      <div className="text-xs font-bold tracking-wide">
                        {m.code}
                      </div>
                      <div className="mt-0.5 text-[11px] opacity-90">
                        {m.label}
                      </div>
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 text-xs text-[var(--muted)]">
                {activeCount} of 12 months active
              </p>
            </div>
          </MastersTableCard>
          <MastersTableCard title="Due dates (edit individually)">
            <ul className="divide-y divide-[var(--border)]">
              {list.map((i) => (
                <li
                  key={i.id}
                  className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 ${
                    i.isActive ? "" : "opacity-50"
                  }`}
                >
                  <div className="font-medium text-[var(--brand-deep)]">
                    {i.label}{" "}
                    <span className="text-xs font-normal text-[var(--muted)]">
                      {i.code}
                      {!i.isActive ? " · off" : ""}
                    </span>
                  </div>
                  <input
                    type="date"
                    className="field max-w-[160px]"
                    value={i.dueOn}
                    disabled={!i.isActive}
                    onChange={(e) => updateDue(i.id, e.target.value)}
                  />
                </li>
              ))}
            </ul>
          </MastersTableCard>
        </MastersTablesRow>
      }
      work={
        <MastersWorkCard title="Due pattern & day" hint="Working controls">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-accent rounded-lg px-3 py-2 text-xs font-semibold"
              onClick={() => applyPattern("monthly")}
            >
              All 12 months (monthly)
            </button>
            <button
              type="button"
              className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--brand-deep)]"
              onClick={() => applyPattern("quarterly")}
            >
              Quarterly (4)
            </button>
            <button
              type="button"
              className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--brand-deep)]"
              onClick={() => applyPattern("half_yearly")}
            >
              Half-yearly (2)
            </button>
            <button
              type="button"
              className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-medium text-[var(--brand-mid)]"
              onClick={ensureCalendar}
            >
              Sync Apr–Mar rows
            </button>
          </div>
          <label className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-[var(--muted)]">Due day each month</span>
            <input
              type="number"
              min={1}
              max={28}
              defaultValue={10}
              className="field max-w-[88px]"
              onBlur={(e) => updateDueDay(Number(e.target.value) || 10)}
            />
          </label>
        </MastersWorkCard>
      }
    />
  );
}

export function LateFeePanel({
  state,
  commit,
}: {
  state: MastersState;
  commit: Commit;
}) {
  const ay = useFeeSetupAy(state);
  // Key by session so the form re-initializes from that session's rule.
  return <LateFeePanelInner key={ay} state={state} commit={commit} ay={ay} />;
}

function LateFeePanelInner({
  state,
  commit,
  ay,
}: {
  state: MastersState;
  commit: Commit;
  ay: string;
}) {
  const rule = state.lateFeeRules.find(
    (r) => r.academicYearCode === ay,
  );
  const activeHeads = state.feeHeads.filter((h) => h.isActive);
  const defaultIds =
    rule?.feeHeadIds?.length
      ? rule.feeHeadIds
      : rule?.feeHeadId
        ? [rule.feeHeadId]
        : state.feeHeads.find((h) => h.code === "LATE")
          ? [state.feeHeads.find((h) => h.code === "LATE")!.id]
          : [];

  const [feeHeadIds, setFeeHeadIds] = useState<string[]>(defaultIds);
  const [graceDays, setGraceDays] = useState(String(rule?.graceDays ?? 7));
  const [mode, setMode] = useState<LateFeeMode>(rule?.mode ?? "flat");
  const [value, setValue] = useState(
    rule
      ? rule.mode === "flat"
        ? String(rule.value / 100)
        : String(rule.value / 100)
      : "100",
  );
  const [maxAmt, setMaxAmt] = useState(
    rule?.maxAmountPaise != null
      ? String(rule.maxAmountPaise / 100)
      : "500",
  );

  function toggleHead(id: string) {
    setFeeHeadIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function selectAllHeads() {
    setFeeHeadIds(activeHeads.map((h) => h.id));
  }

  function clearHeads() {
    setFeeHeadIds([]);
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    if (feeHeadIds.length === 0) return;
    const next: LateFeeRule = {
      id: rule?.id ?? newId("lfr"),
      academicYearCode: ay,
      graceDays: Math.max(0, Number(graceDays) || 0),
      mode,
      value:
        mode === "flat"
          ? parseInrToPaise(value)
          : Math.round(Number(value) * 100),
      feeHeadId: feeHeadIds[0]!,
      feeHeadIds,
      maxAmountPaise: maxAmt.trim() ? parseInrToPaise(maxAmt) : null,
      isActive: true,
    };
    const lateFeeRules = rule
      ? state.lateFeeRules.map((r) => (r.id === rule.id ? next : r))
      : [...state.lateFeeRules, next];
    commit({ ...state, lateFeeRules }, "Late-fee rule saved");
  }

  const selectedNames = activeHeads
    .filter((h) => feeHeadIds.includes(h.id))
    .map((h) => h.nameEn);

  return (
    <div className="max-w-lg rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
      <h3 className="text-sm font-semibold text-[var(--brand-deep)]">
        Late-fee policy · {ay}
      </h3>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Applied after grace days on unpaid installments. Select one or more fee
        heads this late-fee rule applies to.
      </p>
      <form onSubmit={save} className="mt-4 space-y-1">
        <div className="mt-3">
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-[var(--muted)]">Fee heads</span>
            <span className="flex gap-2 text-xs">
              <button
                type="button"
                className="text-[var(--brand-mid)] underline-offset-2 hover:underline"
                onClick={selectAllHeads}
              >
                Select all
              </button>
              <button
                type="button"
                className="text-[var(--brand-mid)] underline-offset-2 hover:underline"
                onClick={clearHeads}
              >
                Clear
              </button>
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5 rounded-xl border border-[var(--border)] p-2">
            {activeHeads.map((h) => {
              const on = feeHeadIds.includes(h.id);
              return (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => toggleHead(h.id)}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-medium ${
                    on
                      ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                      : "bg-[var(--surface)] text-[var(--brand-deep)]"
                  }`}
                >
                  {h.nameEn}
                </button>
              );
            })}
            {activeHeads.length === 0 ? (
              <p className="px-1 py-2 text-xs text-[var(--muted)]">
                No fee heads — add under Fee heads
              </p>
            ) : null}
          </div>
          <p className="mt-1.5 text-xs text-[var(--muted)]">
            {feeHeadIds.length} selected
            {selectedNames.length
              ? `: ${selectedNames.slice(0, 4).join(", ")}${
                  selectedNames.length > 4 ? "…" : ""
                }`
              : ""}
          </p>
        </div>
        <Field label="Grace days after due date">
          <input
            className="field"
            value={graceDays}
            onChange={(e) => setGraceDays(e.target.value)}
            inputMode="numeric"
          />
        </Field>
        <Field label="Mode">
          <select
            className="field"
            value={mode}
            onChange={(e) => setMode(e.target.value as LateFeeMode)}
          >
            <option value="flat">Flat ₹ per overdue installment</option>
            <option value="percent">Percent of overdue amount</option>
          </select>
        </Field>
        <Field label={mode === "flat" ? "Amount (₹)" : "Percent (%)"}>
          <input
            className="field"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            inputMode="decimal"
          />
        </Field>
        <Field label="Cap / max (₹, optional)">
          <input
            className="field"
            value={maxAmt}
            onChange={(e) => setMaxAmt(e.target.value)}
            inputMode="decimal"
            placeholder="500"
          />
        </Field>
        <button
          type="submit"
          className="btn-accent mt-4 w-full rounded-xl px-4 py-2.5 text-sm font-semibold"
          disabled={feeHeadIds.length === 0}
        >
          Save late-fee rule
        </button>
      </form>
      {rule ? (
        <p className="mt-4 text-xs text-[var(--muted)]">
          Current: {(rule.feeHeadIds?.length ? rule.feeHeadIds : [rule.feeHeadId])
            .map(
              (id) => state.feeHeads.find((h) => h.id === id)?.nameEn ?? "—",
            )
            .join(", ")}{" "}
          · {rule.graceDays}d grace ·{" "}
          {rule.mode === "flat"
            ? formatInr(rule.value)
            : `${rule.value / 100}%`}
          {rule.maxAmountPaise != null
            ? ` · max ${formatInr(rule.maxAmountPaise)}`
            : ""}
        </p>
      ) : null}
    </div>
  );
}

function ListCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)]">
      <div className="border-b border-[var(--border)] px-4 py-3 text-sm font-semibold text-[var(--brand-deep)]">
        {title}
      </div>
      {children}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="mt-3 block text-sm">
      <span className="mb-1.5 block text-[var(--muted)]">{label}</span>
      {children}
    </label>
  );
}

export function MidYearFeePolicyPanel({
  state,
  commit,
}: {
  state: MastersState;
  commit: Commit;
}) {
  const policy = state.midYearFeePolicy;

  function setFlag(key: keyof typeof policy, value: boolean) {
    commit(
      {
        ...state,
        midYearFeePolicy: { ...policy, [key]: value },
      },
      "Mid-year fee policy saved",
    );
  }

  function resetDefaults() {
    commit(
      {
        ...state,
        midYearFeePolicy: {
          skipMonthsBeforeJoin: true,
          alwaysBillAprilAcademic: true,
          transportFromJoinMonthOnly: true,
          includeOneTimeBeforeJoin: true,
        },
      },
      "Restored recommended mid-year rules",
    );
  }

  const rows: {
    key: keyof typeof policy;
    title: string;
    blurb: string;
  }[] = [
    {
      key: "skipMonthsBeforeJoin",
      title: "Skip months before join month",
      blurb:
        "May–join−1 are not billed (e.g. join in Sep → skip May–Aug).",
    },
    {
      key: "alwaysBillAprilAcademic",
      title: "Always take April academic fees",
      blurb:
        "April tuition / academic heads are billed even when join is later. Transport is not included here.",
    },
    {
      key: "transportFromJoinMonthOnly",
      title: "Transport only from join month",
      blurb:
        "No transport for April catch-up or any month before the student joined.",
    },
    {
      key: "includeOneTimeBeforeJoin",
      title: "Keep admission / annual / one-time",
      blurb:
        "One-time and annual heads still apply even if their due month is before join.",
    },
  ];

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <ListCard title="Mid-year join · school fee rules">
        <div className="space-y-4 px-4 py-4">
          <p className="text-[12px] leading-snug text-[var(--muted)]">
            Applies when student type is <strong>Mid-year join</strong> and{" "}
            <strong>Joined on</strong> is set. Recommended default matches
            common CBSE practice: April academic (no transport) + skip months
            before join + transport from join month onward.
          </p>
          <ul className="space-y-3">
            {rows.map((row) => (
              <li
                key={row.key}
                className="flex items-start justify-between gap-3 rounded-xl border border-[var(--border)] px-3 py-2.5"
              >
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-[var(--brand-deep)]">
                    {row.title}
                  </div>
                  <p className="mt-0.5 text-[11px] leading-snug text-[var(--muted)]">
                    {row.blurb}
                  </p>
                </div>
                <label className="flex shrink-0 items-center gap-2 text-xs font-semibold text-[var(--brand-deep)]">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={policy[row.key]}
                    onChange={(e) => setFlag(row.key, e.target.checked)}
                  />
                  {policy[row.key] ? "On" : "Off"}
                </label>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] pt-3">
            <p className="text-[11px] text-[var(--muted)]">
              Example (defaults on, join Sep): April tuition billed · May–Aug
              skipped · Sep–Mar full (incl. transport).
            </p>
            <button
              type="button"
              className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-[11px] font-semibold"
              onClick={resetDefaults}
            >
              Reset to recommended
            </button>
          </div>
        </div>
      </ListCard>
    </div>
  );
}
