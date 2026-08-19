"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  STAFF_CATEGORIES,
  STAFF_STREAMS,
  type StaffCategory,
  type StaffStream,
} from "@/lib/foundationMasters";
import { loadMasters, type MastersState } from "@/lib/masters";
import {
  buildStructureLinesFromPack,
  cloneSalaryStructure,
  computeStructureAmounts,
  loadSalarySetup,
  newSalaryId,
  normalizeSalarySettings,
  normalizeStatutoryCover,
  resolveStructureForStaff,
  saveSalarySetup,
  salarySetupCompleteness,
  STATUTORY_COVER_OPTIONS,
  isEsicHeadCode,
  isPfHeadCode,
  statutoryCeilingsFrom,
  SCHOOL_SALARY_BANK,
  type SalaryHead,
  type SalaryHeadKind,
  type SalaryLineCalc,
  type SalarySetupState,
  type SalaryStructure,
  type StaffSalaryLink,
  type StatutoryCover,
} from "@/lib/salarySetup";
import { canManagePayroll } from "@/lib/staffResolve";
import { useDemoSession } from "@/components/shell/SessionContext";
import { ModuleTabs } from "@/components/ui/ModuleTabs";
import {
  ErpTable,
  ErpTableBody,
  ErpTableHead,
} from "@/components/ui/erp-roster";
import {
  MastersEmptyRow,
  MastersTableCard,
  MastersTablesRow,
  MastersWorkCard,
} from "@/components/masters/MastersLayout";
import { RemoveControl } from "@/components/masters/RemoveControl";
import { IncrementPanel } from "@/components/payroll/IncrementPanel";

type SalTab = "settings" | "heads" | "structures" | "assign" | "increment";

const HEAD_KINDS: { value: SalaryHeadKind; label: string }[] = [
  { value: "earning", label: "Earning" },
  { value: "deduction", label: "Deduction" },
  { value: "employer", label: "Employer contrib" },
];

export function SalarySetupPanel() {
  const session = useDemoSession();
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [state, setState] = useState<SalarySetupState | null>(null);
  const [tab, setTab] = useState<SalTab>("settings");
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setMasters(loadMasters());
    setState(loadSalarySetup());
    // Pull the server copy (salary_setup_state) and re-read; the login-time
    // cache wipe means the local copy is empty on a fresh session.
    let cancelled = false;
    void import("@/lib/salarySetupPersistence").then(({ ensureSalarySetupHydrated }) =>
      ensureSalarySetupHydrated().then(() => {
        if (!cancelled) setState(loadSalarySetup());
      }),
    );
    const onUpdated = () => setState(loadSalarySetup());
    window.addEventListener("bhb-salary-setup-updated", onUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener("bhb-salary-setup-updated", onUpdated);
    };
  }, []);

  const allowed = useMemo(() => {
    if (!masters) return false;
    return canManagePayroll(session, masters);
  }, [masters, session]);

  function commit(next: SalarySetupState, msg?: string) {
    setState(next);
    saveSalarySetup(next);
    if (msg) {
      setNotice(msg);
      window.setTimeout(() => setNotice(null), 2400);
    }
  }

  if (!state || !masters) {
    return <p className="text-sm text-[var(--muted)]">Loading salary setup…</p>;
  }

  if (!allowed) {
    return (
      <p className="rounded-xl border border-[rgba(180,35,24,0.25)] bg-[rgba(180,35,24,0.06)] px-4 py-3 text-sm text-[var(--brand-deep)]">
        Salary setup is Admin / Principal only. Accounts cannot view or edit
        salary structures (§6i.4).
      </p>
    );
  }

  const complete = salarySetupCompleteness(state);

  return (
    <div className="space-y-4">
      <p className="rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] px-4 py-3 text-sm text-[var(--muted)]">
        Salary heads, structure templates, pay cycle, and staff assignment.
        Completeness:{" "}
        <span className="font-semibold text-[var(--brand-deep)]">
          {complete.detail}
        </span>
        . Run payroll in{" "}
        <Link
          href="/payroll"
          className="font-semibold text-[var(--brand-deep)] underline-offset-2 hover:underline"
        >
          Payroll
        </Link>
        .
      </p>
      {notice ? (
        <p className="text-sm font-medium text-[var(--brand-deep)]">{notice}</p>
      ) : null}
      <ModuleTabs
        aria-label="Salary setup"
        value={tab}
        onChange={(id) => setTab(id as SalTab)}
        items={[
          { id: "settings", label: "Pay cycle", tone: "navy" },
          { id: "heads", label: "Heads", tone: "teal" },
          { id: "structures", label: "Structures", tone: "amber" },
          { id: "assign", label: "Assign staff", tone: "violet" },
          { id: "increment", label: "Increment", tone: "coral" },
        ]}
      />
      {tab === "settings" ? (
        <PayCyclePanel state={state} commit={commit} />
      ) : null}
      {tab === "heads" ? (
        <HeadsPanel state={state} commit={commit} />
      ) : null}
      {tab === "structures" ? (
        <StructuresPanel state={state} commit={commit} masters={masters} />
      ) : null}
      {tab === "assign" ? (
        <AssignPanel state={state} commit={commit} masters={masters} />
      ) : null}
      {tab === "increment" ? <IncrementPanel mode="full" /> : null}
    </div>
  );
}

function PayCyclePanel({
  state,
  commit,
}: {
  state: SalarySetupState;
  commit: (s: SalarySetupState, msg?: string) => void;
}) {
  const s = normalizeSalarySettings(state.settings);
  const [form, setForm] = useState(s);

  useEffect(() => {
    setForm(normalizeSalarySettings(state.settings));
  }, [state.settings]);

  return (
    <MastersWorkCard
      title="Pay cycle & salary account"
      hint="Union Bank · Murdaha Bazar, Varanasi"
    >      <div className="grid max-w-3xl gap-2 sm:grid-cols-3">
        <label className="text-[11px] text-[var(--muted)]">
          Salary day count
          <input
            className="field mt-1 !py-1.5"
            type="number"
            min={1}
            max={31}
            value={form.dayCount}
            onChange={(e) =>
              setForm({ ...form, dayCount: Number(e.target.value) || 30 })
            }
          />
        </label>
        <label className="text-[11px] text-[var(--muted)]">
          Attendance cut-off day
          <input
            className="field mt-1 !py-1.5"
            type="number"
            min={1}
            max={28}
            value={form.cutoffDay}
            onChange={(e) =>
              setForm({ ...form, cutoffDay: Number(e.target.value) || 25 })
            }
          />
        </label>
        <label className="text-[11px] text-[var(--muted)]">
          Pay day (next month)
          <input
            className="field mt-1 !py-1.5"
            type="number"
            min={1}
            max={28}
            value={form.payDay}
            onChange={(e) =>
              setForm({ ...form, payDay: Number(e.target.value) || 1 })
            }
          />
        </label>
        <label className="text-[11px] text-[var(--muted)] sm:col-span-2">
          Salary account label
          <input
            className="field mt-1 !py-1.5"
            value={form.salaryAccountLabel}
            onChange={(e) =>
              setForm({ ...form, salaryAccountLabel: e.target.value })
            }
          />
        </label>
        <label className="text-[11px] text-[var(--muted)]">
          Bank name
          <input
            className="field mt-1 !py-1.5"
            value={form.salaryBankName}
            onChange={(e) =>
              setForm({ ...form, salaryBankName: e.target.value })
            }
          />
        </label>
        <label className="text-[11px] text-[var(--muted)]">
          Branch
          <input
            className="field mt-1 !py-1.5"
            value={form.salaryBankBranch}
            placeholder="Murdaha Bazar, Varanasi"
            onChange={(e) =>
              setForm({ ...form, salaryBankBranch: e.target.value })
            }
          />
        </label>
        <label className="text-[11px] text-[var(--muted)]">
          Account no.
          <input
            className="field mt-1 !py-1.5"
            value={form.salaryBankAccountNo}
            placeholder="Your Union Bank salary a/c"
            onChange={(e) =>
              setForm({ ...form, salaryBankAccountNo: e.target.value })
            }
          />
        </label>
        <label className="text-[11px] text-[var(--muted)]">
          IFSC (UBIN0548847)
          <input
            className="field mt-1 !py-1.5"
            value={form.salaryBankIfsc}
            onChange={(e) =>
              setForm({ ...form, salaryBankIfsc: e.target.value })
            }
          />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-[var(--primary-foreground)]"
          onClick={() =>
            commit(
              {
                ...state,
                settings: normalizeSalarySettings(form),
              },
              "Pay cycle saved",
            )
          }
        >
          Save pay cycle
        </button>
        <button
          type="button"
          className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--brand-deep)]"
          onClick={() =>
            setForm((f) =>
              normalizeSalarySettings({
                ...f,
                salaryBankName: SCHOOL_SALARY_BANK.name,
                salaryBankBranch: SCHOOL_SALARY_BANK.branch,
                salaryBankIfsc: SCHOOL_SALARY_BANK.ifsc,
                salaryAccountLabel:
                  "Salary account — Union Bank Murdaha Bazar",
              }),
            )
          }
        >
          Fill Union Bank Murdaha Bazar
        </button>
      </div>
    </MastersWorkCard>
  );
}

function HeadsPanel({
  state,
  commit,
}: {
  state: SalarySetupState;
  commit: (s: SalarySetupState, msg?: string) => void;
}) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<SalaryHeadKind>("earning");

  const heads = [...state.heads].sort((a, b) => a.sortOrder - b.sortOrder);

  function add() {
    if (!code.trim() || !name.trim()) return;
    const row: SalaryHead = {
      id: newSalaryId("sh"),
      code: code.trim().toUpperCase(),
      name: name.trim(),
      kind,
      tallyLedger: name.trim(),
      isActive: true,
      sortOrder: heads.length + 1,
    };
    commit({ ...state, heads: [...state.heads, row] }, `Head ${row.code}`);
    setCode("");
    setName("");
  }

  return (
    <>
      <MastersTablesRow>
        <MastersTableCard title={`Salary heads (${heads.filter((h) => h.isActive).length})`}>
          <ul className="divide-y divide-[var(--border)]">
            {heads.map((h) => (
              <li
                key={h.id}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5"
              >
                <div>
                  <div className="text-sm font-semibold text-[var(--brand-deep)]">
                    {h.code}{" "}
                    <span className="text-[10px] font-medium uppercase text-[var(--muted)]">
                      {h.kind}
                    </span>
                    {!h.isActive ? (
                      <span className="ml-1 text-[10px] text-[var(--muted)]">
                        (inactive)
                      </span>
                    ) : null}
                  </div>
                  <p className="text-[11px] text-[var(--muted)]">{h.name}</p>
                </div>
                <button
                  type="button"
                  className="text-[11px] font-semibold"
                  onClick={() =>
                    commit({
                      ...state,
                      heads: state.heads.map((x) =>
                        x.id === h.id ? { ...x, isActive: !x.isActive } : x,
                      ),
                    })
                  }
                >
                  {h.isActive ? "Disable" : "Enable"}
                </button>
              </li>
            ))}
            {heads.length === 0 ? (
              <li className="px-4 py-8 text-center text-sm text-[var(--muted)]">
                No heads
              </li>
            ) : null}
          </ul>
        </MastersTableCard>
      </MastersTablesRow>
      <MastersWorkCard title="Add salary head">
        <div className="grid max-w-2xl gap-2 sm:grid-cols-3">
          <input
            className="field !py-1.5"
            placeholder="Code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <input
            className="field !py-1.5"
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <select
            className="field !py-1.5"
            value={kind}
            onChange={(e) => setKind(e.target.value as SalaryHeadKind)}
          >
            {HEAD_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className="mt-3 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-[var(--primary-foreground)]"
          onClick={add}
        >
          Add head
        </button>
      </MastersWorkCard>
    </>
  );
}

function StructuresPanel({
  state,
  commit,
  masters,
}: {
  state: SalarySetupState;
  commit: (s: SalarySetupState, msg?: string) => void;
  masters: MastersState;
}) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [stream, setStream] = useState<StaffStream | "">("teaching");
  const [category, setCategory] = useState<StaffCategory | "">("");
  const [designationId, setDesignationId] = useState("");
  const [editId, setEditId] = useState<string | null>(
    () => state.structures[0]?.id ?? null,
  );
  const [lineHeadId, setLineHeadId] = useState("");
  const [lineCalc, setLineCalc] = useState<SalaryLineCalc>("fixed");
  const [lineAmount, setLineAmount] = useState("");
  const [cloneFromId, setCloneFromId] = useState("");
  const [cloneScale, setCloneScale] = useState("100");
  const [pack, setPack] = useState({
    basic: "20000",
    daPercent: "20",
    hraPercent: "40",
    taFixed: "1600",
    specialFixed: "0",
    pfPercent: "12",
    ptFixed: "200",
  });

  const activeHeads = state.heads.filter((h) => h.isActive);
  const editing = state.structures.find((s) => s.id === editId) ?? null;

  function addStructure() {
    if (!code.trim() || !name.trim()) return;
    if (state.structures.some((s) => s.code === code.trim().toUpperCase())) {
      return;
    }
    const lines = buildStructureLinesFromPack(state.heads, {
      basic: Number(pack.basic) || 0,
      daPercent: Number(pack.daPercent) || 0,
      hraPercent: Number(pack.hraPercent) || 0,
      taFixed: Number(pack.taFixed) || 0,
      specialFixed: Number(pack.specialFixed) || 0,
      pfPercent: Number(pack.pfPercent) || 0,
      ptFixed: Number(pack.ptFixed) || 0,
    });
    const row: SalaryStructure = {
      id: newSalaryId("ss"),
      code: code.trim().toUpperCase(),
      name: name.trim(),
      designationId,
      category,
      stream,
      lines,
      isActive: true,
      note: "",
    };
    commit(
      { ...state, structures: [...state.structures, row] },
      `Structure ${row.code} created`,
    );
    setCode("");
    setName("");
    setEditId(row.id);
  }

  function cloneStructure() {
    const source = state.structures.find((s) => s.id === cloneFromId);
    if (!source || !code.trim() || !name.trim()) return;
    if (state.structures.some((s) => s.code === code.trim().toUpperCase())) {
      return;
    }
    const row = cloneSalaryStructure(source, {
      code: code.trim(),
      name: name.trim(),
      scalePercent: Number(cloneScale) || 100,
    });
    row.stream = stream;
    row.category = category;
    row.designationId = designationId;
    commit(
      { ...state, structures: [...state.structures, row] },
      `Cloned ${source.code} → ${row.code}`,
    );
    setCode("");
    setName("");
    setCloneFromId("");
    setEditId(row.id);
  }

  function updateEditing(patch: Partial<SalaryStructure>) {
    if (!editing) return;
    commit({
      ...state,
      structures: state.structures.map((s) =>
        s.id === editing.id ? { ...s, ...patch } : s,
      ),
    });
  }

  function setLineAmountInline(
    headId: string,
    amount: number,
    calc?: SalaryLineCalc,
  ) {
    if (!editing) return;
    updateEditing({
      lines: editing.lines.map((l) =>
        l.headId === headId
          ? { ...l, amount: Math.max(0, amount), calc: calc ?? l.calc }
          : l,
      ),
    });
  }

  function addLine() {
    if (!editing || !lineHeadId) return;
    const amount = Number(lineAmount) || 0;
    updateEditing({
      lines: [
        ...editing.lines.filter((l) => l.headId !== lineHeadId),
        { headId: lineHeadId, calc: lineCalc, amount },
      ],
    });
    setLineAmount("");
  }

  function applyPackToEditing() {
    if (!editing) return;
    const lines = buildStructureLinesFromPack(state.heads, {
      basic: Number(pack.basic) || 0,
      daPercent: Number(pack.daPercent) || 0,
      hraPercent: Number(pack.hraPercent) || 0,
      taFixed: Number(pack.taFixed) || 0,
      specialFixed: Number(pack.specialFixed) || 0,
      pfPercent: Number(pack.pfPercent) || 0,
      ptFixed: Number(pack.ptFixed) || 0,
    });
    // Keep any extra heads not in the pack
    const packHeadIds = new Set(lines.map((l) => l.headId));
    const extras = editing.lines.filter((l) => !packHeadIds.has(l.headId));
    updateEditing({ lines: [...lines, ...extras] });
  }

  const preview = editing
    ? computeStructureAmounts(state, editing, 0, "both", masters.statutoryConfig)
    : null;

  return (
    <>
      <p className="rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] px-4 py-3 text-sm text-[var(--muted)]">
        Create as many structures as the school needs (e.g. PRT ₹18k, TGT ₹25k,
        PGT ₹32k, Clerk ₹12k) — each with its own amounts. Assign staff under{" "}
        <span className="font-semibold text-[var(--brand-deep)]">
          Assign staff
        </span>
        .
      </p>

      <MastersTablesRow>
        <MastersTableCard
          title={`Structures (${state.structures.length})`}
        >
          <ul className="divide-y divide-[var(--border)]">
            {state.structures.map((s) => {
              const amounts = computeStructureAmounts(state, s, 0, "both", masters.statutoryConfig);
              const selected = s.id === editId;
              return (
                <li
                  key={s.id}
                  className={`flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 ${
                    selected ? "bg-[var(--surface-sunken)]" : ""
                  }`}
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => setEditId(s.id)}
                  >
                    <div className="text-sm font-semibold text-[var(--brand-deep)]">
                      {s.name}{" "}
                      <span className="text-[10px] font-medium text-[var(--muted)]">
                        {s.code}
                      </span>
                    </div>
                    <p className="text-[11px] text-[var(--muted)]">
                      Gross ₹{amounts.gross.toLocaleString("en-IN")} ·{" "}
                      {s.stream || "any"} · {s.lines.length} heads
                      {!s.isActive ? " · inactive" : ""}
                    </p>
                  </button>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="text-[11px] font-semibold"
                      onClick={() => {
                        setCloneFromId(s.id);
                        setCode(`${s.code}_2`);
                        setName(`${s.name} (copy)`);
                        setStream(s.stream);
                        setCategory(s.category);
                        setDesignationId(s.designationId);
                      }}
                    >
                      Clone
                    </button>
                    <button
                      type="button"
                      className="text-[11px] font-semibold"
                      onClick={() =>
                        commit({
                          ...state,
                          structures: state.structures.map((x) =>
                            x.id === s.id
                              ? { ...x, isActive: !x.isActive }
                              : x,
                          ),
                        })
                      }
                    >
                      {s.isActive ? "Disable" : "Enable"}
                    </button>
                    <RemoveControl
                      check={{
                        canRemove: true,
                        blockers: [],
                        confirmMessage: "Remove this structure?",
                        suggestion: "",
                      }}
                      onRemove={() => {
                        commit({
                          ...state,
                          structures: state.structures.filter(
                            (x) => x.id !== s.id,
                          ),
                          staffLinks: state.staffLinks.filter(
                            (l) => l.structureId !== s.id,
                          ),
                        });
                        if (editId === s.id) setEditId(null);
                      }}
                    />
                  </div>
                </li>
              );
            })}
            {state.structures.length === 0 ? (
              <li className="px-4 py-8 text-center text-sm text-[var(--muted)]">
                No structures yet
              </li>
            ) : null}
          </ul>
        </MastersTableCard>
        {editing && preview ? (
          <MastersTableCard title={`Preview · ${editing.name}`}>
            <div className="space-y-1 px-4 py-3 text-[11px]">
              <p>
                Gross{" "}
                <strong>₹{preview.gross.toLocaleString("en-IN")}</strong> ·
                Deductions ₹
                {preview.totalDeductions.toLocaleString("en-IN")} · Net ≈ ₹
                {(preview.gross - preview.totalDeductions).toLocaleString(
                  "en-IN",
                )}
              </p>
              {preview.earnings.map((e) => (
                <div key={e.head.id} className="flex justify-between">
                  <span>{e.head.name}</span>
                  <span>₹{e.amount.toLocaleString("en-IN")}</span>
                </div>
              ))}
              {preview.deductions.map((e) => (
                <div
                  key={e.head.id}
                  className="flex justify-between text-[var(--danger)]"
                >
                  <span>{e.head.name}</span>
                  <span>−₹{e.amount.toLocaleString("en-IN")}</span>
                </div>
              ))}
            </div>
          </MastersTableCard>
        ) : null}
      </MastersTablesRow>

      <MastersWorkCard
        title="New structure (with amounts)"
        hint="Different scales for different roles"
      >
        <div className="grid max-w-4xl gap-2 sm:grid-cols-3">
          <input
            className="field !py-1.5"
            placeholder="Code e.g. TGT"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <input
            className="field !py-1.5 sm:col-span-2"
            placeholder="Name e.g. TGT — Middle school"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <select
            className="field !py-1.5"
            value={stream}
            onChange={(e) =>
              setStream((e.target.value || "") as StaffStream | "")
            }
          >
            <option value="">Any stream</option>
            {STAFF_STREAMS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <select
            className="field !py-1.5"
            value={category}
            onChange={(e) =>
              setCategory((e.target.value || "") as StaffCategory | "")
            }
          >
            <option value="">Any category</option>
            {STAFF_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          <select
            className="field !py-1.5"
            value={designationId}
            onChange={(e) => setDesignationId(e.target.value)}
          >
            <option value="">Any designation</option>
            {masters.designations
              .filter((d) => d.isActive)
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
          </select>
        </div>

        <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
          Starting amounts (edit anytime after create)
        </p>
        <div className="mt-1 grid max-w-4xl gap-2 sm:grid-cols-4">
          {(
            [
              ["basic", "Basic ₹"],
              ["daPercent", "DA %"],
              ["hraPercent", "HRA %"],
              ["taFixed", "Transport ₹"],
              ["specialFixed", "Special ₹"],
              ["pfPercent", "PF %"],
              ["ptFixed", "Prof. tax ₹"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="text-[11px] text-[var(--muted)]">
              {label}
              <input
                className="field mt-1 !py-1.5"
                type="number"
                min={0}
                value={pack[key]}
                onChange={(e) =>
                  setPack((p) => ({ ...p, [key]: e.target.value }))
                }
              />
            </label>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-end gap-2">
          <button
            type="button"
            className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-[var(--primary-foreground)]"
            onClick={addStructure}
          >
            Create structure
          </button>
          <select
            className="field !w-auto !py-1.5 text-[11px]"
            value={cloneFromId}
            onChange={(e) => setCloneFromId(e.target.value)}
          >
            <option value="">Or clone from…</option>
            {state.structures.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} — {s.name}
              </option>
            ))}
          </select>
          {cloneFromId ? (
            <>
              <label className="text-[11px] text-[var(--muted)]">
                Scale fixed ₹ %
                <input
                  className="field mt-1 !w-20 !py-1.5"
                  type="number"
                  min={1}
                  value={cloneScale}
                  onChange={(e) => setCloneScale(e.target.value)}
                />
              </label>
              <button
                type="button"
                className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--brand-deep)]"
                onClick={cloneStructure}
              >
                Clone with new code/name
              </button>
            </>
          ) : null}
        </div>
      </MastersWorkCard>

      {editing ? (
        <MastersWorkCard title={`Edit amounts · ${editing.name}`}>
          <div className="mb-3 grid max-w-3xl gap-2 sm:grid-cols-3">
            <input
              className="field !py-1.5"
              value={editing.code}
              onChange={(e) =>
                updateEditing({ code: e.target.value.toUpperCase() })
              }
            />
            <input
              className="field !py-1.5 sm:col-span-2"
              value={editing.name}
              onChange={(e) => updateEditing({ name: e.target.value })}
            />
          </div>

          <ul className="mb-3 divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
            {editing.lines.map((l) => {
              const h = state.heads.find((x) => x.id === l.headId);
              return (
                <li
                  key={l.headId}
                  className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm"
                >
                  <span className="min-w-[8rem] flex-1 font-medium text-[var(--brand-deep)]">
                    {h?.name ?? l.headId}
                    <span className="ml-1 text-[10px] font-normal text-[var(--muted)]">
                      {h?.kind}
                    </span>
                  </span>
                  <select
                    className="field !w-auto !py-1 text-[11px]"
                    value={l.calc}
                    onChange={(e) =>
                      setLineAmountInline(
                        l.headId,
                        l.amount,
                        e.target.value as SalaryLineCalc,
                      )
                    }
                  >
                    <option value="fixed">Fixed ₹</option>
                    <option value="percent_of_basic">% of basic</option>
                  </select>
                  <input
                    className="field !w-28 !py-1 text-[11px]"
                    type="number"
                    min={0}
                    value={l.amount}
                    onChange={(e) =>
                      setLineAmountInline(
                        l.headId,
                        Number(e.target.value) || 0,
                      )
                    }
                  />
                  <button
                    type="button"
                    className="text-[11px] font-semibold text-[var(--danger)]"
                    onClick={() =>
                      updateEditing({
                        lines: editing.lines.filter(
                          (x) => x.headId !== l.headId,
                        ),
                      })
                    }
                  >
                    Remove
                  </button>
                </li>
              );
            })}
            {editing.lines.length === 0 ? (
              <li className="px-3 py-3 text-[11px] text-[var(--muted)]">
                No lines — add heads below or apply the amount pack.
              </li>
            ) : null}
          </ul>

          <div className="mb-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-[11px] font-semibold"
              onClick={applyPackToEditing}
            >
              Replace with pack amounts above
            </button>
          </div>

          <div className="grid max-w-3xl gap-2 sm:grid-cols-4">
            <select
              className="field !py-1.5 sm:col-span-2"
              value={lineHeadId}
              onChange={(e) => setLineHeadId(e.target.value)}
            >
              <option value="">Add another head</option>
              {activeHeads.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.code} — {h.name}
                </option>
              ))}
            </select>
            <select
              className="field !py-1.5"
              value={lineCalc}
              onChange={(e) =>
                setLineCalc(e.target.value as SalaryLineCalc)
              }
            >
              <option value="fixed">Fixed ₹</option>
              <option value="percent_of_basic">% of basic</option>
            </select>
            <input
              className="field !py-1.5"
              placeholder="Amount"
              value={lineAmount}
              onChange={(e) => setLineAmount(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="mt-3 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-[var(--primary-foreground)]"
            onClick={addLine}
          >
            Add / update head line
          </button>
        </MastersWorkCard>
      ) : null}
    </>
  );
}
function AssignPanel({
  state,
  commit,
  masters,
}: {
  state: SalarySetupState;
  commit: (s: SalarySetupState, msg?: string) => void;
  masters: MastersState;
}) {
  type Draft = {
    structureId: string;
    basicOverride: string;
    statutoryCover: StatutoryCover;
  };

  const roster = (masters.staff ?? [])
    .filter((s) => s.status === "active")
    .sort((a, b) => a.empCode.localeCompare(b.empCode));

  /** Local edits — nothing persisted until Assign */
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});

  function savedDraft(staffId: string): Draft {
    const link = state.staffLinks.find((l) => l.staffId === staffId);
    return {
      structureId: link?.structureId || "",
      basicOverride:
        link && link.basicOverride > 0 ? String(link.basicOverride) : "",
      statutoryCover: normalizeStatutoryCover(link?.statutoryCover),
    };
  }

  function currentDraft(staffId: string): Draft {
    return drafts[staffId] ?? savedDraft(staffId);
  }

  function isDirty(staffId: string): boolean {
    const d = drafts[staffId];
    if (!d) return false;
    const s = savedDraft(staffId);
    return (
      d.structureId !== s.structureId ||
      d.basicOverride !== s.basicOverride ||
      d.statutoryCover !== s.statutoryCover
    );
  }

  function patchDraft(staffId: string, patch: Partial<Draft>) {
    setDrafts((prev) => ({
      ...prev,
      [staffId]: { ...(prev[staffId] ?? savedDraft(staffId)), ...patch },
    }));
  }

  function cancelDraft(staffId: string) {
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[staffId];
      return next;
    });
  }

  function assignStaff(staffId: string) {
    const d = currentDraft(staffId);
    if (!isDirty(staffId)) return;

    if (!d.structureId) {
      commit(
        {
          ...state,
          staffLinks: state.staffLinks.filter((l) => l.staffId !== staffId),
        },
        "Assignment cleared — using auto structure",
      );
      cancelDraft(staffId);
      return;
    }

    const existing = state.staffLinks.find((l) => l.staffId === staffId);
    const row: StaffSalaryLink = {
      staffId,
      structureId: d.structureId,
      basicOverride: Math.max(0, Number(d.basicOverride) || 0),
      statutoryCover: normalizeStatutoryCover(d.statutoryCover),
      effectiveFrom:
        existing?.effectiveFrom || new Date().toISOString().slice(0, 10),
      salaryAccountNote: existing?.salaryAccountNote || "",
    };
    commit(
      {
        ...state,
        staffLinks: [
          ...state.staffLinks.filter((l) => l.staffId !== staffId),
          row,
        ],
      },
      "Staff salary assignment saved",
    );
    cancelDraft(staffId);
  }

  const dirtyCount = roster.filter((s) => isDirty(s.id)).length;

  return (
    <MastersTableCard title="Staff → structure & PF / ESIC">
      <p className="border-b border-[var(--border)] px-4 py-2 text-[11px] text-[var(--muted)]">
        Changes are{" "}
        <strong className="text-[var(--brand-deep)]">not saved</strong> until
        you click{" "}
        <strong className="text-[var(--brand-deep)]">Assign</strong>. Wrong
        select? use{" "}
        <strong className="text-[var(--brand-deep)]">Cancel</strong> to
        revert. PF / ESIC: both, PF only, ESIC only, or neither.
        {dirtyCount > 0 ? (
          <span className="ml-1 font-semibold text-[var(--warning)]">
            · {dirtyCount} unsaved row{dirtyCount > 1 ? "s" : ""}
          </span>
        ) : null}
      </p>
      <div className="overflow-x-auto">
        <ErpTable minWidth="min-w-[860px]">
          <ErpTableHead>
            <tr className="text-[11px] text-[var(--muted)]">
              <th className="px-3 py-2 font-medium">Staff</th>
              <th className="px-3 py-2 font-medium">Saved</th>
              <th className="px-3 py-2 font-medium">Structure</th>
              <th className="px-3 py-2 font-medium">Basic override</th>
              <th className="px-3 py-2 font-medium">PF / ESIC</th>
              <th className="px-3 py-2 font-medium">Action</th>
            </tr>
          </ErpTableHead>
          <ErpTableBody>
            {roster.map((s) => {
              const link = state.staffLinks.find((l) => l.staffId === s.id);
              const draft = currentDraft(s.id);
              const dirty = isDirty(s.id);
              const structureForPreview =
                state.structures.find(
                  (x) => x.id === draft.structureId && x.isActive,
                ) ?? resolveStructureForStaff(state, s);
              const preview = structureForPreview
                ? computeStructureAmounts(
                    state,
                    structureForPreview,
                    Number(draft.basicOverride) || 0,
                    draft.statutoryCover,
                    masters.statutoryConfig,
                  )
                : null;
              const savedLabel = link
                ? state.structures.find((x) => x.id === link.structureId)
                    ?.name ?? "Assigned"
                : "Auto (by stream)";
              // What is actually saved for this staff (not the unsaved draft):
              // PF / ESIC amounts after the Masters → Statutory wage ceilings.
              const savedStructure = link
                ? state.structures.find((x) => x.id === link.structureId && x.isActive) ?? resolveStructureForStaff(state, s)
                : resolveStructureForStaff(state, s);
              const saved = savedStructure
                ? computeStructureAmounts(
                    state,
                    savedStructure,
                    link?.basicOverride || 0,
                    normalizeStatutoryCover(link?.statutoryCover),
                    masters.statutoryConfig,
                  )
                : null;
              const sumBy = (rows: { head: { code: string }; amount: number }[], test: (c: string) => boolean) =>
                rows.filter((r) => test(r.head.code)).reduce((t, r) => t + r.amount, 0);
              const savedPfEe = saved ? sumBy(saved.deductions, isPfHeadCode) : 0;
              const savedPfEr = saved ? sumBy(saved.employer, isPfHeadCode) : 0;
              const savedEsicEe = saved ? sumBy(saved.deductions, isEsicHeadCode) : 0;
              const savedEsicEr = saved ? sumBy(saved.employer, isEsicHeadCode) : 0;
              const savedCover = normalizeStatutoryCover(link?.statutoryCover);
              const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

              return (
                <tr
                  key={s.id}
                  className={dirty ? "bg-[rgba(197,160,40,0.08)]" : ""}
                >
                  <td className="px-3 py-2">
                    <div className="font-semibold text-[var(--brand-deep)]">
                      {s.fullName}
                    </div>
                    <div className="text-[10px] text-[var(--muted)]">
                      {s.empCode} · {s.stream}
                      {preview
                        ? ` · draft net ≈ ₹${(
                            preview.gross - preview.totalDeductions
                          ).toLocaleString("en-IN")}`
                        : ""}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-[11px] text-[var(--muted)]">
                    {savedLabel}
                    {link?.basicOverride
                      ? ` · basic ₹${link.basicOverride.toLocaleString("en-IN")}`
                      : ""}
                    <div className="mt-0.5 space-y-0.5 text-[10px]">
                      {savedCover === "none" ? (
                        <span>No PF / ESIC</span>
                      ) : (
                        <>
                          {savedCover !== "esic_only" ? (
                            <div>
                              <span className="font-semibold text-[var(--foreground)]">PF</span>{" "}
                              {inr(savedPfEe)} <span className="opacity-70">emp</span> + {inr(savedPfEr)}{" "}
                              <span className="opacity-70">employer</span>
                            </div>
                          ) : null}
                          {savedCover !== "pf_only" ? (
                            <div>
                              <span className="font-semibold text-[var(--foreground)]">ESIC</span>{" "}
                              {savedEsicEe + savedEsicEr > 0 ? (
                                <>
                                  {inr(savedEsicEe)} <span className="opacity-70">emp</span> + {inr(savedEsicEr)}{" "}
                                  <span className="opacity-70">employer</span>
                                </>
                              ) : (
                                <span className="opacity-70">
                                  {saved && saved.gross > statutoryCeilingsFrom(masters.statutoryConfig).esicWageCeiling
                                    ? `not applicable (gross above ₹${statutoryCeilingsFrom(masters.statutoryConfig).esicWageCeiling.toLocaleString("en-IN")})`
                                    : "₹0"}
                                </span>
                              )}
                            </div>
                          ) : null}
                        </>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      className="field !py-1 text-[11px]"
                      value={draft.structureId}
                      onChange={(e) =>
                        patchDraft(s.id, { structureId: e.target.value })
                      }
                    >
                      <option value="">Auto (by stream)</option>
                      {state.structures
                        .filter((x) => x.isActive)
                        .map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.name}
                          </option>
                        ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      className="field !w-28 !py-1 text-[11px]"
                      type="number"
                      min={0}
                      placeholder="0"
                      value={draft.basicOverride}
                      onChange={(e) =>
                        patchDraft(s.id, { basicOverride: e.target.value })
                      }
                    />
                  </td>
                  <td className="px-3 py-2">
                    <select
                      className="field !py-1 text-[11px]"
                      value={draft.statutoryCover}
                      onChange={(e) =>
                        patchDraft(s.id, {
                          statutoryCover: e.target.value as StatutoryCover,
                        })
                      }
                    >
                      {STATUTORY_COVER_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        disabled={!dirty}
                        className="rounded-lg bg-[var(--primary)] px-2.5 py-1 text-[11px] font-semibold text-[var(--primary-foreground)] disabled:cursor-not-allowed disabled:opacity-40"
                        onClick={() => assignStaff(s.id)}
                      >
                        Assign
                      </button>
                      <button
                        type="button"
                        disabled={!dirty}
                        className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-[11px] font-semibold text-[var(--brand-deep)] disabled:cursor-not-allowed disabled:opacity-40"
                        onClick={() => cancelDraft(s.id)}
                      >
                        Cancel
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </ErpTableBody>
        </ErpTable>
      </div>
    </MastersTableCard>
  );
}
