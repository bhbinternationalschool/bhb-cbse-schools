"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  STUDENT_TYPES,
  STUDENT_TYPE_HINTS,
  annualTotalForGroup,
  checkClearFeeGroupStructure,
  checkStructureLineRemoval,
  classesForFeeGroup,
  clearFeeGroupStructure,
  currentAcademicYearCode,
  ensureAprToMarInstallments,
  feeFrequencyScheduleLabel,
  formatInr,
  groupFeeGroupsByClassBand,
  installmentCodesForFeeFrequency,
  newId,
  parseInrToPaise,
  publishFeeGroupStructure,
  sortFeeGroupsByClassBand,
  type FeeStructureLine,
  type FeeStudentType,
  type MastersState,
} from "@/lib/masters";
import {
  assignFeeGroupToMatchingStudents,
  previewFeeStructureImpact,
  syncAllStudentFeeGroups,
} from "@/lib/fees";
import { RemoveControl } from "@/components/masters/RemoveControl";
import {
  MastersEmptyRow,
  MastersTableCard,
} from "@/components/masters/MastersLayout";
import { useDemoSession } from "@/components/shell/SessionContext";
import { ModuleTabs } from "@/components/ui/ModuleTabs";
import { CopyFeeSetupBanner } from "@/components/masters/FeeSetupPanels";

type Commit = (s: MastersState, msg?: string) => void;

type StructureTab = FeeStudentType;

/**
 * Fee structure board:
 * - Tabs by student type (New / Promoted / Mid-year / RTE)
 * - Groups list (left) sorted by class band · month editor (right)
 * - Class scope: all classes (default) or class-specific override amounts
 * - Apr–Mar month cards; publish marks group ready for Fee Take
 */
export function FeeStructurePanel({
  state,
  commit,
}: {
  state: MastersState;
  commit: Commit;
}) {
  const session = useDemoSession();
  // Follow the header session selector; fall back to the masters current year.
  const ay = session.academicYearCode || currentAcademicYearCode(state);
  const [tab, setTab] = useState<StructureTab>("NEW");
  const [classScope, setClassScope] = useState<string>(""); // "" = all / default
  const [sisTick, setSisTick] = useState(0);

  const groupsForTab = useMemo(
    () =>
      sortFeeGroupsByClassBand(
        state,
        state.feeGroups.filter(
          (g) =>
            g.isActive &&
            g.academicYearCode === ay &&
            g.studentType === tab,
        ),
      ),
    [state, ay, tab],
  );

  const bandSections = useMemo(
    () => groupFeeGroupsByClassBand(state, groupsForTab),
    [state, groupsForTab],
  );

  const [groupId, setGroupId] = useState(groupsForTab[0]?.id ?? "");

  useEffect(() => {
    if (!groupsForTab.some((g) => g.id === groupId)) {
      setGroupId(groupsForTab[0]?.id ?? "");
    }
  }, [groupsForTab, groupId]);

  useEffect(() => {
    setClassScope("");
  }, [groupId]);

  const months = useMemo(() => {
    const next = ensureAprToMarInstallments(state, ay);
    return next.installments
      .filter((i) => i.academicYearCode === ay)
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [state, ay]);

  const firstMonth = months[0];
  const group = state.feeGroups.find((g) => g.id === groupId);
  const groupClasses = group ? classesForFeeGroup(state, group) : [];

  const linesForGroup = useMemo(
    () => state.feeStructureLines.filter((l) => l.feeGroupId === groupId),
    [state.feeStructureLines, groupId],
  );

  function linesForMonth(installmentId: string) {
    return linesForGroup.filter((l) => {
      if (l.installmentId !== installmentId) return false;
      if (classScope === "") return l.classId == null;
      return l.classId === classScope;
    });
  }

  function monthTotal(installmentId: string) {
    return linesForMonth(installmentId).reduce((s, l) => s + l.amountPaise, 0);
  }

  const yearTotal = groupId
    ? annualTotalForGroup(
        state,
        groupId,
        classScope === "" ? null : classScope,
      )
    : 0;

  const impact = useMemo(() => {
    void sisTick;
    if (!groupId) {
      return {
        studentCount: 0,
        dueLineCount: 0,
        totalBilledPaise: 0,
        unassignedMatching: 0,
      };
    }
    return previewFeeStructureImpact(groupId, state);
  }, [groupId, state, sisTick]);

  function addHeadToMonth(
    installmentId: string,
    feeHeadId: string,
    amountPaise: number,
    copyToAll: boolean,
  ) {
    if (!groupId || !feeHeadId) return;
    const scopeClassId = classScope === "" ? null : classScope;
    const head = state.feeHeads.find((h) => h.id === feeHeadId);

    let next = ensureAprToMarInstallments(state, ay);
    const ayMonths = next.installments.filter(
      (i) => i.academicYearCode === ay,
    );

    let targetMonths = ayMonths.filter((i) => i.id === installmentId);
    if (copyToAll) {
      const codes = installmentCodesForFeeFrequency(head?.frequency);
      if (codes.length === 0) {
        // as_needed — stay on the source month only
        targetMonths = ayMonths.filter((i) => i.id === installmentId);
      } else {
        const codeSet = new Set(codes);
        targetMonths = ayMonths.filter((i) => codeSet.has(i.code));
        // If schedule months missing (odd calendar), fall back to source
        if (targetMonths.length === 0) {
          targetMonths = ayMonths.filter((i) => i.id === installmentId);
        }
      }
    }

    next = {
      ...next,
      installments: next.installments.map((i) =>
        targetMonths.some((t) => t.id === i.id) ? { ...i, isActive: true } : i,
      ),
    };

    let lines = [...next.feeStructureLines];
    const targetIds = new Set(targetMonths.map((m) => m.id));

    // When spreading by frequency, clear this head from other months in the AY
    // so monthly→quarterly etc. does not leave stale copies.
    if (copyToAll) {
      lines = lines.filter((l) => {
        if (l.feeGroupId !== groupId || l.feeHeadId !== feeHeadId) return true;
        if ((l.classId ?? null) !== scopeClassId) return true;
        if (!l.installmentId) return true;
        const inst = ayMonths.find((i) => i.id === l.installmentId);
        if (!inst) return true;
        return targetIds.has(l.installmentId);
      });
    }

    for (const m of targetMonths) {
      const existing = lines.find(
        (l) =>
          l.feeGroupId === groupId &&
          l.feeHeadId === feeHeadId &&
          l.installmentId === m.id &&
          (l.classId ?? null) === scopeClassId,
      );
      if (existing) {
        lines = lines.map((l) =>
          l.id === existing.id ? { ...l, amountPaise } : l,
        );
      } else {
        lines.push({
          id: newId("fsl"),
          feeGroupId: groupId,
          feeHeadId,
          classId: scopeClassId,
          amountPaise,
          installmentId: m.id,
        });
      }
    }

    const schedule = feeFrequencyScheduleLabel(head?.frequency);
    commit(
      { ...next, feeStructureLines: lines },
      copyToAll
        ? `Placed on ${schedule} (${targetMonths.length} month${
            targetMonths.length === 1 ? "" : "s"
          })${scopeClassId ? " · class override" : ""}`
        : scopeClassId
          ? "Class override amount saved"
          : "Head added to month",
    );
  }

  function updateLineAmount(lineId: string, raw: string) {
    commit(
      {
        ...state,
        feeStructureLines: state.feeStructureLines.map((l) =>
          l.id === lineId ? { ...l, amountPaise: parseInrToPaise(raw) } : l,
        ),
      },
      "Amount updated",
    );
  }

  function removeLine(lineId: string) {
    commit(
      {
        ...state,
        feeStructureLines: state.feeStructureLines.filter(
          (l) => l.id !== lineId,
        ),
      },
      "Head removed from month",
    );
  }

  function copyLineToAllMonths(line: FeeStructureLine) {
    if (!line.installmentId || !groupId) return;
    addHeadToMonth(line.installmentId, line.feeHeadId, line.amountPaise, true);
  }

  function onPublish() {
    if (!groupId) return;
    const result = publishFeeGroupStructure(
      state,
      groupId,
      session.fullName,
    );
    if (!result.ok) {
      commit(state, result.error);
      return;
    }
    commit(
      result.state,
      `Published for Fee Take · ${impact.studentCount} student(s) · ${formatInr(impact.totalBilledPaise)} session bill`,
    );
  }

  function onAssignStudents() {
    if (!groupId) return;
    const result = assignFeeGroupToMatchingStudents(groupId);
    if (!result.ok) {
      commit(state, result.error);
      return;
    }
    commit(
      state,
      `Assigned fee group to ${result.assigned} student${result.assigned === 1 ? "" : "s"}`,
    );
    setSisTick((x) => x + 1);
  }

  function onSyncGroup() {
    if (!groupId) return;
    const result = assignFeeGroupToMatchingStudents(groupId, {
      overwrite: true,
    });
    if (!result.ok) {
      commit(state, result.error);
      return;
    }
    commit(
      state,
      `Synced ${result.assigned} student${result.assigned === 1 ? "" : "s"} onto this group`,
    );
    setSisTick((x) => x + 1);
  }

  function onSyncAllByType() {
    const result = syncAllStudentFeeGroups({ overwrite: true });
    commit(
      state,
      result.updated > 0
        ? `Synced fee groups for ${result.updated} student${result.updated === 1 ? "" : "s"} from type + class`
        : "All students already match type + class fee groups",
    );
    setSisTick((x) => x + 1);
  }

  function onClearAllFees() {
    if (!groupId) return;
    const result = clearFeeGroupStructure(
      state,
      groupId,
      impact.studentCount,
    );
    if (!result.ok) {
      commit(state, result.reason);
      return;
    }
    commit(
      result.state,
      `Cleared ${result.removed} fee line${result.removed === 1 ? "" : "s"} — no students on this group`,
    );
  }

  const usableHeads = state.feeHeads.filter(
    (h) => h.isActive && h.code !== "LATE",
  );

  const structureLineCount = linesForGroup.length;
  const clearCheck = checkClearFeeGroupStructure(
    impact.studentCount,
    structureLineCount,
  );

  const classNameOf = (id: string | null) =>
    id
      ? (state.classes.find((c) => c.id === id)?.name ?? "Class")
      : "All classes";

  return (
    <div className="space-y-4">
      <CopyFeeSetupBanner state={state} commit={commit} ay={ay} />
      <p className="rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] px-3 py-2 text-[11px] leading-snug text-[var(--muted)]">
        <strong className="text-[var(--brand-deep)]">
          Session {ay} · New vs old assignment:
        </strong>{" "}
        {STUDENT_TYPE_HINTS[tab]} Configure mid-year April / skip / transport
        under Masters → Mid-year. Promote in Exams switches to Promoted groups.
        Groups list in class-band order (Pre-Primary → Senior).
      </p>
      <ModuleTabs
        aria-label="Fee structure by student type"
        value={tab}
        onChange={(id) => setTab(id as FeeStudentType)}
        items={STUDENT_TYPES.map((t, i) => {
          const n = state.feeGroups.filter(
            (g) =>
              g.isActive &&
              g.academicYearCode === ay &&
              g.studentType === t.value,
          ).length;
          const tones = ["navy", "teal", "amber", "rose"] as const;
          return {
            id: t.value,
            label: t.label,
            badge: n,
            tone: tones[i % tones.length],
          };
        })}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(260px,340px)_minmax(0,1fr)]">
        <MastersTableCard
          title={`Fee groups · ${ay}`}
          maxHeight="max-h-[min(70vh,640px)]"
        >
          {groupsForTab.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-[var(--muted)]">
              No groups for this tab
            </div>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {bandSections.map((section) => (
                <li key={section.key}>
                  <div className="sticky top-0 z-[1] border-b border-[var(--border)] bg-[#eef2f8] px-4 py-2.5">
                    <div className="text-xs font-bold uppercase tracking-wide text-[var(--brand-deep)]">
                      {section.label}
                      <span className="ml-1.5 font-semibold text-[var(--brand-mid)]">
                        ({section.shortLabel})
                      </span>
                    </div>
                  </div>
                  {section.groups.length === 0 ? (
                    <p className="px-4 py-2.5 text-[11px] text-[var(--muted)]">
                      No group in this band
                    </p>
                  ) : (
                    <ul className="divide-y divide-[var(--border)]">
                      {section.groups.map((g) => {
                        const on = g.id === groupId;
                        const classLabel =
                          g.classIds.length === 0
                            ? "All classes"
                            : classesForFeeGroup(state, g)
                                .map((c) => c.name)
                                .join(", ");
                        return (
                          <li key={g.id}>
                            <button
                              type="button"
                              onClick={() => setGroupId(g.id)}
                              className={`w-full px-4 py-3 text-left transition ${
                                on
                                  ? "bg-[var(--surface-sunken)]"
                                  : "hover:bg-[var(--surface-sunken)]"
                              }`}
                            >
                              <div className="flex items-center gap-1.5">
                                <span
                                  className={`text-sm ${
                                    on
                                      ? "font-semibold text-[var(--brand-deep)]"
                                      : "font-medium text-[var(--brand-deep)]"
                                  }`}
                                >
                                  {g.name}
                                </span>
                                {g.structurePublishedAt ? (
                                  <span
                                    className="rounded bg-[rgba(21,128,61,0.12)] px-1 py-0.5 text-[9px] font-semibold text-[var(--success)]"
                                    title="Published"
                                  >
                                    Live
                                  </span>
                                ) : null}
                              </div>
                              <div className="mt-0.5 text-[11px] text-[var(--muted)]">
                                {g.code} · {classLabel}
                              </div>
                              <div className="mt-1 text-sm font-semibold text-[var(--brand-deep)]">
                                {formatInr(annualTotalForGroup(state, g.id))}
                                <span className="ml-1 text-xs font-normal text-[var(--muted)]">
                                  / year
                                </span>
                              </div>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </MastersTableCard>

        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-[var(--brand-deep)]">
                {group?.name ?? "Select a fee group"}
              </h3>
              <p className="text-xs text-[var(--muted)]">
                {ay} ·{" "}
                {classScope
                  ? `Class override · ${classNameOf(classScope)}`
                  : "Default amounts (all classes in group)"}
              </p>
            </div>
            {group ? (
              <p className="text-sm text-[var(--muted)]">
                Year total{" "}
                <strong className="text-[var(--brand-deep)]">
                  {formatInr(yearTotal)}
                </strong>
              </p>
            ) : null}
          </div>

          {group ? (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2.5">
              <label className="flex items-center gap-2 text-xs text-[var(--brand-deep)]">
                <span className="text-[var(--muted)]">Class scope</span>
                <select
                  className="field !py-1 !text-xs"
                  value={classScope}
                  onChange={(e) => setClassScope(e.target.value)}
                >
                  <option value="">All classes (default)</option>
                  {groupClasses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <span className="text-[11px] text-[var(--muted)]">
                Class amounts override the default for the same head &amp;
                month.
              </span>
            </div>
          ) : null}

          {group ? (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[rgba(197,160,40,0.35)] bg-[rgba(197,160,40,0.08)] px-3 py-2.5 text-xs">
              <div className="text-[var(--brand-deep)]">
                <strong>Fee Take impact:</strong> {impact.studentCount} student
                {impact.studentCount === 1 ? "" : "s"} on this group ·{" "}
                {impact.dueLineCount} due line
                {impact.dueLineCount === 1 ? "" : "s"} ·{" "}
                {formatInr(impact.totalBilledPaise)}
                {impact.unassignedMatching > 0 ? (
                  <span className="ml-1 text-[var(--muted)]">
                    · {impact.unassignedMatching} matching student
                    {impact.unassignedMatching === 1 ? "" : "s"} without a group
                  </span>
                ) : null}
                {group.structurePublishedAt ? (
                  <span className="ml-1 block text-[var(--muted)] sm:inline">
                    Published{" "}
                    {group.structurePublishedAt.slice(0, 16).replace("T", " ")}
                    {group.structurePublishedBy
                      ? ` by ${group.structurePublishedBy}`
                      : ""}
                  </span>
                ) : (
                  <span className="ml-1 text-[var(--muted)]">
                    · Not published yet
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {impact.unassignedMatching > 0 ? (
                  <button
                    type="button"
                    className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-2.5 py-1 text-[11px] font-semibold"
                    onClick={onAssignStudents}
                  >
                    Assign to matching students
                  </button>
                ) : null}
                <button
                  type="button"
                  className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-2.5 py-1 text-[11px] font-semibold"
                  onClick={onSyncGroup}
                >
                  Sync this group
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-2.5 py-1 text-[11px] font-semibold"
                  onClick={onSyncAllByType}
                >
                  Sync all by type + class
                </button>
                <button
                  type="button"
                  className="btn-accent rounded-lg px-2.5 py-1 text-[11px] font-semibold"
                  onClick={onPublish}
                >
                  Publish for Fee Take
                </button>
                <Link
                  href="/fees"
                  className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-2.5 py-1 text-[11px] font-semibold text-[var(--brand-deep)]"
                >
                  Open Fee Take →
                </Link>
                <RemoveControl
                  label="Clear all fees"
                  check={clearCheck}
                  onRemove={onClearAllFees}
                />
              </div>
            </div>
          ) : null}

          {!groupId ? (
            <p className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--card)] px-4 py-10 text-center text-sm text-[var(--muted)]">
              No {STUDENT_TYPES.find((t) => t.value === tab)?.label ?? tab}{" "}
              groups yet — create one under Fee groups.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {months.map((m, idx) => {
                const isFirst = idx === 0;
                const monthLines = linesForMonth(m.id);
                return (
                  <MonthCard
                    key={m.id}
                    code={m.code}
                    label={m.label}
                    dueOn={m.dueOn}
                    isFirst={isFirst}
                    totalPaise={monthTotal(m.id)}
                    lines={monthLines}
                    heads={usableHeads.map((h) => ({
                      id: h.id,
                      nameEn: h.nameEn,
                      code: h.code,
                      frequency: h.frequency,
                    }))}
                    classScopeLabel={
                      classScope ? classNameOf(classScope) : null
                    }
                    resolveHead={(id) =>
                      state.feeHeads.find((h) => h.id === id)?.nameEn ?? "—"
                    }
                    resolveFrequency={(id) =>
                      state.feeHeads.find((h) => h.id === id)?.frequency
                    }
                    onAdd={(feeHeadId, amountPaise, copyToAll) =>
                      addHeadToMonth(m.id, feeHeadId, amountPaise, copyToAll)
                    }
                    onUpdateAmount={updateLineAmount}
                    onRemove={removeLine}
                    onCopyToAll={
                      isFirst
                        ? (line) => copyLineToAllMonths(line)
                        : undefined
                    }
                  />
                );
              })}
            </div>
          )}

          {firstMonth && groupId ? (
            <p className="mt-3 text-xs text-[var(--muted)]">
              Tip: Set <strong>All classes</strong> defaults first, then pick a
              class to override amounts. In <strong>April</strong>, use{" "}
              <strong>Copy → schedule</strong> — monthly heads go to all 12
              months, quarterly to Apr/Jul/Oct/Jan, half-yearly to Apr/Oct,
              annual &amp; one-time to April only. Publish when ready for Fee
              Take.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function MonthCard({
  code,
  label,
  dueOn,
  isFirst,
  totalPaise,
  lines,
  heads,
  classScopeLabel,
  resolveHead,
  resolveFrequency,
  onAdd,
  onUpdateAmount,
  onRemove,
  onCopyToAll,
}: {
  code: string;
  label: string;
  dueOn: string;
  isFirst: boolean;
  totalPaise: number;
  lines: FeeStructureLine[];
  heads: {
    id: string;
    nameEn: string;
    code: string;
    frequency?: string;
  }[];
  classScopeLabel: string | null;
  resolveHead: (id: string) => string;
  resolveFrequency: (id: string) => string | undefined;
  onAdd: (feeHeadId: string, amountPaise: number, copyToAll: boolean) => void;
  onUpdateAmount: (lineId: string, raw: string) => void;
  onRemove: (lineId: string) => void;
  onCopyToAll?: (line: FeeStructureLine) => void;
}) {
  const [open, setOpen] = useState(false);
  const [feeHeadId, setFeeHeadId] = useState(heads[0]?.id ?? "");
  const [amount, setAmount] = useState("1500");
  const [copyAll, setCopyAll] = useState(isFirst);

  useEffect(() => {
    if (!heads.some((h) => h.id === feeHeadId) && heads[0]) {
      setFeeHeadId(heads[0].id);
    }
  }, [heads, feeHeadId]);

  const selectedFreq =
    heads.find((h) => h.id === feeHeadId)?.frequency ?? "monthly";
  const scheduleHint = feeFrequencyScheduleLabel(selectedFreq);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!feeHeadId) return;
    onAdd(feeHeadId, parseInrToPaise(amount), isFirst && copyAll);
    setOpen(false);
    setAmount("1500");
  }

  return (
    <div
      className={`flex flex-col rounded-xl border bg-[var(--card)] ${
        isFirst
          ? "border-[rgba(197,160,40,0.55)] shadow-[0_0_0_1px_rgba(197,160,40,0.12)]"
          : "border-[var(--border)]"
      }`}
    >
      <div className="flex items-start justify-between gap-2 border-b border-[var(--border)] px-3 py-2.5">
        <div>
          <div className="text-sm font-bold text-[var(--brand-deep)]">
            {code}
            {isFirst ? (
              <span className="ml-1.5 rounded bg-[rgba(197,160,40,0.2)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--brand-deep)]">
                First
              </span>
            ) : null}
            {classScopeLabel ? (
              <span className="ml-1.5 rounded bg-[var(--surface-sunken)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--brand-mid)]">
                {classScopeLabel}
              </span>
            ) : null}
          </div>
          <div className="text-[11px] text-[var(--muted)]">
            {label} · due {dueOn}
          </div>
        </div>
        <div className="text-right text-sm font-semibold text-[var(--brand-deep)]">
          {formatInr(totalPaise)}
        </div>
      </div>

      <ul className="min-h-[72px] flex-1 divide-y divide-[var(--border)]">
        {lines.map((l) => {
          const freq = resolveFrequency(l.feeHeadId);
          const copyLabel = feeFrequencyScheduleLabel(freq);
          return (
            <li key={l.id} className="px-3 py-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium text-[var(--brand-deep)]">
                    {resolveHead(l.feeHeadId)}
                    {freq ? (
                      <span className="ml-1 font-normal text-[var(--muted)]">
                        · {freq.replace("_", "-")}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <input
                      className="field max-w-[88px] !py-1 !text-xs"
                      defaultValue={String(l.amountPaise / 100)}
                      key={`${l.id}-${l.amountPaise}`}
                      onBlur={(e) => onUpdateAmount(l.id, e.target.value)}
                      aria-label="Amount"
                    />
                    {isFirst && onCopyToAll ? (
                      <button
                        type="button"
                        className="text-[10px] font-semibold text-[var(--brand-mid)] underline-offset-2 hover:underline"
                        onClick={() => onCopyToAll(l)}
                        title={`Place on ${copyLabel} per fee-head frequency`}
                      >
                        Copy → {copyLabel}
                      </button>
                    ) : null}
                  </div>
                </div>
                <RemoveControl
                  compact
                  check={checkStructureLineRemoval(
                    resolveHead(l.feeHeadId),
                    formatInr(l.amountPaise),
                  )}
                  onRemove={() => onRemove(l.id)}
                />
              </div>
            </li>
          );
        })}
        {lines.length === 0 ? (
          <li className="px-3 py-4 text-center text-[11px] text-[var(--muted)]">
            {classScopeLabel
              ? "No class override — defaults apply"
              : "No heads yet"}
          </li>
        ) : null}
      </ul>

      <div className="border-t border-[var(--border)] p-2">
        {open ? (
          <form onSubmit={submit} className="space-y-2">
            <select
              className="field !py-1.5 !text-xs"
              value={feeHeadId}
              onChange={(e) => setFeeHeadId(e.target.value)}
            >
              {heads.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.nameEn}
                  {h.frequency ? ` (${h.frequency.replace("_", "-")})` : ""}
                </option>
              ))}
            </select>
            <input
              className="field !py-1.5 !text-xs"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Amount ₹"
              inputMode="decimal"
            />
            {isFirst ? (
              <label className="flex items-start gap-2 text-[11px] text-[var(--brand-deep)]">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={copyAll}
                  onChange={(e) => setCopyAll(e.target.checked)}
                />
                <span>
                  Spread by frequency → <strong>{scheduleHint}</strong>
                </span>
              </label>
            ) : null}
            <div className="flex gap-2">
              <button
                type="submit"
                className="btn-accent flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold"
              >
                Save
              </button>
              <button
                type="button"
                className="rounded-lg px-2 py-1.5 text-xs text-[var(--muted)]"
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="w-full rounded-lg border border-dashed border-[var(--border)] py-1.5 text-xs font-medium text-[var(--brand-mid)] hover:border-[var(--brand-gold)]"
          >
            + Add fee head
            {classScopeLabel ? ` (${classScopeLabel})` : ""}
          </button>
        )}
      </div>
    </div>
  );
}
