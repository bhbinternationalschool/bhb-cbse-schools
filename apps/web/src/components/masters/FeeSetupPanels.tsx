"use client";

import { useMemo, useState } from "react";
import {
  DEFAULT_AY,
  SESSION_MONTHS,
  STUDENT_TYPES,
  annualTotalForGroup,
  applyInstallmentPattern,
  checkFeeGroupRemoval,
  ensureAprToMarInstallments,
  formatInr,
  midYearFeePolicySummary,
  newId,
  parseInrToPaise,
  removeFeeGroup,
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
  MastersTabStack,
  MastersTableCard,
  MastersTablesRow,
  MastersWorkCard,
} from "@/components/masters/MastersLayout";

type Commit = (s: MastersState, msg?: string) => void;

export function FeeGroupsPanel({
  state,
  commit,
}: {
  state: MastersState;
  commit: Commit;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [studentType, setStudentType] = useState<FeeStudentType>("NEW");
  const [selectedClasses, setSelectedClasses] = useState<string[]>([]);

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
    setSelectedClasses([...g.classIds]);
  }

  function toggleClass(classId: string) {
    setSelectedClasses((prev) =>
      prev.includes(classId)
        ? prev.filter((id) => id !== classId)
        : [...prev, classId],
    );
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

    if (editingId) {
      commit(
        {
          ...state,
          feeGroups: state.feeGroups.map((g) =>
            g.id === editingId
              ? {
                  ...g,
                  code: nextCode,
                  name: name.trim(),
                  studentType,
                  classIds: selectedClasses,
                }
              : g,
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
      academicYearCode: DEFAULT_AY,
      studentType,
      classIds: selectedClasses,
      isActive: true,
      structurePublishedAt: null,
      structurePublishedBy: "",
    };
    commit(
      { ...state, feeGroups: [...state.feeGroups, group] },
      "Fee group added — set amounts in Fee structure",
    );
    resetForm();
  }

  return (
    <MastersTabStack
      intro={
        <>
          <strong className="text-[var(--brand-deep)]">New</strong> = admission
          bundle ·{" "}
          <strong className="text-[var(--brand-deep)]">Promoted</strong> =
          continuing ·{" "}
          <strong className="text-[var(--brand-deep)]">Mid-year</strong> = class
          group + mid-year rules (
          {midYearFeePolicySummary(state.midYearFeePolicy)}) ·{" "}
          <strong className="text-[var(--brand-deep)]">RTE</strong> = EWS.
        </>
      }
      tables={
        <MastersTablesRow cols={1}>
          <MastersTableCard title={`Fee groups · ${DEFAULT_AY}`}>
            <ul className="divide-y divide-[rgba(32,48,80,0.08)]">
              {state.feeGroups.map((g) => {
                const total = annualTotalForGroup(state, g.id);
                const classLabel =
                  g.classIds.length === 0
                    ? "All classes"
                    : state.classes
                        .filter((c) => g.classIds.includes(c.id))
                        .map((c) => c.name)
                        .join(", ");
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
                        {g.studentType} · {classLabel}
                        {!g.isActive ? " · inactive" : ""}
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
                              feeGroups: state.feeGroups.map((x) =>
                                x.id === g.id
                                  ? { ...x, isActive: !x.isActive }
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
                          const result = removeFeeGroup(state, g.id);
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
          </MastersTableCard>
        </MastersTablesRow>
      }
      work={
        <MastersWorkCard
          title={editingId ? "Edit fee group" : "Add fee group"}
          hint="Working form"
        >
          <form onSubmit={saveGroup} className="max-w-xl space-y-1">
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
                Classes (leave empty = all)
              </div>
              <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto rounded-xl border border-[rgba(32,48,80,0.12)] p-2">
                {state.classes.map((c) => {
                  const on = selectedClasses.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleClass(c.id)}
                      className={`rounded-lg px-2 py-1 text-xs font-medium ${
                        on
                          ? "bg-[var(--brand-deep)] text-white"
                          : "bg-[var(--surface)] text-[var(--brand-deep)]"
                      }`}
                    >
                      {c.name}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              {editingId ? (
                <button
                  type="button"
                  className="rounded-xl border border-[rgba(32,48,80,0.2)] px-4 py-2.5 text-sm font-semibold text-[var(--brand-deep)]"
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
      }
    />
  );
}

export function InstallmentsPanel({
  state,
  commit,
}: {
  state: MastersState;
  commit: Commit;
}) {
  const list = state.installments
    .filter((i) => i.academicYearCode === DEFAULT_AY)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const activeCount = list.filter((i) => i.isActive).length;

  function ensureCalendar() {
    commit(
      ensureAprToMarInstallments(state, DEFAULT_AY),
      "Apr–Mar session calendar ready",
    );
  }

  function applyPattern(pattern: InstallmentPattern) {
    const labels = {
      monthly: "Monthly Apr–Mar (12 dues)",
      quarterly: "Quarterly (Apr, Jul, Oct, Jan)",
      half_yearly: "Half-yearly (Apr, Oct)",
    };
    commit(applyInstallmentPattern(state, pattern, DEFAULT_AY), labels[pattern]);
  }

  function toggleMonth(code: string) {
    const next = ensureAprToMarInstallments(state, DEFAULT_AY);
    commit(
      {
        ...next,
        installments: next.installments.map((i) =>
          i.academicYearCode === DEFAULT_AY && i.code === code
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
    const next = ensureAprToMarInstallments(state, DEFAULT_AY);
    commit(
      {
        ...next,
        installments: next.installments.map((i) => {
          if (i.academicYearCode !== DEFAULT_AY) return i;
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
            title={`Session months · ${DEFAULT_AY}`}
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
                          ? "bg-[var(--brand-deep)] text-white shadow-sm"
                          : "bg-[var(--surface)] text-[var(--muted)] ring-1 ring-[rgba(32,48,80,0.1)]"
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
            <ul className="divide-y divide-[rgba(32,48,80,0.08)]">
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
              className="rounded-lg border border-[rgba(32,48,80,0.2)] px-3 py-2 text-xs font-semibold text-[var(--brand-deep)]"
              onClick={() => applyPattern("quarterly")}
            >
              Quarterly (4)
            </button>
            <button
              type="button"
              className="rounded-lg border border-[rgba(32,48,80,0.2)] px-3 py-2 text-xs font-semibold text-[var(--brand-deep)]"
              onClick={() => applyPattern("half_yearly")}
            >
              Half-yearly (2)
            </button>
            <button
              type="button"
              className="rounded-lg border border-[rgba(32,48,80,0.2)] px-3 py-2 text-xs font-medium text-[var(--brand-mid)]"
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
  const rule = state.lateFeeRules.find(
    (r) => r.academicYearCode === DEFAULT_AY,
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
      academicYearCode: DEFAULT_AY,
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
    <div className="max-w-lg rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-5">
      <h3 className="text-sm font-semibold text-[var(--brand-deep)]">
        Late-fee policy · {DEFAULT_AY}
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
          <div className="flex flex-wrap gap-1.5 rounded-xl border border-[rgba(32,48,80,0.12)] p-2">
            {activeHeads.map((h) => {
              const on = feeHeadIds.includes(h.id);
              return (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => toggleHead(h.id)}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-medium ${
                    on
                      ? "bg-[var(--brand-deep)] text-white"
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
    <div className="overflow-hidden rounded-xl border border-[rgba(32,48,80,0.12)] bg-white">
      <div className="border-b border-[rgba(32,48,80,0.08)] px-4 py-3 text-sm font-semibold text-[var(--brand-deep)]">
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
                className="flex items-start justify-between gap-3 rounded-xl border border-[rgba(32,48,80,0.1)] px-3 py-2.5"
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
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[rgba(32,48,80,0.08)] pt-3">
            <p className="text-[11px] text-[var(--muted)]">
              Example (defaults on, join Sep): April tuition billed · May–Aug
              skipped · Sep–Mar full (incl. transport).
            </p>
            <button
              type="button"
              className="rounded-lg border border-[rgba(32,48,80,0.15)] bg-white px-3 py-1.5 text-[11px] font-semibold"
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
