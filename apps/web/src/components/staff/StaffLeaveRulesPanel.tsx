"use client";

/**
 * Staff → Leave rules (director, 11 Oct 2026 — the old SStudy ERP's leave
 * rules, on top of our leave requests). Five steps:
 *   1 Policy        per leave type for the year: days, half day, sandwich,
 *                   carry cap, what happens when the balance is short
 *   2 Allocations   days by staff category, and per-person overrides
 *   3 Approvers     who decides whose leave (school / department / person)
 *   4 Carry forward year-end carry, preview then commit (idempotent)
 *   5 Reports       staff-wise summary and monthly balance, exportable
 * Everything is read from and saved to the server (staff_leave_policy_*);
 * a failed read says so and offers nothing to save over it.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { StepTabs, type StepDef } from "@/components/ui/StepTabs";
import { ErpTable, ErpTableBody, ErpTableHead } from "@/components/ui/erp-roster";
import { ExportMenu, RowActionMenu } from "@/components/ui/erp-grid";
import { listSessionYearOptions, loadMasters, type MastersState } from "@/lib/masters";
import { STAFF_CATEGORIES } from "@/lib/foundationMasters";
import type { ApproverRule, ApproverScopeKind, CarryPlan, LeavePolicy, LeavePolicyType } from "@/lib/staffLeaveRules";

type Step = "policy" | "allocations" | "approvers" | "carry" | "reports";
type DeskType = { code: string; name: string; paid: boolean };
type PolicyResp = {
  ok: boolean;
  error?: string;
  ay: string;
  policy: LeavePolicy | null;
  approvers: ApproverRule[];
  deskTypes: DeskType[];
  twoLevelApproval: boolean;
};
type SyncPlan = {
  changes: { staffId: string; typeCode: string; allottedBefore: number; allottedAfter: number; carriedBefore: number; carriedAfter: number }[];
  refused: { staffId: string; typeCode: string; used: number; wouldBe: number }[];
  committed?: boolean;
};
type BookRow = {
  staffId: string;
  typeCode: string;
  opening: number;
  allocated: number;
  allocationSource: string;
  taken: number;
  sandwichDays: number;
  pending: number;
  balance: number;
  months: { month: string; taken: number; balance: number }[];
};
type BookResp = { ok: boolean; error?: string; policy: boolean; months?: string[]; types?: string[]; rows?: BookRow[]; unpaid?: { staffId: string; typeCode: string; taken: number }[] };

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (ym: string) => `${MONTH[Number(ym.slice(5, 7)) - 1] ?? ym} ${ym.slice(2, 4)}`;
const btn = "rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--brand-deep)] disabled:opacity-50";
const btnPrimary = "rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-[var(--primary-foreground)] disabled:opacity-50";
const card = "rounded-xl border border-[var(--border)] bg-[var(--card)] p-4";

async function call<T>(url: string, body?: unknown): Promise<T & { ok: boolean; error?: string }> {
  try {
    const res = await fetch(url, body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => null)) as (T & { ok: boolean; error?: string }) | null;
    return json ?? ({ ok: false, error: `The server answered ${res.status}` } as T & { ok: boolean; error?: string });
  } catch {
    return { ok: false, error: "Could not reach the server" } as T & { ok: boolean; error?: string };
  }
}

export function StaffLeaveRulesPanel({ ay: sessionAy, canEdit }: { ay: string; canEdit: boolean }) {
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [ay, setAy] = useState(sessionAy);
  const [step, setStep] = useState<Step>("policy");
  const [data, setData] = useState<PolicyResp | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setMasters(loadMasters()), []);
  const years = useMemo(() => (masters ? listSessionYearOptions(masters) : []), [masters]);
  const staff = useMemo(() => (masters?.staff ?? []).filter((s) => s.status === "active").sort((a, b) => a.fullName.localeCompare(b.fullName)), [masters]);
  const nameOf = useCallback(
    (id: string) => {
      const s = (masters?.staff ?? []).find((x) => x.id === id);
      return s ? `${s.empCode} · ${s.fullName}` : id;
    },
    [masters],
  );
  const deptName = useCallback((id: string) => (masters?.departments ?? []).find((d) => d.id === id)?.name || id, [masters]);

  const load = useCallback(async () => {
    setLoadErr(null);
    const r = await call<PolicyResp>(`/api/staff/leave-policy?ay=${encodeURIComponent(ay)}`);
    if (!r.ok) {
      setData(null);
      setLoadErr(r.error || "Could not load the leave rules");
      return;
    }
    setData(r);
  }, [ay]);
  useEffect(() => {
    void load();
  }, [load]);

  const flash = (text: string, bad = false) => setMsg({ text, bad });
  async function post(body: Record<string, unknown>, done: string) {
    setBusy(true);
    const r = await call<Record<string, unknown>>("/api/staff/leave-policy", body);
    setBusy(false);
    if (!r.ok) {
      flash(r.error || "Not saved", true);
      return false;
    }
    flash(done);
    await load();
    return true;
  }

  const paidTypes = (data?.deskTypes ?? []).filter((t) => t.paid);
  const steps: StepDef<Step>[] = [
    { id: "policy", title: "Policy", what: "Each leave type for the year: days, half days, the sandwich rule, carry cap, and what happens when the balance is short." },
    { id: "allocations", title: "Allocations", what: "Days by staff category (permanent / contract / part-time), and anyone who gets a different number.", badge: data?.policy?.allocations.length || undefined },
    { id: "approvers", title: "Approvers", what: "Who decides whose leave — the whole school, a department or one person. The principal and director can always decide.", badge: data?.approvers.length || undefined },
    { id: "carry", title: "Carry forward", what: "At year end, roll unused leave into the next year, up to each type's cap. Preview first; committing twice carries nothing twice." },
    { id: "reports", title: "Reports", what: "Staff-wise leave summary and monthly balance under these rules — export to Excel, CSV or PDF." },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-[var(--brand-deep)]">Leave rules</h2>
          <p className="text-xs text-[var(--muted)]">
            balance = carried in + allocated − taken. Taken counts working days; a half day is ½; holidays and Sundays count only under the sandwich rule.
          </p>
        </div>
        <label className="text-xs">
          <span className="mr-2 text-[var(--muted)]">Academic year</span>
          <select className="field !py-1.5" value={ay} onChange={(e) => setAy(e.target.value)}>
            {(years.length ? years : [{ code: ay, label: ay }]).map((y) => (
              <option key={y.code} value={y.code}>
                {y.label || y.code}
              </option>
            ))}
          </select>
        </label>
      </div>

      {msg ? (
        <p className={`rounded-lg px-3 py-2 text-sm font-medium ${msg.bad ? "bg-[var(--danger-soft)] text-[var(--danger)]" : "bg-[var(--surface-sunken)] text-[var(--brand-deep)]"}`}>{msg.text}</p>
      ) : null}

      {loadErr ? (
        <div className={card}>
          <p className="text-sm font-semibold text-[var(--danger)]">Couldn&apos;t load the leave rules: {loadErr}</p>
          <button type="button" className={`${btn} mt-2`} onClick={() => void load()}>
            Try again
          </button>
        </div>
      ) : !data ? (
        <p className="text-sm text-[var(--muted)]">Loading leave rules…</p>
      ) : (
        <StepTabs steps={steps} value={step} onChange={setStep} aria-label="Leave rules steps">
          {step === "policy" ? (
            <PolicyStep data={data} ay={ay} canEdit={canEdit} busy={busy} post={post} nameOf={nameOf} />
          ) : step === "allocations" ? (
            <AllocationsStep data={data} ay={ay} canEdit={canEdit} busy={busy} post={post} paidTypes={paidTypes} staff={staff} nameOf={nameOf} />
          ) : step === "approvers" ? (
            <ApproversStep data={data} canEdit={canEdit} busy={busy} post={post} staff={staff} masters={masters} nameOf={nameOf} deptName={deptName} />
          ) : step === "carry" ? (
            <CarryStep ay={ay} years={years.map((y) => y.code)} canEdit={canEdit} nameOf={nameOf} flash={flash} />
          ) : (
            <ReportsStep ay={ay} nameOf={nameOf} flash={flash} />
          )}
        </StepTabs>
      )}
    </div>
  );
}

type PostFn = (body: Record<string, unknown>, done: string) => Promise<boolean>;

// ── 1 Policy ─────────────────────────────────────────────────────────────

function PolicyStep({ data, ay, canEdit, busy, post, nameOf }: { data: PolicyResp; ay: string; canEdit: boolean; busy: boolean; post: PostFn; nameOf: (id: string) => string }) {
  const [edits, setEdits] = useState<Record<string, LeavePolicyType>>({});
  const [sync, setSync] = useState<SyncPlan | null>(null);
  const [syncErr, setSyncErr] = useState<string | null>(null);
  useEffect(() => {
    setEdits({});
    setSync(null);
  }, [data]);

  if (!data.policy) {
    return (
      <div className={card}>
        <p className="text-sm font-semibold text-[var(--brand-deep)]">{ay} has no leave policy yet.</p>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Until it has one, leave is checked by the leave desk&apos;s old rules (Staff → Leave). Starting a policy copies the desk&apos;s leave types and each person&apos;s
          current allotment, so nobody&apos;s leave changes until you change it here.
        </p>
        {canEdit ? (
          <button type="button" className={`${btnPrimary} mt-3`} disabled={busy} onClick={() => void post({ action: "seed", ay }, `Leave policy for ${ay} started`)}>
            Start {ay} policy from current leave settings
          </button>
        ) : null}
      </div>
    );
  }

  const rowOf = (code: string): LeavePolicyType =>
    edits[code] ??
    data.policy!.types.find((t) => t.typeCode === code) ?? { typeCode: code, defaultDays: 0, halfDayAllowed: true, sandwich: false, carryForwardCap: 0, insufficientMode: "block" };
  const set = (code: string, patch: Partial<LeavePolicyType>) => setEdits((e) => ({ ...e, [code]: { ...rowOf(code), ...patch } }));

  async function runSync(commit: boolean) {
    setSyncErr(null);
    const r = await call<SyncPlan>("/api/staff/leave-policy", { action: commit ? "sync_commit" : "sync_preview", ay });
    if (!r.ok) {
      setSync(null);
      setSyncErr(r.error || "Could not work it out");
      return;
    }
    setSync(r);
  }

  return (
    <div className="space-y-4">
      <div className={card}>
        <div className="overflow-x-auto">
          <ErpTable>
            <ErpTableHead>
              <tr>
                <th className="px-3 py-2 text-left">Leave type</th>
                <th className="px-3 py-2 text-center">Days a year</th>
                <th className="px-3 py-2 text-center">Half day</th>
                <th className="px-3 py-2 text-center">Sandwich rule</th>
                <th className="px-3 py-2 text-center">Carry cap</th>
                <th className="px-3 py-2 text-left">When balance is short</th>
                <th className="w-10 px-2 py-2" aria-label="Actions" />
              </tr>
            </ErpTableHead>
            <ErpTableBody>
              {data.deskTypes.map((t) => {
                const r = rowOf(t.code);
                const dirty = !!edits[t.code];
                const inPolicy = data.policy!.types.some((x) => x.typeCode === t.code);
                return (
                  <tr key={t.code}>
                    <td className="px-3 py-2 text-sm font-medium text-[var(--brand-deep)]">
                      {t.code} · {t.name}
                      {!t.paid ? <span className="ml-1 text-xs text-[var(--muted)]">(unpaid — no balance)</span> : null}
                      {!inPolicy ? <span className="ml-1 text-xs text-[var(--warning)]">not in this year&apos;s policy</span> : null}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <input className="field !py-1 w-20 text-center" type="number" min={0} step={0.5} disabled={!canEdit || !t.paid} value={r.defaultDays} onChange={(e) => set(t.code, { defaultDays: Number(e.target.value) })} aria-label={`${t.code} days a year`} />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <input type="checkbox" disabled={!canEdit} checked={r.halfDayAllowed} onChange={(e) => set(t.code, { halfDayAllowed: e.target.checked })} aria-label={`${t.code} half day allowed`} />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <input type="checkbox" disabled={!canEdit || !t.paid} checked={r.sandwich} onChange={(e) => set(t.code, { sandwich: e.target.checked })} aria-label={`${t.code} sandwich rule`} />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <input className="field !py-1 w-20 text-center" type="number" min={0} step={0.5} disabled={!canEdit || !t.paid} value={r.carryForwardCap} onChange={(e) => set(t.code, { carryForwardCap: Number(e.target.value) })} aria-label={`${t.code} carry cap`} />
                    </td>
                    <td className="px-3 py-2">
                      <select className="field !py-1 text-xs" disabled={!canEdit || !t.paid} value={r.insufficientMode} onChange={(e) => set(t.code, { insufficientMode: e.target.value === "lwp" ? "lwp" : "block" })} aria-label={`${t.code} when short`}>
                        <option value="block">Refuse approval</option>
                        <option value="lwp">Approve the rest as LWP</option>
                      </select>
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      {canEdit ? (
                        <div className="flex items-center justify-end gap-1">
                          {dirty || !inPolicy ? (
                            <button type="button" className={btnPrimary} disabled={busy} onClick={() => void post({ action: "save_type", ay, type: r }, `${t.code} rules saved`)}>
                              Save
                            </button>
                          ) : null}
                          <RowActionMenu
                            row={t}
                            label={`${t.code} actions`}
                            actions={[
                              { id: "save", label: "Save this type", onSelect: () => void post({ action: "save_type", ay, type: r }, `${t.code} rules saved`) },
                              { id: "undo", label: "Undo my edits", disabled: () => !dirty, onSelect: () => setEdits((e) => { const n = { ...e }; delete n[t.code]; return n; }) },
                            ]}
                          />
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </ErpTableBody>
          </ErpTable>
        </div>
        <p className="mt-2 text-xs text-[var(--muted)]">
          Sandwich rule: a holiday or Sunday between two leave days (inside one leave, or between Friday&apos;s and Monday&apos;s) counts as leave. Holidays come from Masters → Holidays.
          The monthly and per-application caps stay on the leave type (Staff → Leave).
        </p>
      </div>

      <div className={card}>
        <h3 className="text-sm font-bold text-[var(--brand-deep)]">Apply to balances</h3>
        <p className="mt-1 text-xs text-[var(--muted)]">
          The staff app, WhatsApp and Staff → Leave show each person&apos;s desk balance. This sets those allotments (and carried-in days) to what the policy says. Each change is
          recorded in the allotment record.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className={btn} onClick={() => void runSync(false)}>
            Preview changes
          </button>
          {canEdit && sync && !sync.committed && sync.changes.length ? (
            <button type="button" className={btnPrimary} onClick={() => window.confirm(`Change ${sync.changes.length} desk balance(s)?`) && void runSync(true)}>
              Apply {sync.changes.length} change(s)
            </button>
          ) : null}
        </div>
        {syncErr ? <p className="mt-2 text-xs font-medium text-[var(--danger)]">{syncErr}</p> : null}
        {sync ? (
          <div className="mt-2 space-y-1 text-xs">
            <p className="font-semibold text-[var(--brand-deep)]">
              {sync.committed ? `Applied ${sync.changes.length} change(s).` : sync.changes.length ? `${sync.changes.length} balance(s) would change:` : "Every desk balance already matches the policy."}
            </p>
            {sync.changes.slice(0, 40).map((c) => (
              <p key={`${c.staffId}|${c.typeCode}`}>
                {nameOf(c.staffId)} · {c.typeCode}: allotted {c.allottedBefore} → {c.allottedAfter}
                {c.carriedBefore !== c.carriedAfter ? `, carried ${c.carriedBefore} → ${c.carriedAfter}` : ""}
              </p>
            ))}
            {sync.changes.length > 40 ? <p className="text-[var(--muted)]">…and {sync.changes.length - 40} more</p> : null}
            {sync.refused.length ? (
              <p className="text-[var(--danger)]">
                Not changed (would leave less than already taken): {sync.refused.map((r) => `${nameOf(r.staffId)} ${r.typeCode} (${r.used} taken)`).join("; ")}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ── 2 Allocations ────────────────────────────────────────────────────────

function AllocationsStep({
  data,
  ay,
  canEdit,
  busy,
  post,
  paidTypes,
  staff,
  nameOf,
}: {
  data: PolicyResp;
  ay: string;
  canEdit: boolean;
  busy: boolean;
  post: PostFn;
  paidTypes: DeskType[];
  staff: MastersState["staff"];
  nameOf: (id: string) => string;
}) {
  const [cat, setCat] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ staffId: "", typeCode: paidTypes[0]?.code ?? "", days: "", note: "" });
  if (!data.policy) return <p className={`${card} text-sm text-[var(--muted)]`}>Start the year&apos;s policy first (step 1).</p>;
  const policy = data.policy;
  const catValue = (category: string, code: string) => {
    const k = `${category}|${code}`;
    if (k in cat) return cat[k]!;
    const row = policy.allocations.find((a) => a.staffCategory === category && a.typeCode === code);
    return row ? String(row.days) : "";
  };
  const defaultOf = (code: string) => policy.types.find((t) => t.typeCode === code)?.defaultDays ?? 0;
  const overrides = policy.allocations.filter((a) => a.staffId).sort((a, b) => nameOf(a.staffId!).localeCompare(nameOf(b.staffId!)));

  return (
    <div className="space-y-4">
      <div className={card}>
        <h3 className="text-sm font-bold text-[var(--brand-deep)]">By staff category</h3>
        <p className="mt-1 text-xs text-[var(--muted)]">Blank = the type&apos;s days a year (step 1). The category comes from each person&apos;s staff record.</p>
        <div className="mt-2 overflow-x-auto">
          <ErpTable>
            <ErpTableHead>
              <tr>
                <th className="px-3 py-2 text-left">Category</th>
                {paidTypes.map((t) => (
                  <th key={t.code} className="px-3 py-2 text-center">
                    {t.code}
                  </th>
                ))}
                <th className="w-10 px-2 py-2" aria-label="Actions" />
              </tr>
            </ErpTableHead>
            <ErpTableBody>
              {STAFF_CATEGORIES.map((c) => (
                <tr key={c.value}>
                  <td className="px-3 py-2 text-sm font-medium text-[var(--brand-deep)]">
                    {c.label} <span className="text-xs text-[var(--muted)]">({staff.filter((s) => s.category === c.value).length} staff)</span>
                  </td>
                  {paidTypes.map((t) => (
                    <td key={t.code} className="px-3 py-2 text-center">
                      <input
                        className="field !py-1 w-20 text-center"
                        type="number"
                        min={0}
                        step={0.5}
                        placeholder={String(defaultOf(t.code))}
                        disabled={!canEdit}
                        value={catValue(c.value, t.code)}
                        onChange={(e) => setCat((m) => ({ ...m, [`${c.value}|${t.code}`]: e.target.value }))}
                        aria-label={`${c.label} ${t.code} days`}
                      />
                    </td>
                  ))}
                  <td className="px-2 py-1.5 text-right">
                    {canEdit ? (
                      <RowActionMenu
                        row={c}
                        label={`${c.label} actions`}
                        actions={[
                          {
                            id: "save",
                            label: "Save this category",
                            onSelect: async () => {
                              for (const t of paidTypes) {
                                const k = `${c.value}|${t.code}`;
                                if (!(k in cat)) continue;
                                const v = cat[k]!.trim();
                                const row = policy.allocations.find((a) => a.staffCategory === c.value && a.typeCode === t.code);
                                if (v === "") {
                                  if (row) await post({ action: "delete_allocation", id: row.id }, `${c.label} ${t.code} back to the default`);
                                } else {
                                  await post({ action: "save_allocation", ay, typeCode: t.code, staffCategory: c.value, days: Number(v), note: "" }, `${c.label} ${t.code} saved`);
                                }
                              }
                              setCat({});
                            },
                          },
                        ]}
                      />
                    ) : null}
                  </td>
                </tr>
              ))}
            </ErpTableBody>
          </ErpTable>
        </div>
      </div>

      <div className={card}>
        <h3 className="text-sm font-bold text-[var(--brand-deep)]">Per-person allocations</h3>
        <p className="mt-1 text-xs text-[var(--muted)]">These win over the category and the default — e.g. someone who joined mid-year.</p>
        {canEdit ? (
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <label className="text-xs">
              <span className="mb-1 block text-[var(--muted)]">Staff</span>
              <select className="field !py-1.5" value={form.staffId} onChange={(e) => setForm({ ...form, staffId: e.target.value })}>
                <option value="">Choose…</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.empCode} · {s.fullName}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs">
              <span className="mb-1 block text-[var(--muted)]">Leave type</span>
              <select className="field !py-1.5" value={form.typeCode} onChange={(e) => setForm({ ...form, typeCode: e.target.value })}>
                {paidTypes.map((t) => (
                  <option key={t.code} value={t.code}>
                    {t.code}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs">
              <span className="mb-1 block text-[var(--muted)]">Days</span>
              <input className="field !py-1.5 w-20" type="number" min={0} step={0.5} value={form.days} onChange={(e) => setForm({ ...form, days: e.target.value })} />
            </label>
            <label className="min-w-[12rem] flex-1 text-xs">
              <span className="mb-1 block text-[var(--muted)]">Note</span>
              <input className="field !py-1.5 w-full" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="e.g. joined in October" />
            </label>
            <button
              type="button"
              className={btnPrimary}
              disabled={busy || !form.staffId || !form.typeCode || form.days.trim() === ""}
              onClick={async () => {
                if (await post({ action: "save_allocation", ay, typeCode: form.typeCode, staffId: form.staffId, days: Number(form.days), note: form.note }, "Allocation saved")) {
                  setForm({ ...form, staffId: "", days: "", note: "" });
                }
              }}
            >
              Save
            </button>
          </div>
        ) : null}
        {overrides.length ? (
          <div className="mt-3 max-h-[min(50vh,420px)] overflow-auto">
            <ErpTable>
              <ErpTableHead sticky>
                <tr>
                  <th className="px-3 py-2 text-left">Staff</th>
                  <th className="px-3 py-2 text-left">Leave</th>
                  <th className="px-3 py-2 text-center">Days</th>
                  <th className="px-3 py-2 text-left">Note</th>
                  <th className="w-10 px-2 py-2" aria-label="Actions" />
                </tr>
              </ErpTableHead>
              <ErpTableBody>
                {overrides.map((a) => (
                  <tr key={a.id}>
                    <td className="px-3 py-2 text-xs font-medium text-[var(--brand-deep)]">{nameOf(a.staffId!)}</td>
                    <td className="px-3 py-2 text-xs">{a.typeCode}</td>
                    <td className="px-3 py-2 text-center text-xs">{a.days}</td>
                    <td className="px-3 py-2 text-xs text-[var(--muted)]">{a.note}</td>
                    <td className="px-2 py-1.5 text-right">
                      {canEdit ? (
                        <RowActionMenu
                          row={a}
                          label="Allocation actions"
                          actions={[
                            { id: "edit", label: "Edit", onSelect: (x) => setForm({ staffId: x.staffId!, typeCode: x.typeCode, days: String(x.days), note: x.note }) },
                            {
                              id: "remove",
                              label: "Remove (back to category/default)",
                              tone: "danger",
                              separatorAbove: true,
                              onSelect: (x) => window.confirm(`Remove ${nameOf(x.staffId!)}'s ${x.typeCode} allocation?`) && void post({ action: "delete_allocation", id: x.id }, "Allocation removed"),
                            },
                          ]}
                        />
                      ) : null}
                    </td>
                  </tr>
                ))}
              </ErpTableBody>
            </ErpTable>
          </div>
        ) : (
          <p className="mt-2 text-xs text-[var(--muted)]">No per-person allocations for {ay}.</p>
        )}
      </div>
    </div>
  );
}

// ── 3 Approvers ──────────────────────────────────────────────────────────

function ApproversStep({
  data,
  canEdit,
  busy,
  post,
  staff,
  masters,
  nameOf,
  deptName,
}: {
  data: PolicyResp;
  canEdit: boolean;
  busy: boolean;
  post: PostFn;
  staff: MastersState["staff"];
  masters: MastersState | null;
  nameOf: (id: string) => string;
  deptName: (id: string) => string;
}) {
  const [form, setForm] = useState<{ scopeKind: ApproverScopeKind; scopeId: string; level: 1 | 2; approverStaffId: string }>({ scopeKind: "department", scopeId: "", level: 1, approverStaffId: "" });
  const scopeLabel = (r: ApproverRule) => (r.scopeKind === "school" ? "Whole school" : r.scopeKind === "department" ? `Department · ${deptName(r.scopeId)}` : `Staff · ${nameOf(r.scopeId)}`);
  const rules = [...data.approvers].sort((a, b) => scopeLabel(a).localeCompare(scopeLabel(b)) || a.level - b.level);
  return (
    <div className="space-y-4">
      <div className={card}>
        <p className="text-xs text-[var(--muted)]">
          The most specific rule wins: a person&apos;s own rule, else their department&apos;s, else the whole school&apos;s. Two-level approval is{" "}
          <strong>{data.twoLevelApproval ? "on" : "off"}</strong> (Staff → Leave settings){data.twoLevelApproval ? " — level 1 clears it, level 2 gives final approval." : " — any listed approver decides."}{" "}
          Approvers see their staff&apos;s requests in the staff app&apos;s leave approvals. With no rule, only leadership decides, as before.
        </p>
        {canEdit ? (
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="text-xs">
              <span className="mb-1 block text-[var(--muted)]">For</span>
              <select className="field !py-1.5" value={form.scopeKind} onChange={(e) => setForm({ ...form, scopeKind: e.target.value as ApproverScopeKind, scopeId: "" })}>
                <option value="school">Whole school</option>
                <option value="department">A department</option>
                <option value="staff">One member of staff</option>
              </select>
            </label>
            {form.scopeKind === "department" ? (
              <label className="text-xs">
                <span className="mb-1 block text-[var(--muted)]">Department</span>
                <select className="field !py-1.5" value={form.scopeId} onChange={(e) => setForm({ ...form, scopeId: e.target.value })}>
                  <option value="">Choose…</option>
                  {(masters?.departments ?? []).map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : form.scopeKind === "staff" ? (
              <label className="text-xs">
                <span className="mb-1 block text-[var(--muted)]">Staff</span>
                <select className="field !py-1.5" value={form.scopeId} onChange={(e) => setForm({ ...form, scopeId: e.target.value })}>
                  <option value="">Choose…</option>
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.empCode} · {s.fullName}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="text-xs">
              <span className="mb-1 block text-[var(--muted)]">Level</span>
              <select className="field !py-1.5" value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value === "2" ? 2 : 1 })}>
                <option value="1">Level 1</option>
                <option value="2">Level 2 (final)</option>
              </select>
            </label>
            <label className="text-xs">
              <span className="mb-1 block text-[var(--muted)]">Approver</span>
              <select className="field !py-1.5" value={form.approverStaffId} onChange={(e) => setForm({ ...form, approverStaffId: e.target.value })}>
                <option value="">Choose…</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.empCode} · {s.fullName}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className={btnPrimary}
              disabled={busy || !form.approverStaffId || (form.scopeKind !== "school" && !form.scopeId)}
              onClick={() => void post({ action: "add_approver", ...form }, "Approver added")}
            >
              Add approver
            </button>
          </div>
        ) : null}
      </div>
      <div className={card}>
        {rules.length ? (
          <ErpTable>
            <ErpTableHead>
              <tr>
                <th className="px-3 py-2 text-left">For</th>
                <th className="px-3 py-2 text-center">Level</th>
                <th className="px-3 py-2 text-left">Approver</th>
                <th className="w-10 px-2 py-2" aria-label="Actions" />
              </tr>
            </ErpTableHead>
            <ErpTableBody>
              {rules.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2 text-xs font-medium text-[var(--brand-deep)]">{scopeLabel(r)}</td>
                  <td className="px-3 py-2 text-center text-xs">{r.level}</td>
                  <td className="px-3 py-2 text-xs">{nameOf(r.approverStaffId)}</td>
                  <td className="px-2 py-1.5 text-right">
                    {canEdit ? (
                      <RowActionMenu
                        row={r}
                        label="Approver actions"
                        actions={[
                          {
                            id: "remove",
                            label: "Remove approver",
                            tone: "danger",
                            onSelect: (x) => window.confirm(`Remove ${nameOf(x.approverStaffId)} as approver for ${scopeLabel(x)}?`) && void post({ action: "remove_approver", id: x.id }, "Approver removed"),
                          },
                        ]}
                      />
                    ) : null}
                  </td>
                </tr>
              ))}
            </ErpTableBody>
          </ErpTable>
        ) : (
          <p className="text-xs text-[var(--muted)]">No approvers set — the principal, director and admin decide all staff leave.</p>
        )}
      </div>
    </div>
  );
}

// ── 4 Carry forward ──────────────────────────────────────────────────────

function nextAy(ay: string): string {
  const y = Number(ay.slice(0, 4));
  return Number.isFinite(y) ? `${y + 1}-${String((y + 2) % 100).padStart(2, "0")}` : "";
}

function CarryStep({ ay, years, canEdit, nameOf, flash }: { ay: string; years: string[]; canEdit: boolean; nameOf: (id: string) => string; flash: (t: string, bad?: boolean) => void }) {
  const [fromAy, setFromAy] = useState(ay);
  const [toAy, setToAy] = useState(nextAy(ay));
  const [plan, setPlan] = useState<CarryPlan | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const choices = [...new Set([...years, ay, nextAy(ay), toAy].filter(Boolean))].sort();

  async function preview() {
    setErr(null);
    setPlan(null);
    const r = await call<CarryPlan>(`/api/staff/leave-policy/carry-forward?from=${encodeURIComponent(fromAy)}&to=${encodeURIComponent(toAy)}`);
    if (!r.ok) {
      setErr(r.error || "Could not work out the carry");
      return;
    }
    setPlan(r);
  }
  async function commit() {
    if (!plan || !window.confirm(`Carry ${plan.totalDays} day(s) for ${plan.rows.length} row(s) from ${fromAy} into ${toAy}?`)) return;
    setBusy(true);
    const r = await call<{ inserted: number; days: number; already: number }>("/api/staff/leave-policy/carry-forward", { from: fromAy, to: toAy });
    setBusy(false);
    if (!r.ok) {
      flash(r.error || "Nothing was carried", true);
      return;
    }
    flash(`Carried ${r.days} day(s) in ${r.inserted} row(s) into ${toAy}. Then use Policy → Apply to balances for ${toAy}.`);
    await preview();
  }

  return (
    <div className="space-y-4">
      <div className={card}>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs">
            <span className="mb-1 block text-[var(--muted)]">From (closing year)</span>
            <select className="field !py-1.5" value={fromAy} onChange={(e) => { setFromAy(e.target.value); setPlan(null); }}>
              {choices.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            <span className="mb-1 block text-[var(--muted)]">Into</span>
            <select className="field !py-1.5" value={toAy} onChange={(e) => { setToAy(e.target.value); setPlan(null); }}>
              {choices.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className={btn} onClick={() => void preview()}>
            Preview
          </button>
          {canEdit && plan && plan.rows.length ? (
            <button type="button" className={btnPrimary} disabled={busy} onClick={() => void commit()}>
              Commit carry ({plan.totalDays} days)
            </button>
          ) : null}
        </div>
        <p className="mt-2 text-xs text-[var(--muted)]">
          Each paid type carries min(balance, cap) using the closing year&apos;s caps. A person already carried into {toAy || "that year"} is not carried again.
        </p>
        {err ? <p className="mt-2 text-xs font-medium text-[var(--danger)]">{err}</p> : null}
      </div>
      {plan ? (
        <div className={card}>
          <p className="text-sm font-semibold text-[var(--brand-deep)]">
            {plan.rows.length ? `${plan.rows.length} row(s), ${plan.totalDays} day(s) to carry` : "Nothing (more) to carry."}
            {plan.alreadyCarried.length ? <span className="ml-2 text-xs font-normal text-[var(--muted)]">{plan.alreadyCarried.length} already carried</span> : null}
          </p>
          {plan.rows.length ? (
            <div className="mt-2 max-h-[min(55vh,460px)] overflow-auto">
              <ErpTable>
                <ErpTableHead sticky>
                  <tr>
                    <th className="px-3 py-2 text-left">Staff</th>
                    <th className="px-3 py-2 text-left">Leave</th>
                    <th className="px-3 py-2 text-center">Closing balance</th>
                    <th className="px-3 py-2 text-center">Cap</th>
                    <th className="px-3 py-2 text-center">Carries</th>
                    <th className="w-10 px-2 py-2" aria-label="Actions" />
                  </tr>
                </ErpTableHead>
                <ErpTableBody>
                  {plan.rows.map((r) => (
                    <tr key={`${r.staffId}|${r.typeCode}`}>
                      <td className="px-3 py-2 text-xs font-medium text-[var(--brand-deep)]">{nameOf(r.staffId)}</td>
                      <td className="px-3 py-2 text-xs">{r.typeCode}</td>
                      <td className="px-3 py-2 text-center text-xs">{r.closingBalance}</td>
                      <td className="px-3 py-2 text-center text-xs">{r.cap}</td>
                      <td className="px-3 py-2 text-center text-xs font-semibold">{r.daysCarried}</td>
                      <td className="px-2 py-1.5 text-right">
                        <RowActionMenu row={r} label="Row actions" actions={[{ id: "copy", label: "Copy line", onSelect: (x) => void navigator.clipboard?.writeText(`${nameOf(x.staffId)} ${x.typeCode} ${x.daysCarried}`) }]} />
                      </td>
                    </tr>
                  ))}
                </ErpTableBody>
              </ErpTable>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ── 5 Reports ────────────────────────────────────────────────────────────

function ReportsStep({ ay, nameOf, flash }: { ay: string; nameOf: (id: string) => string; flash: (t: string, bad?: boolean) => void }) {
  const [book, setBook] = useState<BookResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<"summary" | "monthly">("summary");
  const [typeFilter, setTypeFilter] = useState("");

  useEffect(() => {
    let live = true;
    setBook(null);
    setErr(null);
    void call<BookResp>(`/api/staff/leave-book?ay=${encodeURIComponent(ay)}`).then((r) => {
      if (!live) return;
      if (!r.ok) setErr(r.error || "Could not load the leave book");
      else setBook(r);
    });
    return () => {
      live = false;
    };
  }, [ay]);

  if (err) return <p className={`${card} text-sm font-semibold text-[var(--danger)]`}>Couldn&apos;t load the report: {err}</p>;
  if (!book) return <p className="text-sm text-[var(--muted)]">Loading the leave book…</p>;
  if (!book.policy) return <p className={`${card} text-sm text-[var(--muted)]`}>{ay} has no leave policy yet — the reports under Staff → Reports use the desk balances.</p>;

  const rows = (book.rows ?? [])
    .filter((r) => !typeFilter || r.typeCode === typeFilter)
    .sort((a, b) => nameOf(a.staffId).localeCompare(nameOf(b.staffId)) || a.typeCode.localeCompare(b.typeCode));
  const months = book.months ?? [];
  const lwp = new Map<string, number>();
  for (const u of book.unpaid ?? []) lwp.set(u.staffId, (lwp.get(u.staffId) ?? 0) + u.taken);

  const summaryCols = [
    { key: "staff", header: "Staff", width: 2.4 },
    { key: "type", header: "Leave" },
    { key: "opening", header: "Carried in", align: "right" as const },
    { key: "allocated", header: "Allocated", align: "right" as const },
    { key: "taken", header: "Taken", align: "right" as const },
    { key: "sandwich", header: "of which sandwich", align: "right" as const },
    { key: "pending", header: "Pending", align: "right" as const },
    { key: "balance", header: "Balance", align: "right" as const },
    { key: "lwp", header: "LWP taken", align: "right" as const },
  ];
  const summaryRows = () =>
    rows.map((r) => ({
      staff: nameOf(r.staffId),
      type: r.typeCode,
      opening: r.opening,
      allocated: r.allocated,
      taken: r.taken,
      sandwich: r.sandwichDays,
      pending: r.pending,
      balance: r.balance,
      lwp: lwp.get(r.staffId) ?? 0,
    }));
  const monthlyCols = [
    { key: "staff", header: "Staff", width: 2.4 },
    { key: "type", header: "Leave" },
    { key: "start", header: "Start", align: "right" as const },
    ...months.map((m) => ({ key: m, header: monthLabel(m), align: "right" as const })),
  ];
  const monthlyRows = () =>
    rows.map((r) => ({
      staff: nameOf(r.staffId),
      type: r.typeCode,
      start: r.opening + r.allocated,
      ...Object.fromEntries(r.months.map((m) => [m.month, m.balance])),
    }));

  const cols = view === "summary" ? summaryCols : monthlyCols;
  const data = view === "summary" ? summaryRows() : monthlyRows();
  return (
    <div className={`${card} space-y-3`}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-lg border border-[var(--border)]">
          {(
            [
              ["summary", "Staff-wise summary"],
              ["monthly", "Monthly balance"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={view === id}
              className={`px-3 py-1.5 text-xs font-semibold ${view === id ? "bg-[var(--primary)] text-[var(--primary-foreground)]" : "text-[var(--brand-deep)]"}`}
              onClick={() => setView(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <select className="field !py-1.5 text-xs" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Leave type">
          <option value="">All paid types</option>
          {(book.types ?? []).map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <div className="ml-auto">
          <ExportMenu
            title={view === "summary" ? `Staff-wise leave summary — ${ay}` : `Monthly balance leave — ${ay}`}
            filterNote={typeFilter ? `Leave type: ${typeFilter}` : "All paid leave types"}
            columns={cols}
            rows={() => (view === "summary" ? summaryRows() : monthlyRows())}
            fileBaseName={view === "summary" ? `staff-leave-summary-${ay}` : `staff-leave-monthly-balance-${ay}`}
            onMessage={(m) => flash(m)}
          />
        </div>
      </div>
      <div className="max-h-[min(60vh,520px)] overflow-auto">
        <ErpTable>
          <ErpTableHead sticky>
            <tr>
              {cols.map((c) => (
                <th key={c.key} className={`whitespace-nowrap px-3 py-2 ${"align" in c && c.align === "right" ? "text-right" : "text-left"}`}>
                  {c.header}
                </th>
              ))}
              <th className="w-10 px-2 py-2" aria-label="Actions" />
            </tr>
          </ErpTableHead>
          <ErpTableBody>
            {data.map((d, i) => (
              <tr key={`${rows[i]?.staffId}|${rows[i]?.typeCode}`}>
                {cols.map((c) => {
                  const v = (d as Record<string, string | number>)[c.key];
                  const negative = typeof v === "number" && v < 0;
                  return (
                    <td key={c.key} className={`whitespace-nowrap px-3 py-1.5 text-xs ${"align" in c && c.align === "right" ? "text-right" : ""} ${negative ? "font-semibold text-[var(--danger)]" : ""} ${c.key === "staff" ? "font-medium text-[var(--brand-deep)]" : ""}`}>
                      {v ?? ""}
                    </td>
                  );
                })}
                <td className="px-2 py-1 text-right">
                  <RowActionMenu row={d} label="Row actions" actions={[{ id: "only", label: `Only ${rows[i]?.typeCode ?? ""}`, onSelect: () => setTypeFilter(rows[i]?.typeCode ?? "") }]} />
                </td>
              </tr>
            ))}
          </ErpTableBody>
        </ErpTable>
      </div>
      <p className="text-xs text-[var(--muted)]">A negative balance means more was approved than the policy allows (e.g. before the policy existed).</p>
    </div>
  );
}
