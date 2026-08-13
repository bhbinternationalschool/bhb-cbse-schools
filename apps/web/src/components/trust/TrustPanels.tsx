"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { loadAccounts } from "@/lib/accountsStore";
import { formatInr } from "@/lib/masters";
import {
  approveRaBill,
  capitaliseProject,
  createCostLine,
  createRaBill,
  createWorkOrder,
  dashboardSnapshot,
  listOverdueAllotments,
  listProjectCostLines,
  materialBalance,
  payCostLine,
  payLabourEntry,
  payRaBill,
  projectKpis,
  projectTypeLabel,
  suggestRate,
  updateAllotmentProgress,
  upsertAllotment,
  upsertContractor,
  upsertLabourEntry,
  upsertMaterialLine,
  upsertProject,
  upsertWorkItem,
  verifyAllotment,
  type AllotmentPartyType,
  type ProjectType,
  type TrustState,
  type WorkCategory,
} from "@/lib/trust";
import {
  TRUST_REPORTS,
  TRUST_REPORT_CATEGORIES,
  runTrustReport,
  type TrustReportFormat,
  type TrustReportId,
} from "@/lib/trustReportCatalog";

export type TrustPanelProps = {
  state: TrustState;
  selectedProjectId: string;
  onSelectProject: (id: string) => void;
  onRefresh: () => void;
  onFlash: (message: string) => void;
  onError: (message: string) => void;
  actorName: string;
};

const CARD =
  "rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4";
const FIELD =
  "w-full rounded-xl border border-[var(--border)] px-3 py-2 text-sm";
const BTN =
  "rounded-xl bg-[#0f2744] px-4 py-2 text-sm font-medium text-white";
const BTN_OUTLINE =
  "rounded-xl border border-[var(--border)] px-3 py-1.5 text-sm font-medium text-[var(--brand-deep)]";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function paiseFromInr(v: string) {
  return Math.round((Number(v) || 0) * 100);
}

function ProjectPicker({
  state,
  selectedProjectId,
  onSelectProject,
}: Pick<TrustPanelProps, "state" | "selectedProjectId" | "onSelectProject">) {
  return (
    <label className={`${CARD} flex flex-wrap items-center gap-2 text-sm`}>
      <span className="font-semibold text-[var(--brand-deep)]">Project</span>
      <select
        className={FIELD}
        value={selectedProjectId}
        onChange={(e) => onSelectProject(e.target.value)}
      >
        <option value="">Select…</option>
        {state.projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.code} · {p.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function KpiRow({ projectId, state }: { projectId: string; state: TrustState }) {
  const k = projectKpis(projectId, state);
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
      {[
        ["Budget", formatInr(k.budgetPaise)],
        ["Spent", formatInr(k.spentPaise)],
        ["Committed", formatInr(k.committedPaise)],
        ["Remaining", formatInr(k.remainingPaise)],
        ["Physical %", `${k.physicalPct}%`],
      ].map(([label, value]) => (
        <div key={label} className={CARD}>
          <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--muted)]">
            {label}
          </div>
          <div className="mt-1 text-lg font-bold text-[var(--brand-deep)]">
            {value}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ProjectsPanel({
  state,
  selectedProjectId,
  onSelectProject,
  onRefresh,
  onFlash,
  onError,
}: TrustPanelProps) {
  const snap = dashboardSnapshot(state);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [type, setType] = useState<ProjectType>("renovation");
  const [budget, setBudget] = useState("");
  const [manager, setManager] = useState("");
  const [physicalPct, setPhysicalPct] = useState("0");

  function save() {
    const res = upsertProject({
      name,
      code: code || undefined,
      type,
      budgetPaise: paiseFromInr(budget),
      managerName: manager,
      physicalPct: Number(physicalPct) || 0,
      status: "in_progress",
      startDate: todayIso(),
      targetEndDate: `${new Date().getFullYear() + 1}-03-31`,
    });
    if (!res.ok) {
      onError(res.error);
      return;
    }
    onFlash(`Project ${res.project.code} saved`);
    onSelectProject(res.project.id);
    setName("");
    onRefresh();
  }

  return (
    <div className="mt-4 space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className={CARD}>
          <div className="text-[11px] font-bold uppercase text-[var(--muted)]">
            Active projects
          </div>
          <div className="mt-1 text-2xl font-bold">{snap.activeProjects}</div>
        </div>
        <div className={CARD}>
          <div className="text-[11px] font-bold uppercase text-[var(--muted)]">
            Total budget
          </div>
          <div className="mt-1 text-2xl font-bold">
            {formatInr(snap.totalBudgetPaise)}
          </div>
        </div>
        <div className={CARD}>
          <div className="text-[11px] font-bold uppercase text-[var(--muted)]">
            Total spent
          </div>
          <div className="mt-1 text-2xl font-bold">
            {formatInr(snap.totalSpentPaise)}
          </div>
        </div>
        <div className={CARD}>
          <div className="text-[11px] font-bold uppercase text-[var(--muted)]">
            Overdue allotments
          </div>
          <div className="mt-1 text-2xl font-bold text-[var(--warning)]">
            {snap.overdueAllotments}
          </div>
        </div>
      </div>

      {selectedProjectId ? (
        <KpiRow projectId={selectedProjectId} state={state} />
      ) : null}

      <section className={`${CARD} space-y-3`}>
        <h3 className="text-sm font-bold text-[var(--brand-deep)]">New project</h3>
        <input className={FIELD} placeholder="Project name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className={FIELD} placeholder="Code (optional)" value={code} onChange={(e) => setCode(e.target.value)} />
        <select className={FIELD} value={type} onChange={(e) => setType(e.target.value as ProjectType)}>
          {(
            [
              "new_build",
              "renovation",
              "repair_major",
              "boundary",
              "lab",
              "toilet_wash",
              "playground",
              "electrical",
              "furniture_fitout",
              "other",
            ] as ProjectType[]
          ).map((t) => (
            <option key={t} value={t}>
              {projectTypeLabel(t)}
            </option>
          ))}
        </select>
        <input className={FIELD} placeholder="Sanctioned budget ₹" value={budget} onChange={(e) => setBudget(e.target.value)} />
        <input className={FIELD} placeholder="Project manager" value={manager} onChange={(e) => setManager(e.target.value)} />
        <input className={FIELD} placeholder="Physical % complete" value={physicalPct} onChange={(e) => setPhysicalPct(e.target.value)} />
        <button type="button" className={BTN} onClick={save}>
          Save project
        </button>
      </section>

      <section className={CARD}>
        <h3 className="text-sm font-bold text-[var(--brand-deep)]">All projects</h3>
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="text-left text-[var(--muted)]">
              <th className="pb-2">Code</th>
              <th className="pb-2">Name</th>
              <th className="pb-2">Status</th>
              <th className="pb-2 text-right">Budget</th>
              <th className="pb-2 text-right">Spent</th>
            </tr>
          </thead>
          <tbody>
            {state.projects.map((p) => {
              const k = projectKpis(p.id, state);
              return (
                <tr
                  key={p.id}
                  className={`cursor-pointer border-t border-[var(--border)] ${selectedProjectId === p.id ? "bg-[rgba(197,160,40,0.08)]" : ""}`}
                  onClick={() => onSelectProject(p.id)}
                >
                  <td className="py-2 font-mono text-xs">{p.code}</td>
                  <td className="py-2">{p.name}</td>
                  <td className="py-2">{p.status}</td>
                  <td className="py-2 text-right">{formatInr(k.budgetPaise)}</td>
                  <td className="py-2 text-right">{formatInr(k.spentPaise)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <div className={CARD}>
        <Link href="/accounts" className={BTN_OUTLINE}>
          Accounts · CWIP books
        </Link>
      </div>
    </div>
  );
}

export function WorksPanel({
  state,
  selectedProjectId,
  onSelectProject,
  onRefresh,
  onFlash,
  onError,
}: TrustPanelProps) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<WorkCategory>("civil");
  const [unit, setUnit] = useState("sq.ft");
  const [qty, setQty] = useState("");
  const [rate, setRate] = useState("");

  const items = state.workItems.filter(
    (w) => !selectedProjectId || w.projectId === selectedProjectId,
  );

  const suggested = suggestRate(category, unit, state);

  function add() {
    if (!selectedProjectId) {
      onError("Select a project first");
      return;
    }
    const res = upsertWorkItem({
      projectId: selectedProjectId,
      name,
      category,
      unit,
      qtyPlanned: Number(qty) || 0,
      ratePaise: paiseFromInr(rate) || suggested,
      status: "not_started",
    });
    if (!res.ok) {
      onError(res.error);
      return;
    }
    onFlash("Work item added");
    setName("");
    onRefresh();
  }

  return (
    <div className="mt-4 space-y-4">
      <ProjectPicker
        state={state}
        selectedProjectId={selectedProjectId}
        onSelectProject={onSelectProject}
      />
      <section className={`${CARD} space-y-3`}>
        <h3 className="text-sm font-bold text-[var(--brand-deep)]">Add BOQ line</h3>
        <input className={FIELD} placeholder="Work name" value={name} onChange={(e) => setName(e.target.value)} />
        <select className={FIELD} value={category} onChange={(e) => setCategory(e.target.value as WorkCategory)}>
          <option value="civil">Civil</option>
          <option value="electrical">Electrical</option>
          <option value="plumbing">Plumbing</option>
          <option value="painting">Painting</option>
          <option value="fabrication">Fabrication</option>
          <option value="other">Other</option>
        </select>
        <input className={FIELD} placeholder="Unit" value={unit} onChange={(e) => setUnit(e.target.value)} />
        <input className={FIELD} placeholder="Qty planned" value={qty} onChange={(e) => setQty(e.target.value)} />
        <input
          className={FIELD}
          placeholder={`Rate ₹${suggested ? ` (suggested ${formatInr(suggested)})` : ""}`}
          value={rate}
          onChange={(e) => setRate(e.target.value)}
        />
        <button type="button" className={BTN} onClick={add}>
          Add work
        </button>
      </section>
      <section className={CARD}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[var(--muted)]">
              <th className="pb-2">Work</th>
              <th className="pb-2">Category</th>
              <th className="pb-2 text-right">Qty</th>
              <th className="pb-2 text-right">Amount</th>
              <th className="pb-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((w) => (
              <tr key={w.id} className="border-t border-[var(--border)]">
                <td className="py-2">{w.name}</td>
                <td className="py-2">{w.category}</td>
                <td className="py-2 text-right">
                  {w.qtyPlanned} {w.unit}
                </td>
                <td className="py-2 text-right">{formatInr(w.amountPaise)}</td>
                <td className="py-2">{w.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

export function MaterialsPanel({
  state,
  selectedProjectId,
  onSelectProject,
  onRefresh,
  onFlash,
  onError,
}: TrustPanelProps) {
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("bag");
  const [required, setRequired] = useState("");
  const [received, setReceived] = useState("");
  const [issued, setIssued] = useState("");

  const lines = state.materials.filter(
    (m) => !selectedProjectId || m.projectId === selectedProjectId,
  );

  function add() {
    if (!selectedProjectId) {
      onError("Select a project");
      return;
    }
    const res = upsertMaterialLine({
      projectId: selectedProjectId,
      name,
      unit,
      requiredQty: Number(required) || 0,
      receivedQty: Number(received) || 0,
      issuedQty: Number(issued) || 0,
    });
    if (!res.ok) {
      onError(res.error);
      return;
    }
    onFlash("Material line saved");
    onRefresh();
  }

  return (
    <div className="mt-4 space-y-4">
      <ProjectPicker state={state} selectedProjectId={selectedProjectId} onSelectProject={onSelectProject} />
      <section className={`${CARD} space-y-3`}>
        <h3 className="text-sm font-bold text-[var(--brand-deep)]">Material line</h3>
        <input className={FIELD} placeholder="Material" value={name} onChange={(e) => setName(e.target.value)} />
        <input className={FIELD} placeholder="Unit" value={unit} onChange={(e) => setUnit(e.target.value)} />
        <div className="grid grid-cols-3 gap-2">
          <input className={FIELD} placeholder="Required" value={required} onChange={(e) => setRequired(e.target.value)} />
          <input className={FIELD} placeholder="Received" value={received} onChange={(e) => setReceived(e.target.value)} />
          <input className={FIELD} placeholder="Issued" value={issued} onChange={(e) => setIssued(e.target.value)} />
        </div>
        <button type="button" className={BTN} onClick={add}>
          Save material
        </button>
      </section>
      <section className={CARD}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[var(--muted)]">
              <th className="pb-2">Material</th>
              <th className="pb-2 text-right">Required</th>
              <th className="pb-2 text-right">Issued</th>
              <th className="pb-2 text-right">Balance</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((m) => (
              <tr key={m.id} className="border-t border-[var(--border)]">
                <td className="py-2">{m.name}</td>
                <td className="py-2 text-right">{m.requiredQty}</td>
                <td className="py-2 text-right">{m.issuedQty}</td>
                <td className="py-2 text-right">{materialBalance(m)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

export function LabourPanel({
  state,
  selectedProjectId,
  onSelectProject,
  onRefresh,
  onFlash,
  onError,
}: TrustPanelProps) {
  const accounts = loadAccounts();
  const poolId = accounts.cashPools.find((p) => p.code === "main")?.id ?? "";
  const [labourType, setLabourType] = useState("Mason");
  const [days, setDays] = useState("1");
  const [rate, setRate] = useState("");
  const [headcount, setHeadcount] = useState("1");

  const entries = state.labourEntries.filter(
    (l) => !selectedProjectId || l.projectId === selectedProjectId,
  );

  function add() {
    if (!selectedProjectId) {
      onError("Select a project");
      return;
    }
    const res = upsertLabourEntry({
      projectId: selectedProjectId,
      labourType,
      days: Number(days) || 1,
      headcount: Number(headcount) || 1,
      ratePaise: paiseFromInr(rate),
    });
    if (!res.ok) {
      onError(res.error);
      return;
    }
    onFlash("Labour entry saved");
    onRefresh();
  }

  function pay(id: string) {
    const res = payLabourEntry(id, { poolId });
    if (!res.ok) {
      onError(res.error);
      return;
    }
    onFlash("Labour paid → CWIP");
    onRefresh();
  }

  return (
    <div className="mt-4 space-y-4">
      <ProjectPicker state={state} selectedProjectId={selectedProjectId} onSelectProject={onSelectProject} />
      <section className={`${CARD} space-y-3`}>
        <h3 className="text-sm font-bold text-[var(--brand-deep)]">Labour entry</h3>
        <input className={FIELD} placeholder="Labour type" value={labourType} onChange={(e) => setLabourType(e.target.value)} />
        <div className="grid grid-cols-3 gap-2">
          <input className={FIELD} placeholder="Days" value={days} onChange={(e) => setDays(e.target.value)} />
          <input className={FIELD} placeholder="Headcount" value={headcount} onChange={(e) => setHeadcount(e.target.value)} />
          <input className={FIELD} placeholder="Rate ₹/day" value={rate} onChange={(e) => setRate(e.target.value)} />
        </div>
        <button type="button" className={BTN} onClick={add}>
          Save labour
        </button>
      </section>
      <section className={CARD}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[var(--muted)]">
              <th className="pb-2">Type</th>
              <th className="pb-2 text-right">Days</th>
              <th className="pb-2 text-right">Amount</th>
              <th className="pb-2">Status</th>
              <th className="pb-2" />
            </tr>
          </thead>
          <tbody>
            {entries.map((l) => (
              <tr key={l.id} className="border-t border-[var(--border)]">
                <td className="py-2">{l.labourType}</td>
                <td className="py-2 text-right">{l.days}</td>
                <td className="py-2 text-right">{formatInr(l.amountPaise)}</td>
                <td className="py-2">{l.paidStatus}</td>
                <td className="py-2">
                  {l.paidStatus === "unpaid" ? (
                    <button type="button" className={BTN_OUTLINE} onClick={() => pay(l.id)}>
                      Pay
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

export function AllotmentsPanel({
  state,
  selectedProjectId,
  onSelectProject,
  onRefresh,
  onFlash,
  onError,
  actorName,
}: TrustPanelProps) {
  const [partyName, setPartyName] = useState("");
  const [partyType, setPartyType] = useState<AllotmentPartyType>("contractor");
  const [targetEnd, setTargetEnd] = useState(todayIso());
  const [workItemId, setWorkItemId] = useState("");

  const allotments = state.allotments.filter(
    (a) => !selectedProjectId || a.projectId === selectedProjectId,
  );
  const overdue = listOverdueAllotments(state);
  const workItems = state.workItems.filter((w) => w.projectId === selectedProjectId);

  function allot() {
    if (!selectedProjectId) {
      onError("Select a project");
      return;
    }
    const res = upsertAllotment({
      projectId: selectedProjectId,
      partyName,
      partyType,
      targetEnd,
      workItemIds: workItemId ? [workItemId] : [],
      status: "allotted",
    });
    if (!res.ok) {
      onError(res.error);
      return;
    }
    onFlash(`Allotment ${res.allotment.code} created`);
    onRefresh();
  }

  return (
    <div className="mt-4 space-y-4">
      <ProjectPicker state={state} selectedProjectId={selectedProjectId} onSelectProject={onSelectProject} />
      {overdue.length > 0 ? (
        <div className={`${CARD} text-sm text-[var(--warning)]`}>
          {overdue.length} overdue allotment(s)
        </div>
      ) : null}
      <section className={`${CARD} space-y-3`}>
        <h3 className="text-sm font-bold text-[var(--brand-deep)]">Allot work</h3>
        <input className={FIELD} placeholder="Assignee name" value={partyName} onChange={(e) => setPartyName(e.target.value)} />
        <select className={FIELD} value={partyType} onChange={(e) => setPartyType(e.target.value as AllotmentPartyType)}>
          <option value="staff">Staff</option>
          <option value="contractor">Contractor</option>
          <option value="gang">Gang</option>
          <option value="external">External</option>
        </select>
        <select className={FIELD} value={workItemId} onChange={(e) => setWorkItemId(e.target.value)}>
          <option value="">Work item (optional)</option>
          {workItems.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        <input className={FIELD} type="date" value={targetEnd} onChange={(e) => setTargetEnd(e.target.value)} />
        <button type="button" className={BTN} onClick={allot}>
          Allot
        </button>
      </section>
      <section className={CARD}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[var(--muted)]">
              <th className="pb-2">Code</th>
              <th className="pb-2">Assignee</th>
              <th className="pb-2">Due</th>
              <th className="pb-2 text-right">%</th>
              <th className="pb-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {allotments.map((a) => (
              <tr key={a.id} className="border-t border-[var(--border)]">
                <td className="py-2 font-mono text-xs">{a.code}</td>
                <td className="py-2">{a.partyName}</td>
                <td className="py-2">{a.targetEnd}</td>
                <td className="py-2 text-right">{a.progressPct}%</td>
                <td className="py-2 space-x-1">
                  <button
                    type="button"
                    className={BTN_OUTLINE}
                    onClick={() => {
                      const res = updateAllotmentProgress(a.id, Math.min(100, a.progressPct + 25));
                      if (!res.ok) onError(res.error);
                      else {
                        onFlash("Progress updated");
                        onRefresh();
                      }
                    }}
                  >
                    +25%
                  </button>
                  {a.status === "submitted" || a.progressPct >= 100 ? (
                    <button
                      type="button"
                      className={BTN_OUTLINE}
                      onClick={() => {
                        const res = verifyAllotment(a.id, actorName);
                        if (!res.ok) onError(res.error);
                        else {
                          onFlash("Verified");
                          onRefresh();
                        }
                      }}
                    >
                      Verify
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

export function BillsPanel({
  state,
  selectedProjectId,
  onSelectProject,
  onRefresh,
  onFlash,
  onError,
}: TrustPanelProps) {
  const accounts = loadAccounts();
  const poolId = accounts.cashPools.find((p) => p.code === "main")?.id ?? "";
  const bankId = accounts.bankAccounts[0]?.id ?? "";

  const [contractorName, setContractorName] = useState("");
  const [woScope, setWoScope] = useState("");
  const [woValue, setWoValue] = useState("");
  const [raBillNo, setRaBillNo] = useState("");
  const [raAmount, setRaAmount] = useState("");
  const [costAmt, setCostAmt] = useState("");
  const [costNote, setCostNote] = useState("");

  const costLines = selectedProjectId
    ? listProjectCostLines(selectedProjectId, state)
    : state.costLines;

  function addContractor() {
    const res = upsertContractor({ name: contractorName });
    if (!res.ok) {
      onError(res.error);
      return;
    }
    onFlash("Contractor saved");
    onRefresh();
  }

  function addWo() {
    if (!selectedProjectId) {
      onError("Select project");
      return;
    }
    const contractor = state.contractors[0];
    if (!contractor) {
      onError("Add a contractor first");
      return;
    }
    const res = createWorkOrder({
      projectId: selectedProjectId,
      contractorId: contractor.id,
      scope: woScope,
      valuePaise: paiseFromInr(woValue),
    });
    if (!res.ok) {
      onError(res.error);
      return;
    }
    onFlash(`WO ${res.wo.woNo} created`);
    onRefresh();
  }

  function addRa() {
    if (!selectedProjectId) {
      onError("Select project");
      return;
    }
    const wo = state.workOrders.find((w) => w.projectId === selectedProjectId);
    if (!wo) {
      onError("Create a work order first");
      return;
    }
    const res = createRaBill({
      projectId: selectedProjectId,
      workOrderId: wo.id,
      billNo: raBillNo,
      amountPaise: paiseFromInr(raAmount),
    });
    if (!res.ok) {
      onError(res.error);
      return;
    }
    onFlash("RA bill submitted");
    onRefresh();
  }

  function addCost() {
    if (!selectedProjectId) {
      onError("Select project");
      return;
    }
    const res = createCostLine({
      projectId: selectedProjectId,
      costType: "other",
      amountPaise: paiseFromInr(costAmt),
      narration: costNote,
      vendorName: "Misc",
    });
    if (!res.ok) {
      onError(res.error);
      return;
    }
    onFlash("Cost line added");
    onRefresh();
  }

  function capitalise() {
    if (!selectedProjectId) {
      onError("Select project");
      return;
    }
    const res = capitaliseProject(selectedProjectId);
    if (!res.ok) {
      onError(res.error);
      return;
    }
    onFlash("Project capitalised → fixed asset");
    onRefresh();
  }

  return (
    <div className="mt-4 space-y-4">
      <ProjectPicker state={state} selectedProjectId={selectedProjectId} onSelectProject={onSelectProject} />
      {selectedProjectId ? (
        <KpiRow projectId={selectedProjectId} state={state} />
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className={`${CARD} space-y-3`}>
          <h3 className="text-sm font-bold text-[var(--brand-deep)]">Contractor</h3>
          <input className={FIELD} placeholder="Name" value={contractorName} onChange={(e) => setContractorName(e.target.value)} />
          <button type="button" className={BTN} onClick={addContractor}>
            Save contractor
          </button>
        </section>
        <section className={`${CARD} space-y-3`}>
          <h3 className="text-sm font-bold text-[var(--brand-deep)]">Work order</h3>
          <input className={FIELD} placeholder="Scope" value={woScope} onChange={(e) => setWoScope(e.target.value)} />
          <input className={FIELD} placeholder="Value ₹" value={woValue} onChange={(e) => setWoValue(e.target.value)} />
          <button type="button" className={BTN} onClick={addWo}>
            Create WO
          </button>
        </section>
      </div>

      <section className={`${CARD} space-y-3`}>
        <h3 className="text-sm font-bold text-[var(--brand-deep)]">RA bill</h3>
        <div className="grid gap-2 sm:grid-cols-2">
          <input className={FIELD} placeholder="Bill no." value={raBillNo} onChange={(e) => setRaBillNo(e.target.value)} />
          <input className={FIELD} placeholder="Amount ₹" value={raAmount} onChange={(e) => setRaAmount(e.target.value)} />
        </div>
        <button type="button" className={BTN} onClick={addRa}>
          Submit RA
        </button>
        <div className="flex flex-wrap gap-2">
          {state.raBills
            .filter((b) => !selectedProjectId || b.projectId === selectedProjectId)
            .map((b) => (
              <div key={b.id} className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs">
                {b.billNo} · {formatInr(b.amountPaise)} · {b.status}
                {b.status === "submitted" ? (
                  <button
                    type="button"
                    className={`${BTN_OUTLINE} ml-2`}
                    onClick={() => {
                      const r = approveRaBill(b.id);
                      if (!r.ok) onError(r.error);
                      else {
                        onFlash("RA approved");
                        onRefresh();
                      }
                    }}
                  >
                    Approve
                  </button>
                ) : null}
                {b.status === "approved" ? (
                  <button
                    type="button"
                    className={`${BTN_OUTLINE} ml-2`}
                    onClick={() => {
                      const r = payRaBill(b.id, { bankId, poolId: bankId ? undefined : poolId });
                      if (!r.ok) onError(r.error);
                      else {
                        onFlash("RA paid → CWIP");
                        onRefresh();
                      }
                    }}
                  >
                    Pay
                  </button>
                ) : null}
              </div>
            ))}
        </div>
      </section>

      <section className={`${CARD} space-y-3`}>
        <h3 className="text-sm font-bold text-[var(--brand-deep)]">Misc cost</h3>
        <input className={FIELD} placeholder="Amount ₹" value={costAmt} onChange={(e) => setCostAmt(e.target.value)} />
        <input className={FIELD} placeholder="Note" value={costNote} onChange={(e) => setCostNote(e.target.value)} />
        <button type="button" className={BTN} onClick={addCost}>
          Add cost line
        </button>
      </section>

      <section className={CARD}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-[var(--brand-deep)]">Project cost sheet</h3>
          <button type="button" className={BTN_OUTLINE} onClick={capitalise}>
            Capitalise project
          </button>
        </div>
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="text-left text-[var(--muted)]">
              <th className="pb-2">Date</th>
              <th className="pb-2">Type</th>
              <th className="pb-2 text-right">Amount</th>
              <th className="pb-2">Status</th>
              <th className="pb-2" />
            </tr>
          </thead>
          <tbody>
            {costLines.map((c) => (
              <tr key={c.id} className="border-t border-[var(--border)]">
                <td className="py-2">{c.date}</td>
                <td className="py-2">{c.costType}</td>
                <td className="py-2 text-right">{formatInr(c.amountPaise)}</td>
                <td className="py-2">{c.paymentStatus}</td>
                <td className="py-2">
                  {c.paymentStatus === "open" ? (
                    <button
                      type="button"
                      className={BTN_OUTLINE}
                      onClick={() => {
                        const r = payCostLine(c.id, { poolId });
                        if (!r.ok) onError(r.error);
                        else {
                          onFlash("Paid → CWIP");
                          onRefresh();
                        }
                      }}
                    >
                      Pay
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

export function ReportsPanel({
  state,
  selectedProjectId,
  onFlash,
  onError,
}: TrustPanelProps) {
  const [format, setFormat] = useState<TrustReportFormat>("excel");
  const [projectId, setProjectId] = useState(selectedProjectId);

  const reportsByCategory = useMemo(() => {
    const map: Record<string, typeof TRUST_REPORTS> = {};
    for (const c of TRUST_REPORT_CATEGORIES) map[c.id] = [];
    for (const r of TRUST_REPORTS) map[r.category]?.push(r);
    return map;
  }, []);

  function run(id: TrustReportId) {
    const result = runTrustReport(id, {
      format,
      projectId: projectId || undefined,
      trust: state,
    });
    if (!result.ok) {
      onError(result.error);
      return;
    }
    onFlash(result.message);
  }

  return (
    <div className="mt-4 space-y-4">
      <div className={`${CARD} flex flex-wrap items-end gap-3`}>
        <label className="text-sm">
          Project filter
          <select
            className={`${FIELD} mt-1`}
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            <option value="">All projects</option>
            {state.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Format
          <select
            className={`${FIELD} mt-1`}
            value={format}
            onChange={(e) => setFormat(e.target.value as TrustReportFormat)}
          >
            <option value="excel">Excel</option>
            <option value="pdf">PDF</option>
          </select>
        </label>
      </div>
      {TRUST_REPORT_CATEGORIES.map((cat) => (
        <section key={cat.id} className={CARD}>
          <h3 className={`rounded-lg px-3 py-2 text-sm font-bold text-white ${cat.headerClass}`}>
            {cat.title}
          </h3>
          <ul className="mt-3 space-y-2">
            {(reportsByCategory[cat.id] ?? []).map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] pt-2 first:border-0 first:pt-0"
              >
                <div>
                  <div className="font-medium text-[var(--brand-deep)]">{r.label}</div>
                  {r.hint ? (
                    <div className="text-xs text-[var(--muted)]">{r.hint}</div>
                  ) : null}
                </div>
                <button type="button" className={BTN_OUTLINE} onClick={() => run(r.id)}>
                  Export
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
