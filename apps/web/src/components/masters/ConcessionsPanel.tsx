"use client";
import {
  canApproveConcession,
  canGrantConcession,
  concessionGrantStatus,
} from "@/lib/rbac";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Printer, X } from "lucide-react";
import {
  ErpTable,
  ErpTableBody,
  ErpTableHead,
  ErpTableShell,
} from "@/components/ui/erp-roster";
import {
  CONCESSION_ALL_SESSIONS,
  currentAcademicYearCode,
  checkConcessionKindRemoval,
  checkConcessionRemoval,
  concessionApprovalHint,
  defaultSiblingTiers,
  formatConcessionValue,
  formatInr,
  grantsForConcessionPolicy,
  listConcessionPolicies,
  newId,
  normalizeSiblingTier,
  ordinalChildLabel,
  parseInrToPaise,
  removeConcession,
  removeConcessionKind,
  resolveConcessionKinds,
  resolveSiblingTierValue,
  type ConcessionRule,
  type ConcessionValueMode,
  type MastersState,
  type SiblingConcessionTier,
} from "@/lib/masters";
import { loadSis, type SisStudent } from "@/lib/sis";
import {
  isStudentAlreadyGranted,
  siblingChildNumber,
  siblingGrantHint,
  suggestStudentsForConcession,
} from "@/lib/concessionSuggest";
import {
  buildAllConcessionStudentLists,
  buildConcessionStudentList,
  concessionRowMatches,
  isCounterGeneratedConcession,
  groupConcessionRowsByFamily,
  type ConcessionFamilyGroup,
  type ConcessionStudentListRow,
} from "@/lib/concessionStudentList";
import { EditControl } from "@/components/masters/EditControl";
import { RemoveControl } from "@/components/masters/RemoveControl";
import { useDemoSessionOptional } from "@/components/shell/SessionContext";

type Commit = (s: MastersState, msg?: string) => void;

/** Header-selected session, falling back to the masters "current" year. */
function useSetupAy(state: MastersState): string {
  const session = useDemoSessionOptional();
  return session?.academicYearCode || currentAcademicYearCode(state);
}

function ayNorm(code: string): string {
  const t = (code || "").trim().replace(/\s+/g, "").replace(/–/g, "-");
  const full = t.match(/^(20\d{2})-(20\d{2})$/);
  if (full) return `${full[1]}-${full[2]!.slice(2)}`;
  return t;
}

export function ConcessionsPanel({
  state,
  commit,
}: {
  state: MastersState;
  commit: Commit;
}) {
  const ay = useSetupAy(state);
  const concessions = useMemo(
    () => listConcessionPolicies(state, { preferAy: ay }),
    [state, ay],
  );
  const kinds = useMemo(() => resolveConcessionKinds(state), [state]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState(concessions[0]?.id ?? "");

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState(kinds[0]?.code ?? "sibling");
  const [mode, setMode] = useState<ConcessionValueMode>("percent");
  const [valueInput, setValueInput] = useState("10");
  const [feeHeadIds, setFeeHeadIds] = useState<string[]>([]);
  const [autoApprove, setAutoApprove] = useState("5000");
  const [alwaysPrincipal, setAlwaysPrincipal] = useState(false);
  const [docsRequired, setDocsRequired] = useState(false);
  const [incompatible, setIncompatible] = useState("");
  const [notes, setNotes] = useState("");
  const [siblingTiers, setSiblingTiers] = useState<SiblingConcessionTier[]>(
    defaultSiblingTiers(),
  );

  const [kindCode, setKindCode] = useState("");
  const [kindLabel, setKindLabel] = useState("");
  const [showKindForm, setShowKindForm] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [kindsOpen, setKindsOpen] = useState(false);
  const [listRule, setListRule] = useState<ConcessionRule | null>(null);

  useEffect(() => {
    if (concessions.some((c) => c.id === selectedId)) return;
    setSelectedId(concessions[0]?.id ?? "");
    setEditingId(null);
    setFormOpen(false);
  }, [concessions, selectedId]);

  const selected = concessions.find((c) => c.id === selectedId);
  const grantsForSelected = useMemo(() => {
    if (!selected) return [];
    return grantsForConcessionPolicy(state, selected);
  }, [state, selected]);

  const activeHeads = state.feeHeads.filter((h) => h.isActive);

  function resetForm() {
    setEditingId(null);
    setCode("");
    setName("");
    setKind(kinds[0]?.code ?? "sibling");
    setMode("percent");
    setValueInput("10");
    setFeeHeadIds([]);
    setAutoApprove("5000");
    setAlwaysPrincipal(false);
    setDocsRequired(false);
    setIncompatible("");
    setNotes("");
    setSiblingTiers(defaultSiblingTiers());
    setFormOpen(false);
  }

  function startEdit(rule: ConcessionRule) {
    setSelectedId(rule.id);
    setEditingId(rule.id);
    setCode(rule.code);
    setName(rule.name);
    setKind(rule.kind);
    setMode(rule.mode);
    setValueInput(
      rule.mode === "percent" ? String(rule.value) : String(rule.value / 100),
    );
    setFeeHeadIds([...rule.feeHeadIds]);
    setAlwaysPrincipal(rule.autoApproveMaxPaise == null);
    setAutoApprove(
      rule.autoApproveMaxPaise != null
        ? String(rule.autoApproveMaxPaise / 100)
        : "5000",
    );
    setDocsRequired(rule.documentationRequired);
    setIncompatible(rule.incompatibleCodes.join(", "));
    setNotes(rule.notes);
    setSiblingTiers(
      rule.siblingTiers?.length
        ? rule.siblingTiers.map(normalizeSiblingTier)
        : defaultSiblingTiers(),
    );
    setFormOpen(true);
  }

  function openAddForm() {
    setEditingId(null);
    setCode("");
    setName("");
    setKind(kinds[0]?.code ?? "sibling");
    setMode("percent");
    setValueInput("10");
    setFeeHeadIds([]);
    setAutoApprove("5000");
    setAlwaysPrincipal(false);
    setDocsRequired(false);
    setIncompatible("");
    setNotes("");
    setSiblingTiers(defaultSiblingTiers());
    setFormOpen(true);
  }

  function toggleHead(id: string) {
    setFeeHeadIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function addKind(e: React.FormEvent) {
    e.preventDefault();
    if (!kindCode.trim() || !kindLabel.trim()) return;
    const nextCode = kindCode
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9_]/g, "");
    if (!nextCode) {
      commit(state, "Kind code is invalid");
      return;
    }
    if (kinds.some((k) => k.code === nextCode)) {
      commit(state, "Kind code already exists");
      return;
    }
    const row = {
      id: newId("ck"),
      code: nextCode,
      label: kindLabel.trim(),
      isSystem: false,
    };
    commit(
      {
        ...state,
        concessionKinds: [...resolveConcessionKinds(state), row],
      },
      `Kind “${row.label}” added`,
    );
    setKind(row.code);
    setKindCode("");
    setKindLabel("");
    setShowKindForm(false);
  }

  function saveRule(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim() || !name.trim()) return;
    const nextCode = code.trim().toUpperCase();
    if (
      (state.concessions ?? []).some(
        (c) => c.code.toUpperCase() === nextCode && c.id !== editingId,
      )
    ) {
      commit(state, "Concession code already exists");
      return;
    }
    if (!kinds.some((k) => k.code === kind)) {
      commit(state, "Select or create a kind first");
      return;
    }

    const value =
      mode === "percent"
        ? Math.max(0, Math.min(100, Number(valueInput) || 0))
        : parseInrToPaise(valueInput);

    const autoApproveMaxPaise = alwaysPrincipal
      ? null
      : parseInrToPaise(autoApprove);

    const incompatibleCodes = incompatible
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
      .filter((c) => c !== nextCode);

    const payload = {
      code: nextCode,
      name: name.trim(),
      kind,
      academicYearCode: CONCESSION_ALL_SESSIONS,
      mode,
      value,
      siblingTiers:
        kind === "sibling"
          ? siblingTiers
              .map(normalizeSiblingTier)
              .sort((a, b) => a.childNo - b.childNo)
          : [],
      feeHeadIds,
      autoApproveMaxPaise,
      documentationRequired: docsRequired,
      incompatibleCodes,
      notes: notes.trim(),
    };

    if (editingId) {
      commit(
        {
          ...state,
          concessions: (state.concessions ?? []).map((c) =>
            c.id === editingId
              ? { ...c, ...payload, academicYearCode: c.academicYearCode || ay }
              : c,
          ),
        },
        "Concession updated",
      );
      resetForm();
      return;
    }

    const rule: ConcessionRule = {
      id: newId("cnc"),
      ...payload,
      isActive: true,
    };
    commit(
      { ...state, concessions: [...(state.concessions ?? []), rule] },
      "Concession policy added",
    );
    setSelectedId(rule.id);
    resetForm();
  }

  function kindLabelOf(code: string) {
    return kinds.find((x) => x.code === code)?.label ?? code;
  }

  function headsLabel(ids: string[]) {
    if (ids.length === 0) return "All fee heads";
    return ids
      .map((id) => state.feeHeads.find((h) => h.id === id)?.nameEn ?? "—")
      .join(", ");
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--muted)]">
        Concession policies apply in every session. Use the print button on a
        rule to open its student list for PDF. Discounts recalculate from each
        student&apos;s fee structure for the active session ({ay}) in Fee Take.
      </p>

      <div className="grid gap-4 lg:grid-cols-[minmax(280px,0.85fr)_minmax(0,1.25fr)] lg:items-start">
        {/* LEFT — policies + collapsible add/edit */}
        <div className="space-y-3">
          <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)]">
            <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-2.5">
              <div className="text-sm font-semibold text-[var(--brand-deep)]">
                Policies · all sessions
              </div>
              <button
                type="button"
                className="rounded-lg bg-[var(--primary)] px-2.5 py-1 text-[11px] font-semibold text-[var(--primary-foreground)]"
                onClick={() => {
                  if (formOpen && !editingId) setFormOpen(false);
                  else openAddForm();
                }}
              >
                {formOpen && !editingId ? "Close form" : "+ Add"}
              </button>
            </div>
            <ul className="max-h-[min(52vh,420px)] divide-y divide-[var(--border)] overflow-y-auto">
              {concessions.map((c) => {
                const on = c.id === selectedId;
                const grantN = grantsForConcessionPolicy(state, c).length;
                return (
                  <li
                    key={c.id}
                    className={`flex items-start gap-2 px-3 py-2.5 ${
                      on ? "bg-[var(--surface-sunken)]" : ""
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedId(c.id)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="font-medium text-[var(--brand-deep)]">
                        {c.name}{" "}
                        <span className="text-xs font-normal text-[var(--muted)]">
                          {c.code}
                        </span>
                        {!c.isActive ? (
                          <span className="ml-1 text-xs text-[var(--muted)]">
                            · inactive
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-0.5 text-[11px] text-[var(--muted)]">
                        {kindLabelOf(c.kind)} · {formatConcessionValue(c)}
                        {grantN > 0 ? ` · ${grantN} grant(s)` : ""}
                      </div>
                    </button>
                    <div className="flex shrink-0 flex-col items-end gap-0.5">
                      <button
                        type="button"
                        title={`Print student list · ${c.code}`}
                        aria-label={`Print student list for ${c.name}`}
                        className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--card)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--brand-deep)] hover:bg-[var(--surface-sunken)]"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedId(c.id);
                          setListRule(c);
                        }}
                      >
                        <Printer className="h-3 w-3" />
                        Print
                      </button>
                      <EditControl
                        active={editingId === c.id}
                        onEdit={() => startEdit(c)}
                      />
                      <button
                        type="button"
                        className="text-[10px] font-medium text-[var(--brand-mid)]"
                        onClick={() =>
                          commit(
                            {
                              ...state,
                              concessions: (state.concessions ?? []).map((x) =>
                                x.id === c.id
                                  ? { ...x, isActive: !x.isActive }
                                  : x,
                              ),
                            },
                            c.isActive
                              ? "Concession inactivated"
                              : "Concession activated",
                          )
                        }
                      >
                        {c.isActive ? "Off" : "On"}
                      </button>
                      <RemoveControl
                        compact
                        check={checkConcessionRemoval(state, c.id)}
                        onRemove={() => {
                          const result = removeConcession(state, c.id);
                          if (!result.ok) {
                            commit(state, result.reason);
                            return;
                          }
                          const nextId =
                            result.state.concessions?.find(
                              (x) => x.id === selectedId,
                            )?.id ??
                            result.state.concessions?.[0]?.id ??
                            "";
                          setSelectedId(nextId);
                          if (editingId === c.id) resetForm();
                          commit(result.state, "Concession removed");
                        }}
                      />
                    </div>
                  </li>
                );
              })}
              {concessions.length === 0 ? (
                <li className="px-3 py-8 text-center text-sm text-[var(--muted)]">
                  No policies yet — add one below
                </li>
              ) : null}
            </ul>
          </div>

          <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)]">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
              onClick={() => setFormOpen((v) => !v)}
              aria-expanded={formOpen}
            >
              <span className="text-sm font-semibold text-[var(--brand-deep)]">
                {editingId ? "Edit concession" : "Add concession"}
              </span>
              <span className="text-xs font-semibold text-[var(--muted)]">
                {formOpen ? "Collapse ▲" : "Expand ▼"}
              </span>
            </button>
            {formOpen ? (
              <div className="border-t border-[var(--border)] px-3 pb-3">
                <form onSubmit={saveRule} className="pt-1">
                  <label className="mt-3 block text-sm">
                    <span className="mb-1.5 block text-[var(--muted)]">
                      Code
                    </span>
                    <input
                      className="field"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      placeholder="SIBLING"
                      required
                    />
                  </label>
                  <label className="mt-3 block text-sm">
                    <span className="mb-1.5 block text-[var(--muted)]">
                      Name
                    </span>
                    <input
                      className="field"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Sibling discount"
                      required
                    />
                  </label>
                  <label className="mt-3 block text-sm">
                    <span className="mb-1.5 block text-[var(--muted)]">
                      Kind
                    </span>
                    <select
                      className="field"
                      value={kind}
                      onChange={(e) => {
                        const next = e.target.value;
                        setKind(next);
                        if (next === "sibling" && siblingTiers.length === 0) {
                          setSiblingTiers(defaultSiblingTiers());
                        }
                      }}
                    >
                      {kinds.map((k) => (
                        <option key={k.id} value={k.code}>
                          {k.label}
                          {k.isSystem ? "" : " (custom)"}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="mt-1.5 text-xs font-medium text-[var(--brand-mid)]"
                    onClick={() => {
                      setKindsOpen(true);
                      setShowKindForm(true);
                    }}
                  >
                    Need another kind? Create kind ↓
                  </button>

                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="block text-sm">
                      <span className="mb-1.5 block text-[var(--muted)]">
                        Mode
                      </span>
                      <select
                        className="field"
                        value={mode}
                        onChange={(e) =>
                          setMode(e.target.value as ConcessionValueMode)
                        }
                      >
                        <option value="percent">Percent</option>
                        <option value="fixed">Fixed ₹</option>
                      </select>
                    </label>
                    <label className="block text-sm">
                      <span className="mb-1.5 block text-[var(--muted)]">
                        {kind === "sibling"
                          ? "Fallback value"
                          : mode === "percent"
                            ? "Percent"
                            : "Amount (₹)"}
                      </span>
                      <input
                        className="field"
                        value={valueInput}
                        onChange={(e) => setValueInput(e.target.value)}
                        inputMode="decimal"
                        required
                      />
                    </label>
                  </div>

                  {kind === "sibling" ? (
                    <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="text-xs font-semibold text-[var(--brand-deep)]">
                            Sibling child tiers
                          </div>
                          <p className="mt-0.5 text-[11px] text-[var(--muted)]">
                            1st child usually pays full fee. Set discount for
                            2nd, 3rd, 4th+ (highest tier covers higher numbers).
                          </p>
                        </div>
                        <button
                          type="button"
                          className="text-[11px] font-semibold text-[var(--brand-mid)]"
                          onClick={() => {
                            const nextNo =
                              Math.max(
                                1,
                                ...siblingTiers.map((t) => t.childNo),
                                1,
                              ) + 1;
                            setSiblingTiers([
                              ...siblingTiers,
                              {
                                childNo: Math.max(2, nextNo),
                                mode,
                                value:
                                  mode === "percent"
                                    ? Math.min(
                                        100,
                                        (siblingTiers[siblingTiers.length - 1]
                                          ?.value ?? 10) + 5,
                                      )
                                    : (siblingTiers[siblingTiers.length - 1]
                                        ?.value ?? 0),
                              },
                            ]);
                          }}
                        >
                          + Add child tier
                        </button>
                      </div>
                      <ul className="mt-2 space-y-2">
                        {siblingTiers.map((t, idx) => {
                          const last = idx === siblingTiers.length - 1;
                          return (
                            <li
                              key={`${t.childNo}-${idx}`}
                              className="grid grid-cols-[4.5rem_5.5rem_1fr_auto] items-end gap-2"
                            >
                              <label className="block text-[11px]">
                                <span className="mb-0.5 block text-[var(--muted)]">
                                  Child #
                                </span>
                                <input
                                  className="field !py-1 !text-xs"
                                  inputMode="numeric"
                                  value={t.childNo}
                                  onChange={(e) => {
                                    const n = Math.max(
                                      2,
                                      Number(
                                        e.target.value.replace(/\D/g, "") || 2,
                                      ),
                                    );
                                    setSiblingTiers((prev) =>
                                      prev.map((row, i) =>
                                        i === idx
                                          ? { ...row, childNo: n }
                                          : row,
                                      ),
                                    );
                                  }}
                                />
                              </label>
                              <label className="block text-[11px]">
                                <span className="mb-0.5 block text-[var(--muted)]">
                                  Mode
                                </span>
                                <select
                                  className="field !py-1 !text-xs"
                                  value={t.mode}
                                  onChange={(e) =>
                                    setSiblingTiers((prev) =>
                                      prev.map((row, i) =>
                                        i === idx
                                          ? {
                                              ...row,
                                              mode: e.target
                                                .value as ConcessionValueMode,
                                            }
                                          : row,
                                      ),
                                    )
                                  }
                                >
                                  <option value="percent">%</option>
                                  <option value="fixed">₹</option>
                                </select>
                              </label>
                              <label className="block text-[11px]">
                                <span className="mb-0.5 block text-[var(--muted)]">
                                  {ordinalChildLabel(t.childNo)}
                                  {last ? "+" : ""} child ·{" "}
                                  {t.mode === "percent" ? "%" : "₹"}
                                </span>
                                <input
                                  className="field !py-1 !text-xs"
                                  inputMode="decimal"
                                  value={
                                    t.mode === "percent"
                                      ? String(t.value)
                                      : String(t.value / 100)
                                  }
                                  onChange={(e) => {
                                    const raw = e.target.value;
                                    setSiblingTiers((prev) =>
                                      prev.map((row, i) => {
                                        if (i !== idx) return row;
                                        if (row.mode === "percent") {
                                          return {
                                            ...row,
                                            value: Math.max(
                                              0,
                                              Math.min(
                                                100,
                                                Number(
                                                  raw.replace(/[^\d.]/g, ""),
                                                ) || 0,
                                              ),
                                            ),
                                          };
                                        }
                                        return {
                                          ...row,
                                          value: parseInrToPaise(raw),
                                        };
                                      }),
                                    );
                                  }}
                                />
                              </label>
                              <button
                                type="button"
                                className="mb-0.5 text-[11px] font-semibold text-[var(--danger)] disabled:opacity-40"
                                disabled={siblingTiers.length <= 1}
                                onClick={() =>
                                  setSiblingTiers((prev) =>
                                    prev.filter((_, i) => i !== idx),
                                  )
                                }
                              >
                                Remove
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ) : null}

                  <div className="mt-3">
                    <div className="mb-1.5 text-sm text-[var(--muted)]">
                      Fee heads (empty = all)
                    </div>
                    <div className="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto rounded-xl border border-[var(--border)] p-2">
                      {activeHeads.map((h) => {
                        const on = feeHeadIds.includes(h.id);
                        return (
                          <button
                            key={h.id}
                            type="button"
                            onClick={() => toggleHead(h.id)}
                            className={`rounded-lg px-2 py-1 text-xs font-medium ${
                              on
                                ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                                : "bg-[var(--surface)] text-[var(--brand-deep)]"
                            }`}
                          >
                            {h.nameEn}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <label className="mt-3 flex items-center gap-2 text-sm text-[var(--brand-deep)]">
                    <input
                      type="checkbox"
                      checked={alwaysPrincipal}
                      onChange={(e) => setAlwaysPrincipal(e.target.checked)}
                    />
                    Always require Principal approval
                  </label>
                  {!alwaysPrincipal ? (
                    <label className="mt-3 block text-sm">
                      <span className="mb-1.5 block text-[var(--muted)]">
                        Auto-approve if concession ≤ ₹
                      </span>
                      <input
                        className="field"
                        value={autoApprove}
                        onChange={(e) => setAutoApprove(e.target.value)}
                        inputMode="decimal"
                      />
                    </label>
                  ) : null}

                  <label className="mt-3 flex items-center gap-2 text-sm text-[var(--brand-deep)]">
                    <input
                      type="checkbox"
                      checked={docsRequired}
                      onChange={(e) => setDocsRequired(e.target.checked)}
                    />
                    Supporting document required
                  </label>

                  <label className="mt-3 block text-sm">
                    <span className="mb-1.5 block text-[var(--muted)]">
                      Incompatible codes (comma-separated)
                    </span>
                    <input
                      className="field"
                      value={incompatible}
                      onChange={(e) => setIncompatible(e.target.value)}
                      placeholder="STAFF, MERIT"
                    />
                  </label>

                  <label className="mt-3 block text-sm">
                    <span className="mb-1.5 block text-[var(--muted)]">
                      Notes
                    </span>
                    <input
                      className="field"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Policy notes for Accounts / Principal"
                    />
                  </label>

                  <div className="mt-4 flex gap-2">
                    {editingId ? (
                      <button
                        type="button"
                        className="rounded-xl border border-[var(--border)] px-4 py-2.5 text-sm font-semibold text-[var(--brand-deep)]"
                        onClick={() => {
                          resetForm();
                          setFormOpen(false);
                        }}
                      >
                        Cancel
                      </button>
                    ) : null}
                    <button
                      type="submit"
                      className="btn-accent flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold"
                    >
                      {editingId ? "Update concession" : "Save concession"}
                    </button>
                  </div>

                  <p className="mt-3 text-[11px] leading-relaxed text-[var(--muted)]">
                    Example: Sibling 10% on Tuition, auto if ≤{" "}
                    {formatInr(500_000)} — above that, Principal maker-checker.
                  </p>
                </form>
              </div>
            ) : (
              <p className="border-t border-[var(--border)] px-3 py-2 text-[11px] text-[var(--muted)]">
                Expand to create or edit a policy. Pick a policy above to grant
                students on the right.
              </p>
            )}
          </div>

          <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)]">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
              onClick={() => setKindsOpen((v) => !v)}
              aria-expanded={kindsOpen}
            >
              <span className="text-sm font-semibold text-[var(--brand-deep)]">
                Concession kinds
              </span>
              <span className="text-xs font-semibold text-[var(--muted)]">
                {kindsOpen ? "Collapse ▲" : "Expand ▼"}
              </span>
            </button>
            {kindsOpen ? (
              <div className="border-t border-[var(--border)] px-3 pb-3">
                <div className="flex justify-end pt-2">
                  <button
                    type="button"
                    className="text-xs font-semibold text-[var(--brand-mid)]"
                    onClick={() => setShowKindForm((v) => !v)}
                  >
                    {showKindForm ? "Close" : "+ Create kind"}
                  </button>
                </div>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {kinds.map((k) => {
                    const used = concessions.filter(
                      (c) => c.kind === k.code,
                    ).length;
                    return (
                      <li
                        key={k.id}
                        className="flex items-center gap-2 rounded-lg bg-[var(--surface)] px-2.5 py-1.5 text-xs text-[var(--brand-deep)]"
                      >
                        <span className="font-medium">{k.label}</span>
                        <span className="text-[var(--muted)]">{k.code}</span>
                        {k.isSystem ? (
                          <span className="text-[10px] text-[var(--muted)]">
                            built-in
                          </span>
                        ) : (
                          <RemoveControl
                            compact
                            check={checkConcessionKindRemoval(state, k.id)}
                            onRemove={() => {
                              const result = removeConcessionKind(state, k.id);
                              if (!result.ok) {
                                commit(state, result.reason);
                                return;
                              }
                              if (kind === k.code) {
                                setKind(
                                  result.state.concessionKinds?.[0]?.code ??
                                    "sibling",
                                );
                              }
                              commit(result.state, "Kind removed");
                            }}
                          />
                        )}
                        {used > 0 ? (
                          <span className="text-[10px] text-[var(--muted)]">
                            {used}
                          </span>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
                {showKindForm ? (
                  <form
                    onSubmit={addKind}
                    className="mt-3 flex flex-wrap items-end gap-2 border-t border-[var(--border)] pt-3"
                  >
                    <label className="block text-sm">
                      <span className="mb-1 block text-[var(--muted)]">
                        Code
                      </span>
                      <input
                        className="field min-w-[8rem]"
                        value={kindCode}
                        onChange={(e) => setKindCode(e.target.value)}
                        placeholder="sports_quota"
                        required
                      />
                    </label>
                    <label className="block text-sm">
                      <span className="mb-1 block text-[var(--muted)]">
                        Label
                      </span>
                      <input
                        className="field min-w-[10rem]"
                        value={kindLabel}
                        onChange={(e) => setKindLabel(e.target.value)}
                        placeholder="Sports quota"
                        required
                      />
                    </label>
                    <button
                      type="submit"
                      className="btn-accent rounded-lg px-3 py-2 text-xs font-semibold"
                    >
                      Save kind
                    </button>
                  </form>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        {/* RIGHT — student grants */}
        <div className="min-w-0 lg:sticky lg:top-20">
          {selected ? (
            <GrantStudentsCard
              state={state}
              commit={commit}
              concession={selected}
              grants={grantsForSelected}
            />
          ) : (
            <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--card)] px-4 py-16 text-center text-sm text-[var(--muted)]">
              Select a concession policy on the left to grant students.
            </div>
          )}
        </div>
      </div>

      {listRule ? (
        <ConcessionStudentListDrawer
          rule={listRule}
          state={state}
          ay={ay}
          onClose={() => setListRule(null)}
        />
      ) : null}
    </div>
  );
}

function GrantStudentsCard({
  state,
  commit,
  concession,
  grants,
}: {
  state: MastersState;
  commit: Commit;
  concession: ConcessionRule;
  grants: MastersState["concessionGrants"];
}) {
  const sis = useMemo(() => loadSis(), [grants.length, state.concessionGrants]);
  const ay = useSetupAy(state);
  const session = useDemoSessionOptional();
  /**
   * Who may do what with a concession. Recording one and making it effective
   * are separate acts: an assigned user can prepare the discount a parent is
   * asking for, but only owner / admin / principal can hand it over.
   */
  const mayApprove = useMemo(
    () => (session ? canApproveConcession(session, state) : false),
    [session, state],
  );
  const mayGrant = useMemo(
    () => (session ? canGrantConcession(session, state) : false),
    [session, state],
  );
  const [selectMode, setSelectMode] = useState<"single" | "multiple">(
    concession.kind === "sibling" ? "multiple" : "single",
  );
  const [query, setQuery] = useState("");
  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  /** Per-student child # override; missing = auto from DOB rank */
  const [childNoByStudent, setChildNoByStudent] = useState<
    Record<string, number>
  >({});
  const [childNoOverride, setChildNoOverride] = useState<number | 0>(0);
  const [reason, setReason] = useState("");
  /**
   * The month the discount starts from.
   *
   * This used to be today, with nothing to change it — so a discount agreed
   * in July for the whole session silently began in whatever month the clerk
   * happened to record it, and the earlier months stayed billed at full rate.
   * Defaults to the current month, which is what a same-day grant wants, and
   * is now a field the office can move back.
   */
  const [fromMonth, setFromMonth] = useState(() =>
    new Date().toISOString().slice(0, 7),
  );
  const [autoApprove, setAutoApprove] = useState(true);

  useEffect(() => {
    setSelectMode(concession.kind === "sibling" ? "multiple" : "single");
    setSelectedIds([]);
    setChildNoByStudent({});
    setChildNoOverride(0);
    setQuery("");
    setReason("");
    setClassId("");
    setSectionId("");
  }, [concession.id, concession.kind]);

  const classOptions = useMemo(
    () =>
      state.classes
        .filter((c) => c.isActive)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [state.classes],
  );

  const sectionOptions = useMemo(() => {
    if (!classId) return [];
    return state.sections.filter((s) => s.classId === classId && s.isActive);
  }, [state.sections, classId]);

  useEffect(() => {
    if (sectionId && !sectionOptions.some((s) => s.id === sectionId)) {
      setSectionId("");
    }
  }, [sectionId, sectionOptions]);

  const classLabel = (st: SisStudent) => {
    const c = state.classes.find((x) => x.id === st.classId)?.name ?? "—";
    const sec = state.sections.find((x) => x.id === st.sectionId)?.name ?? "";
    return sec ? `${c}-${sec}` : c;
  };

  const suggestions = useMemo(
    () =>
      suggestStudentsForConcession(concession, sis, grants ?? [], ay, state),
    [concession, sis, grants, ay, state],
  );

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Scope to the current session so a child promoted across years shows once.
    let list = sis.students.filter(
      (s) => s.status === "active" && ayNorm(s.academicYearCode) === ayNorm(ay),
    );
    if (classId) list = list.filter((s) => s.classId === classId);
    if (sectionId) list = list.filter((s) => s.sectionId === sectionId);
    if (q) {
      list = list.filter(
        (s) =>
          s.fullName.toLowerCase().includes(q) ||
          s.admissionNo.toLowerCase().includes(q),
      );
    } else if (!classId && !sectionId) {
      return [];
    }
    return list
      .filter(
        (s) => !isStudentAlreadyGranted(s.id, concession, grants ?? [], state),
      )
      .slice(0, 20);
  }, [sis.students, query, classId, sectionId, concession, grants, ay, state]);

  const selectedStudents = useMemo(
    () =>
      selectedIds
        .map((id) => sis.students.find((s) => s.id === id))
        .filter((s): s is SisStudent => !!s),
    [selectedIds, sis.students],
  );

  function isSelected(id: string) {
    return selectedIds.includes(id);
  }

  function resolvedChildNo(s: SisStudent): number {
    if (concession.kind !== "sibling") return 0;
    if (childNoByStudent[s.id]) return childNoByStudent[s.id]!;
    if (childNoOverride > 0) return childNoOverride;
    return siblingChildNumber(sis, s);
  }

  function toggleStudent(
    s: SisStudent,
    hint?: string,
    suggestChildNo?: number,
  ) {
    if (selectMode === "single") {
      setSelectedIds([s.id]);
      setQuery(`${s.fullName} · ${s.admissionNo}`);
      if (concession.kind === "sibling") {
        const n = suggestChildNo ?? siblingChildNumber(sis, s);
        setChildNoByStudent({ [s.id]: n });
        if (!reason.trim() || reason === concession.name) {
          setReason(hint || siblingGrantHint(sis, s, n));
        }
      } else if (!reason.trim()) {
        setReason(hint || concession.name);
      }
      return;
    }
    setSelectedIds((prev) => {
      if (prev.includes(s.id)) {
        setChildNoByStudent((m) => {
          const next = { ...m };
          delete next[s.id];
          return next;
        });
        return prev.filter((id) => id !== s.id);
      }
      if (concession.kind === "sibling") {
        const n = suggestChildNo ?? siblingChildNumber(sis, s);
        setChildNoByStudent((m) => ({ ...m, [s.id]: n }));
      }
      return [...prev, s.id];
    });
    setQuery("");
    if (
      concession.kind === "sibling" &&
      (!reason.trim() || reason === concession.name)
    ) {
      setReason(hint || "Sibling discount");
    } else if (!reason.trim()) {
      setReason(hint || concession.name);
    }
  }

  function selectAllSuggested() {
    const ids = suggestions.map((x) => x.student.id);
    setSelectedIds((prev) => {
      const set = new Set(prev);
      for (const id of ids) set.add(id);
      return [...set];
    });
    if (concession.kind === "sibling") {
      setChildNoByStudent((m) => {
        const next = { ...m };
        for (const row of suggestions) {
          next[row.student.id] =
            row.siblingChildNo ?? siblingChildNumber(sis, row.student);
        }
        return next;
      });
    }
    if (!reason.trim()) {
      setReason(
        concession.kind === "sibling"
          ? "Sibling discount (bulk)"
          : concession.name,
      );
    }
  }

  function clearSelection() {
    setSelectedIds([]);
    setChildNoByStudent({});
    setQuery("");
  }

  function grant(e: React.FormEvent) {
    e.preventDefault();
    if (selectedIds.length === 0) return;
    // The first of the chosen month: a fee month is billed whole, so a
    // mid-month start would be a date the biller cannot act on.
    const effectiveFrom = /^\d{4}-\d{2}$/.test(fromMonth)
      ? `${fromMonth}-01`
      : new Date().toISOString().slice(0, 10);
    // The money test as before — and then WHO. An assigned user's grant
    // stays pending however small it is; approval is not something the
    // person asking for it can give themselves.
    const amountAllowsAuto =
      autoApprove && concession.autoApproveMaxPaise != null;
    const status = concessionGrantStatus(mayApprove, amountAllowsAuto) as
      "pending" | "approved" | "rejected";
    const now = new Date().toISOString();
    const rows = selectedIds
      .filter(
        (id) => !isStudentAlreadyGranted(id, concession, grants ?? [], state),
      )
      .map((id) => {
        const st = sis.students.find((s) => s.id === id);
        const childNo =
          concession.kind === "sibling" && st ? resolvedChildNo(st) : null;
        return {
          id: newId("cg"),
          concessionId: concession.id,
          studentId: id,
          status,
          reason:
            reason.trim() ||
            (st && concession.kind === "sibling"
              ? siblingGrantHint(sis, st, childNo ?? undefined)
              : concession.name),
          effectiveFrom,
          effectiveTo: null as string | null,
          createdAt: now,
          siblingChildNo:
            childNo && childNo >= 2 ? childNo : childNo === 1 ? 1 : null,
        };
      });
    if (rows.length === 0) {
      commit(state, "Selected students already have this grant");
      return;
    }
    commit(
      {
        ...state,
        concessionGrants: [...(state.concessionGrants ?? []), ...rows],
      },
      status === "approved"
        ? `Granted & approved for ${rows.length} student${rows.length === 1 ? "" : "s"}`
        : mayApprove
          ? `Granted (pending) for ${rows.length} student${rows.length === 1 ? "" : "s"}`
          : `Sent for approval — ${rows.length} student${rows.length === 1 ? "" : "s"}. ` +
            "A principal, admin or owner must approve it before it applies.",
    );
    clearSelection();
    setReason("");
  }

  function setStatus(
    grantId: string,
    status: "approved" | "rejected" | "pending",
  ) {
    // Approving and rejecting ARE the approval. An assigned user reaching
    // this would be approving their own grant.
    if (!mayApprove) {
      commit(state, "Only a principal, admin or owner can approve or reject");
      return;
    }
    commit(
      {
        ...state,
        concessionGrants: (state.concessionGrants ?? []).map((g) =>
          g.id === grantId ? { ...g, status } : g,
        ),
      },
      status === "approved"
        ? "Grant approved — applies in Fee Take"
        : status === "rejected"
          ? "Grant rejected"
          : "Grant set to pending",
    );
  }

  function removeGrant(grantId: string) {
    // Removing an approved grant is a change to what a family is charged,
    // so it sits on the same side of the line as approving one.
    if (!mayApprove) {
      commit(state, "Only a principal, admin or owner can remove a grant");
      return;
    }
    commit(
      {
        ...state,
        concessionGrants: (state.concessionGrants ?? []).filter(
          (g) => g.id !== grantId,
        ),
      },
      "Grant removed",
    );
  }

  const kindLabel =
    resolveConcessionKinds(state).find((k) => k.code === concession.kind)
      ?.label ?? concession.kind;

  const showSuggest = [
    "sibling",
    "staff_ward",
    "rte_ews",
    "transport",
  ].includes(concession.kind);

  const emptySuggestHint =
    concession.kind === "sibling"
      ? "No households with 2+ active siblings yet."
      : concession.kind === "staff_ward"
        ? "No staff-tagged students. Add “Staff ward” in student notes, or search below."
        : concession.kind === "rte_ews"
          ? "No RTE / EWS students found. Set student type RTE or category EWS."
          : concession.kind === "transport"
            ? "No students with an active transport assignment."
            : null;

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-[var(--brand-deep)]">
            Student grants · {concession.code}
          </h3>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Approved grants reduce dues in Fee Take using the current session
            fee structure ({formatConcessionValue(concession)}).
          </p>
        </div>
        <div
          className="flex rounded-lg border border-[var(--border)] bg-[var(--surface)] p-0.5 text-[11px] font-semibold"
          role="group"
          aria-label="Selection mode"
        >
          <button
            type="button"
            className={`rounded-md px-2.5 py-1 ${
              selectMode === "single"
                ? "bg-[var(--card)] text-[var(--brand-deep)] shadow-sm"
                : "text-[var(--muted)]"
            }`}
            onClick={() => {
              setSelectMode("single");
              setSelectedIds((prev) => (prev[0] ? [prev[0]] : []));
            }}
          >
            Single
          </button>
          <button
            type="button"
            className={`rounded-md px-2.5 py-1 ${
              selectMode === "multiple"
                ? "bg-[var(--card)] text-[var(--brand-deep)] shadow-sm"
                : "text-[var(--muted)]"
            }`}
            onClick={() => setSelectMode("multiple")}
          >
            Multiple
          </button>
        </div>
      </div>

      {showSuggest ? (
        <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
              Suggested for {kindLabel}
            </div>
            {selectMode === "multiple" && suggestions.length > 0 ? (
              <button
                type="button"
                className="text-[11px] font-semibold text-[var(--brand-mid)]"
                onClick={selectAllSuggested}
              >
                Select all suggested ({suggestions.length})
              </button>
            ) : null}
          </div>
          {suggestions.length > 0 ? (
            <ul className="mt-2 max-h-48 divide-y divide-[var(--border)] overflow-y-auto">
              {suggestions.map(({ student: s, hint, siblingChildNo }) => {
                const on = isSelected(s.id);
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      className={`flex w-full items-start gap-2 px-1 py-2 text-left text-xs hover:bg-[var(--card)] ${
                        on ? "bg-[var(--card)]" : ""
                      }`}
                      onClick={() => toggleStudent(s, hint, siblingChildNo)}
                    >
                      {selectMode === "multiple" ? (
                        <span
                          className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${
                            on
                              ? "border-[var(--brand-deep)] bg-[var(--primary)] text-[var(--primary-foreground)]"
                              : "border-[var(--border)]"
                          }`}
                          aria-hidden
                        >
                          {on ? "✓" : ""}
                        </span>
                      ) : null}
                      <span className="min-w-0 flex-1">
                        <span className="font-medium text-[var(--brand-deep)]">
                          {s.fullName}
                        </span>
                        <span className="ml-1.5 text-[var(--muted)]">
                          {s.admissionNo} · {classLabel(s)}
                        </span>
                        <span className="mt-0.5 block text-[10px] text-[var(--muted)]">
                          {hint}
                        </span>
                      </span>
                      <span className="shrink-0 font-semibold text-[var(--brand-mid)]">
                        {selectMode === "multiple"
                          ? on
                            ? "Remove"
                            : "Add"
                          : "Select"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-1.5 text-xs text-[var(--muted)]">
              {emptySuggestHint}
            </p>
          )}
        </div>
      ) : null}

      {selectMode === "multiple" && selectedStudents.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-semibold text-[var(--muted)]">
            Selected ({selectedStudents.length}):
          </span>
          {selectedStudents.map((s) => {
            const n = concession.kind === "sibling" ? resolvedChildNo(s) : 0;
            const tier =
              concession.kind === "sibling"
                ? resolveSiblingTierValue(concession, n)
                : null;
            return (
              <span
                key={s.id}
                className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--surface)] pl-2 text-[11px] text-[var(--brand-deep)]"
              >
                {s.fullName}
                {concession.kind === "sibling" ? (
                  <select
                    className="border-0 bg-transparent py-0.5 pr-1 text-[10px] font-semibold"
                    value={n}
                    onChange={(e) =>
                      setChildNoByStudent((m) => ({
                        ...m,
                        [s.id]: Number(e.target.value),
                      }))
                    }
                    onClick={(e) => e.stopPropagation()}
                    title="Child number for discount"
                  >
                    {[1, 2, 3, 4, 5, 6, 7, 8].map((c) => (
                      <option key={c} value={c}>
                        {ordinalChildLabel(c)}
                        {c >= 4 &&
                        concession.siblingTiers.some((t) => t.childNo === 4)
                          ? c === 4
                            ? "+"
                            : ""
                          : ""}
                        {tier && c === n
                          ? tier.mode === "percent"
                            ? ` ${tier.value}%`
                            : ""
                          : ""}
                      </option>
                    ))}
                  </select>
                ) : null}
                <button
                  type="button"
                  className="rounded-full px-1.5 py-0.5 hover:bg-[var(--card)]"
                  onClick={() => toggleStudent(s)}
                  title="Remove"
                >
                  ×
                </button>
              </span>
            );
          })}
          <button
            type="button"
            className="text-[11px] font-semibold text-[var(--muted)]"
            onClick={clearSelection}
          >
            Clear
          </button>
        </div>
      ) : null}

      {concession.kind === "sibling" && selectedIds.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-[var(--muted)]">
            Apply as child # (single / bulk default):
          </span>
          <select
            className="field !w-auto !py-1 !text-xs"
            value={childNoOverride}
            onChange={(e) => {
              const n = Number(e.target.value);
              setChildNoOverride(n);
              if (n > 0) {
                setChildNoByStudent((m) => {
                  const next = { ...m };
                  for (const id of selectedIds) next[id] = n;
                  return next;
                });
              }
            }}
          >
            <option value={0}>Auto (by age / DOB)</option>
            {[2, 3, 4, 5, 6, 7, 8].map((c) => {
              const tier = resolveSiblingTierValue(concession, c);
              return (
                <option key={c} value={c}>
                  {ordinalChildLabel(c)}
                  {c ===
                  Math.max(0, ...concession.siblingTiers.map((t) => t.childNo))
                    ? "+"
                    : ""}{" "}
                  child
                  {tier
                    ? tier.mode === "percent"
                      ? ` · ${tier.value}%`
                      : ` · ₹${tier.value / 100}`
                    : " · no discount"}
                </option>
              );
            })}
          </select>
        </div>
      ) : null}

      {!mayGrant ? (
        <p className="mt-3 rounded-xl border border-dashed border-[var(--border)] bg-[var(--card)]/70 px-4 py-6 text-center text-sm text-[var(--muted)]">
          Your role cannot grant concessions. A principal, admin or owner — or a
          user given the fees module — can record one here.
        </p>
      ) : null}
      {!mayApprove && mayGrant ? (
        <p className="mt-3 rounded-xl border border-[rgba(197,160,40,0.4)] bg-[rgba(197,160,40,0.08)] px-3 py-2 text-[11px] leading-relaxed text-[var(--brand-deep)]">
          Anything you grant here is saved as <strong>pending</strong> and does
          not reduce a bill until a principal, admin or owner approves it.
        </p>
      ) : null}
      <form
        onSubmit={grant}
        className={`mt-3 grid gap-2 sm:grid-cols-2 ${mayGrant ? "" : "hidden"}`}
      >
        <label className="block text-sm">
          <span className="mb-1 block text-[11px] text-[var(--muted)]">
            Class
          </span>
          <select
            className="field !py-1.5"
            value={classId}
            onChange={(e) => {
              setClassId(e.target.value);
              setSectionId("");
            }}
          >
            <option value="">All classes</option>
            {classOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-[11px] text-[var(--muted)]">
            Section
          </span>
          <select
            className="field !py-1.5"
            value={sectionId}
            onChange={(e) => setSectionId(e.target.value)}
            disabled={!classId}
          >
            <option value="">
              {classId ? "All sections" : "Pick class first"}
            </option>
            {sectionOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm sm:col-span-2">
          <span className="mb-1 block text-[11px] text-[var(--muted)]">
            Search (name or admission no.)
          </span>
          <input
            className="field !py-1.5"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (selectMode === "single") setSelectedIds([]);
            }}
            placeholder="Type to search, or filter by class/section…"
          />
          {matches.length > 0 &&
          !(selectMode === "single" && selectedIds.length === 1 && query) ? (
            <ul className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface)]">
              {matches.map((s) => {
                const on = isSelected(s.id);
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-[var(--card)] ${
                        on ? "bg-[var(--card)]" : ""
                      }`}
                      onClick={() => toggleStudent(s)}
                    >
                      {selectMode === "multiple" ? (
                        <span
                          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${
                            on
                              ? "border-[var(--brand-deep)] bg-[var(--primary)] text-[var(--primary-foreground)]"
                              : "border-[var(--border)]"
                          }`}
                          aria-hidden
                        >
                          {on ? "✓" : ""}
                        </span>
                      ) : null}
                      <span>
                        <span className="font-medium text-[var(--brand-deep)]">
                          {s.fullName}
                        </span>
                        <span className="ml-1.5 text-[var(--muted)]">
                          {s.admissionNo} · {classLabel(s)}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {selectedIds.length === 0 &&
          !query.trim() &&
          (classId || sectionId) &&
          matches.length === 0 ? (
            <p className="mt-1 text-[11px] text-[var(--muted)]">
              No students in this class/section (or all already granted).
            </p>
          ) : null}
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-[11px] text-[var(--muted)]">
            Applies from
          </span>
          <input
            type="month"
            className="field !py-1.5"
            value={fromMonth}
            onChange={(e) => setFromMonth(e.target.value)}
          />
          <span className="mt-1 block text-[10px] leading-snug text-[var(--muted)]">
            Months already billed are not re-opened by moving this back — it
            governs what the counter charges from here on.
          </span>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-[11px] text-[var(--muted)]">
            Reason
          </span>
          <input
            className="field !py-1.5"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Optional — applied to all selected"
          />
        </label>
        <div className="flex flex-col justify-end gap-2 sm:col-span-2 sm:flex-row sm:items-center">
          <label className="flex items-center gap-2 text-xs text-[var(--brand-deep)]">
            <input
              type="checkbox"
              checked={autoApprove}
              onChange={(e) => setAutoApprove(e.target.checked)}
              disabled={concession.autoApproveMaxPaise == null}
            />
            Auto-approve when policy allows
          </label>
          <button
            type="submit"
            disabled={selectedIds.length === 0}
            className="btn-accent rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-50"
          >
            {selectedIds.length <= 1
              ? "Grant"
              : `Grant to ${selectedIds.length} students`}
          </button>
        </div>
      </form>

      <ul className="mt-4 divide-y divide-[var(--border)]">
        {grants.map((g) => {
          const st = sis.students.find((s) => s.id === g.studentId);
          return (
            <li
              key={g.id}
              className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
            >
              <div>
                <div className="font-medium text-[var(--brand-deep)]">
                  {st?.fullName ?? "Student"}
                  <span className="ml-2 text-xs font-normal text-[var(--muted)]">
                    {st?.admissionNo ?? g.studentId}
                    {st ? ` · ${classLabel(st)}` : ""}
                  </span>
                </div>
                <div className="text-[11px] text-[var(--muted)]">
                  {g.status} · from {g.effectiveFrom}
                  {g.siblingChildNo
                    ? ` · ${ordinalChildLabel(g.siblingChildNo)} child`
                    : ""}
                  {g.reason ? ` · ${g.reason}` : ""}
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {g.status !== "approved" ? (
                  <button
                    type="button"
                    className="text-[11px] font-semibold text-[var(--success)]"
                    onClick={() => setStatus(g.id, "approved")}
                  >
                    Approve
                  </button>
                ) : null}
                {g.status === "pending" ? (
                  <button
                    type="button"
                    className="text-[11px] font-semibold text-[var(--warning)]"
                    onClick={() => setStatus(g.id, "rejected")}
                  >
                    Reject
                  </button>
                ) : null}
                <button
                  type="button"
                  className="text-[11px] font-semibold text-[var(--danger)]"
                  onClick={() => removeGrant(g.id)}
                >
                  Remove
                </button>
              </div>
            </li>
          );
        })}
        {grants.length === 0 ? (
          <li className="py-4 text-center text-xs text-[var(--muted)]">
            No grants yet for this policy
          </li>
        ) : null}
      </ul>
    </div>
  );
}

function ConcessionStudentListDrawer({
  rule,
  state,
  ay,
  onClose,
}: {
  rule: ConcessionRule;
  state: MastersState;
  ay: string;
  onClose: () => void;
}) {
  const titleId = useId();
  const printRef = useRef<HTMLDivElement>(null);
  const sis = useMemo(() => loadSis(), []);
  const kinds = useMemo(() => resolveConcessionKinds(state), [state]);
  const kindLabel = kinds.find((k) => k.code === rule.kind)?.label ?? rule.kind;

  /**
   * Which policy the list is showing. Defaults to the one the drawer was
   * opened from; "__all__" widens it, because "who is on a discount, and
   * which one?" is the question the office asks more often than "who is on
   * this policy".
   */
  const [policyCode, setPolicyCode] = useState<string>(rule.code);
  const [nameQuery, setNameQuery] = useState("");
  /** Siblings together — the view that justifies why one child and not another. */
  const [byFamily, setByFamily] = useState(false);

  const allRows = useMemo(
    () =>
      policyCode === "__all__"
        ? buildAllConcessionStudentLists(state, sis, { sessionAy: ay })
        : buildConcessionStudentList(
            state,
            state.concessions.find((c) => c.code === policyCode) ?? rule,
            sis,
            { sessionAy: ay },
          ),
    [state, rule, sis, ay, policyCode],
  );

  const rows = useMemo(
    () => allRows.filter((r) => concessionRowMatches(r, nameQuery)),
    [allRows, nameQuery],
  );

  const families = useMemo(() => groupConcessionRowsByFamily(rows), [rows]);

  const activePolicy = useMemo(
    () => state.concessions.find((c) => c.code === policyCode) ?? rule,
    [state.concessions, policyCode, rule],
  );

  /**
   * The pickable policies: deduplicated by code, and without the rules the
   * counter mints per transaction. Production carries 106 concessions, of
   * which all but a handful are `CTR-TUITION-<amount>` — a picker listing
   * those is a picker nobody can use. They still appear under "All
   * discounts", because a child genuinely holds them.
   */
  const policies = useMemo(() => {
    const seen = new Set<string>();
    return state.concessions
      .filter((c) => {
        const code = c.code.toUpperCase();
        if (seen.has(code) || isCounterGeneratedConcession(code)) return false;
        seen.add(code);
        return true;
      })
      .map((c) => ({ code: c.code, name: c.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [state.concessions]);

  const printedAt = new Date().toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  function handlePrint() {
    const node = printRef.current;
    if (!node) return;
    const title = `${rule.name} (${rule.code})`;
    const w = window.open("", "_blank", "width=960,height=720");
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html><head><title>${title}</title>
      <style>
        body { font-family: system-ui, sans-serif; padding: 24px; color: #203050; }
        h1 { font-size: 20px; margin: 0 0 4px; }
        .meta { color: #64748b; margin-bottom: 16px; font-size: 13px; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; }
        th, td { border: 1px solid #e2e8f0; padding: 7px 9px; text-align: left; }
        th { background: #f8fafc; font-weight: 600; }
        td.num { text-align: center; width: 36px; }
        .status { text-transform: capitalize; }
      </style></head><body>
      ${node.innerHTML}
      </body></html>`);
    w.document.close();
    w.focus();
    w.print();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[var(--overlay)] p-3 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={onClose}
    >
      <div
        className="max-h-[88vh] w-full max-w-3xl overflow-auto rounded-2xl bg-[var(--brand-cream)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-start gap-3 border-b border-[var(--border)] bg-[var(--brand-cream)] px-5 py-4">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
              Discount students
            </p>
            <h2
              id={titleId}
              className="text-xl font-bold text-[var(--brand-deep)] sm:text-2xl"
            >
              {policyCode === "__all__" ? "All discounts" : activePolicy.name}{" "}
              <span className="text-base font-normal text-[var(--muted)]">
                {policyCode === "__all__" ? "" : activePolicy.code}
              </span>
            </h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {kindLabel} · {formatConcessionValue(rule)} · Session {ay} ·{" "}
              {rows.length} student{rows.length === 1 ? "" : "s"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--border)] text-[var(--brand-deep)] hover:bg-[var(--card)]"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={handlePrint}
              disabled={rows.length === 0}
              className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] px-3.5 text-sm font-semibold text-[var(--brand-deep)] hover:bg-[var(--surface-sunken)] disabled:opacity-50"
            >
              <Printer className="h-4 w-4" />
              Print / PDF
            </button>
          </div>

          {/* Filters sit OUTSIDE printRef: the paper should carry the result,
              not the controls that produced it. */}
          <div className="mb-3 flex flex-wrap items-end gap-2">
            <label className="min-w-[12rem] flex-1 text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">
                Find a student or father
              </span>
              <input
                className="field !py-1.5"
                value={nameQuery}
                onChange={(e) => setNameQuery(e.target.value)}
                placeholder="Name, father, admission no., class…"
              />
            </label>
            <label className="min-w-[12rem] text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">
                Discount type
              </span>
              <select
                className="field !py-1.5"
                value={policyCode}
                onChange={(e) => setPolicyCode(e.target.value)}
              >
                <option value="__all__">All discounts</option>
                {policies.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.name} ({p.code})
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 pb-2 text-xs text-[var(--brand-deep)]">
              <input
                type="checkbox"
                checked={byFamily}
                onChange={(e) => setByFamily(e.target.checked)}
              />
              Siblings together
            </label>
          </div>

          <div ref={printRef}>
            <h3 className="text-lg font-bold text-[var(--brand-deep)]">
              {policyCode === "__all__"
                ? "All discounts"
                : `${activePolicy.name} (${activePolicy.code})`}
            </h3>
            <p className="meta text-sm text-[var(--muted)]">
              {policyCode === "__all__"
                ? `Every discount policy`
                : `${kindLabel} · ${formatConcessionValue(activePolicy)}`}{" "}
              · Session {ay} · {rows.length} student
              {rows.length === 1 ? "" : "s"}
              {byFamily
                ? ` in ${families.length} famil${families.length === 1 ? "y" : "ies"}`
                : ""}
              {nameQuery.trim() ? ` · filtered by “${nameQuery.trim()}”` : ""} ·
              Printed {printedAt}
            </p>
            {byFamily ? (
              <ConcessionFamilyPrintTable
                families={families}
                showPolicy={policyCode === "__all__"}
              />
            ) : (
              <ConcessionStudentPrintTable
                rows={rows}
                showPolicy={policyCode === "__all__"}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyList({ filtered }: { filtered: boolean }) {
  return (
    <p className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--card)]/70 px-4 py-10 text-center text-sm text-[var(--muted)]">
      {filtered
        ? "No student matches that search."
        : "No students assigned to this discount yet."}
    </p>
  );
}

/**
 * Siblings under one heading, so a discount can be justified at a glance.
 *
 * The question this answers is "why this child and not his brother?" — and a
 * list sorted by class puts the two of them pages apart.
 */
function ConcessionFamilyPrintTable({
  families,
  showPolicy,
}: {
  families: ConcessionFamilyGroup[];
  showPolicy: boolean;
}) {
  if (families.length === 0) return <EmptyList filtered />;
  return (
    <div className="space-y-3">
      {families.map((family) => (
        <ErpTableShell
          key={family.householdId || family.rows[0]?.id}
          className="overflow-x-auto"
        >
          <p className="border-b border-[var(--border)] bg-[var(--surface-sunken)] px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--brand-deep)]">
            {family.fatherName || "No father on file"}
            <span className="ml-2 font-normal normal-case text-[var(--muted)]">
              {family.rows.length} child
              {family.rows.length === 1 ? "" : "ren"} on discount
            </span>
          </p>
          <ErpTable minWidth="min-w-[640px]">
            <ErpTableHead>
              <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                <th className="px-3 py-2">Admission no.</th>
                <th className="px-3 py-2">Student</th>
                <th className="px-3 py-2">Class</th>
                {showPolicy ? <th className="px-3 py-2">Discount</th> : null}
                <th className="px-3 py-2">Sibling</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">From</th>
              </tr>
            </ErpTableHead>
            <ErpTableBody>
              {family.rows.map((row) => (
                <tr key={row.id} className="text-[var(--brand-deep)]">
                  <td className="px-3 py-2 font-medium">{row.admissionNo}</td>
                  <td className="px-3 py-2">{row.studentName}</td>
                  <td className="px-3 py-2">{row.classLabel}</td>
                  {showPolicy ? (
                    <td className="px-3 py-2">{row.concessionName}</td>
                  ) : null}
                  <td className="px-3 py-2 text-[var(--muted)]">
                    {row.siblingNote}
                  </td>
                  <td className="status px-3 py-2 capitalize">{row.status}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {row.effectiveFrom}
                  </td>
                </tr>
              ))}
            </ErpTableBody>
          </ErpTable>
        </ErpTableShell>
      ))}
    </div>
  );
}

function ConcessionStudentPrintTable({
  rows,
  showPolicy,
}: {
  rows: ConcessionStudentListRow[];
  showPolicy: boolean;
}) {
  if (rows.length === 0) return <EmptyList filtered />;

  return (
    <ErpTableShell className="overflow-x-auto">
      <ErpTable minWidth="min-w-[640px]">
        <ErpTableHead>
          <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
            <th className="px-3 py-2.5">#</th>
            <th className="px-3 py-2.5">Admission no.</th>
            <th className="px-3 py-2.5">Student</th>
            <th className="px-3 py-2.5">Father</th>
            <th className="px-3 py-2.5">Class</th>
            {showPolicy ? <th className="px-3 py-2.5">Discount</th> : null}
            <th className="px-3 py-2.5">Status</th>
            <th className="px-3 py-2.5">From</th>
            <th className="px-3 py-2.5">Reason</th>
          </tr>
        </ErpTableHead>
        <ErpTableBody>
          {rows.map((row, idx) => (
            <tr key={row.id} className="text-[var(--brand-deep)]">
              <td className="num px-3 py-2 tabular-nums text-[var(--muted)]">
                {idx + 1}
              </td>
              <td className="px-3 py-2 font-medium">{row.admissionNo}</td>
              <td className="px-3 py-2">{row.studentName}</td>
              <td className="px-3 py-2">{row.fatherName}</td>
              <td className="px-3 py-2">{row.classLabel}</td>
              {showPolicy ? (
                <td className="px-3 py-2">{row.concessionName}</td>
              ) : null}
              <td className="status px-3 py-2 capitalize">{row.status}</td>
              <td className="px-3 py-2 whitespace-nowrap">
                {row.effectiveFrom}
              </td>
              <td className="px-3 py-2 text-[var(--muted)]">{row.reason}</td>
            </tr>
          ))}
        </ErpTableBody>
      </ErpTable>
    </ErpTableShell>
  );
}
