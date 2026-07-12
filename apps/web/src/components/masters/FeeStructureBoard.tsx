"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  DEFAULT_AY,
  STUDENT_TYPES,
  STUDENT_TYPE_HINTS,
  annualTotalForGroup,
  checkStructureLineRemoval,
  classesForFeeGroup,
  ensureAprToMarInstallments,
  formatInr,
  newId,
  parseInrToPaise,
  publishFeeGroupStructure,
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
import { useDemoSession } from "@/components/shell/SessionContext";

type Commit = (s: MastersState, msg?: string) => void;

type StructureTab = FeeStudentType;

/**
 * Fee structure board:
 * - Tabs by student type (New / Promoted / Mid-year / RTE)
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
  const [tab, setTab] = useState<StructureTab>("NEW");
  const [classScope, setClassScope] = useState<string>(""); // "" = all / default
  const [sisTick, setSisTick] = useState(0);

  const groupsForTab = useMemo(
    () =>
      state.feeGroups.filter(
        (g) =>
          g.isActive &&
          g.academicYearCode === DEFAULT_AY &&
          g.studentType === tab,
      ),
    [state.feeGroups, tab],
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
    const next = ensureAprToMarInstallments(state, DEFAULT_AY);
    return next.installments
      .filter((i) => i.academicYearCode === DEFAULT_AY)
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [state]);

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

    let next = ensureAprToMarInstallments(state, DEFAULT_AY);
    const targetMonths = copyToAll
      ? next.installments.filter((i) => i.academicYearCode === DEFAULT_AY)
      : next.installments.filter((i) => i.id === installmentId);

    next = {
      ...next,
      installments: next.installments.map((i) =>
        targetMonths.some((t) => t.id === i.id) ? { ...i, isActive: true } : i,
      ),
    };

    let lines = [...next.feeStructureLines];

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

    commit(
      { ...next, feeStructureLines: lines },
      copyToAll
        ? `Head added to all ${targetMonths.length} months${
            scopeClassId ? " (class override)" : ""
          }`
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

  const usableHeads = state.feeHeads.filter(
    (h) => h.isActive && h.code !== "LATE",
  );

  const classNameOf = (id: string | null) =>
    id
      ? (state.classes.find((c) => c.id === id)?.name ?? "Class")
      : "All classes";

  return (
    <div className="space-y-4">
      <p className="rounded-xl border border-[rgba(32,48,80,0.1)] bg-[rgba(32,48,80,0.03)] px-3 py-2 text-[11px] leading-snug text-[var(--muted)]">
        <strong className="text-[var(--brand-deep)]">New vs old assignment:</strong>{" "}
        {STUDENT_TYPE_HINTS[tab]} Configure mid-year April / skip / transport
        under Masters → Mid-year. Promote in Exams switches to Promoted groups.
      </p>
      <div
        className="flex flex-wrap gap-1 border-b border-[rgba(32,48,80,0.12)]"
        role="tablist"
      >
        {STUDENT_TYPES.map((t) => {
          const on = tab === t.value;
          const n = state.feeGroups.filter(
            (g) =>
              g.isActive &&
              g.academicYearCode === DEFAULT_AY &&
              g.studentType === t.value,
          ).length;
          return (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setTab(t.value)}
              className={`relative px-3 pb-2.5 text-sm font-semibold ${
                on
                  ? "text-[var(--brand-deep)]"
                  : "text-[var(--muted)] hover:text-[var(--brand-deep)]"
              }`}
            >
              {t.label}
              <span className="ml-1 text-[10px] font-normal text-[var(--muted)]">
                {n}
              </span>
              <span
                className={`absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-[var(--brand-gold)] ${
                  on ? "opacity-100" : "opacity-0"
                }`}
              />
            </button>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_240px]">
        <div>
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-[var(--brand-deep)]">
                {group?.name ?? "Select a fee group"}
              </h3>
              <p className="text-xs text-[var(--muted)]">
                {DEFAULT_AY} ·{" "}
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
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-[rgba(32,48,80,0.1)] bg-white px-3 py-2.5">
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
                  <span className="ml-1 block sm:inline text-[var(--muted)]">
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
              <div className="flex flex-wrap gap-2">
                {impact.unassignedMatching > 0 ? (
                  <button
                    type="button"
                    className="rounded-lg border border-[rgba(32,48,80,0.15)] bg-white px-2.5 py-1 text-[11px] font-semibold"
                    onClick={onAssignStudents}
                  >
                    Assign to matching students
                  </button>
                ) : null}
                <button
                  type="button"
                  className="rounded-lg border border-[rgba(32,48,80,0.15)] bg-white px-2.5 py-1 text-[11px] font-semibold"
                  onClick={onSyncGroup}
                >
                  Sync this group
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-[rgba(32,48,80,0.15)] bg-white px-2.5 py-1 text-[11px] font-semibold"
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
                  className="rounded-lg border border-[rgba(32,48,80,0.15)] bg-white px-2.5 py-1 text-[11px] font-semibold text-[var(--brand-deep)]"
                >
                  Open Fee Take →
                </Link>
              </div>
            </div>
          ) : null}

          {!groupId ? (
            <p className="rounded-xl border border-dashed border-[rgba(32,48,80,0.2)] bg-white px-4 py-10 text-center text-sm text-[var(--muted)]">
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
                    heads={usableHeads}
                    classScopeLabel={
                      classScope ? classNameOf(classScope) : null
                    }
                    resolveHead={(id) =>
                      state.feeHeads.find((h) => h.id === id)?.nameEn ?? "—"
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
        </div>

        <aside className="h-fit rounded-xl border border-[rgba(32,48,80,0.12)] bg-white lg:sticky lg:top-20">
          <div className="border-b border-[rgba(32,48,80,0.08)] px-3 py-2.5 text-xs font-semibold tracking-wide text-[var(--muted)] uppercase">
            Fee group
          </div>
          <ul className="max-h-[70vh] overflow-y-auto py-1">
            {groupsForTab.map((g) => {
              const on = g.id === groupId;
              return (
                <li key={g.id}>
                  <button
                    type="button"
                    onClick={() => setGroupId(g.id)}
                    className={`w-full px-3 py-2.5 text-left text-sm transition ${
                      on
                        ? "bg-[rgba(32,48,80,0.08)] font-semibold text-[var(--brand-deep)]"
                        : "text-[var(--brand-deep)] hover:bg-[rgba(32,48,80,0.04)]"
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span>{g.name}</span>
                      {g.structurePublishedAt ? (
                        <span
                          className="rounded bg-[rgba(21,128,61,0.12)] px-1 py-0.5 text-[9px] font-semibold text-[#15803d]"
                          title="Published"
                        >
                          Live
                        </span>
                      ) : null}
                    </div>
                    <div className="text-[11px] font-normal text-[var(--muted)]">
                      {g.code} · {formatInr(annualTotalForGroup(state, g.id))}
                    </div>
                  </button>
                </li>
              );
            })}
            {groupsForTab.length === 0 ? (
              <li className="px-3 py-6 text-center text-xs text-[var(--muted)]">
                No groups for this tab
              </li>
            ) : null}
          </ul>
        </aside>
      </div>

      {firstMonth && groupId ? (
        <p className="text-xs text-[var(--muted)]">
          Tip: Set <strong>All classes</strong> defaults first, then pick a
          class to override amounts (e.g. higher tuition for Class V). In{" "}
          <strong>April</strong>, use <strong>Copy → all months</strong> for
          recurring heads. Publish when ready — Fee Take bills from structure
          immediately for students on this group.
        </p>
      ) : null}
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
  heads: { id: string; nameEn: string; code: string }[];
  classScopeLabel: string | null;
  resolveHead: (id: string) => string;
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

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!feeHeadId) return;
    onAdd(feeHeadId, parseInrToPaise(amount), isFirst && copyAll);
    setOpen(false);
    setAmount("1500");
  }

  return (
    <div
      className={`flex flex-col rounded-xl border bg-white ${
        isFirst
          ? "border-[rgba(197,160,40,0.55)] shadow-[0_0_0_1px_rgba(197,160,40,0.12)]"
          : "border-[rgba(32,48,80,0.12)]"
      }`}
    >
      <div className="flex items-start justify-between gap-2 border-b border-[rgba(32,48,80,0.08)] px-3 py-2.5">
        <div>
          <div className="text-sm font-bold text-[var(--brand-deep)]">
            {code}
            {isFirst ? (
              <span className="ml-1.5 rounded bg-[rgba(197,160,40,0.2)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--brand-deep)]">
                First
              </span>
            ) : null}
            {classScopeLabel ? (
              <span className="ml-1.5 rounded bg-[rgba(32,48,80,0.08)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--brand-mid)]">
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

      <ul className="min-h-[72px] flex-1 divide-y divide-[rgba(32,48,80,0.06)]">
        {lines.map((l) => (
          <li key={l.id} className="px-3 py-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-xs font-medium text-[var(--brand-deep)]">
                  {resolveHead(l.feeHeadId)}
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
                      title="Copy this head & amount to all 12 months"
                    >
                      Copy → all months
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
        ))}
        {lines.length === 0 ? (
          <li className="px-3 py-4 text-center text-[11px] text-[var(--muted)]">
            {classScopeLabel
              ? "No class override — defaults apply"
              : "No heads yet"}
          </li>
        ) : null}
      </ul>

      <div className="border-t border-[rgba(32,48,80,0.08)] p-2">
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
                  Required every month — create here and{" "}
                  <strong>copy to all months</strong> (tuition, etc.)
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
            className="w-full rounded-lg border border-dashed border-[rgba(32,48,80,0.25)] py-1.5 text-xs font-medium text-[var(--brand-mid)] hover:border-[var(--brand-gold)]"
          >
            + Add fee head
            {classScopeLabel ? ` (${classScopeLabel})` : ""}
          </button>
        )}
      </div>
    </div>
  );
}
