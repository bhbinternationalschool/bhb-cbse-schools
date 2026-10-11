"use client";

/**
 * Concession templates (Fees → Bulk & PDC → Concession templates).
 *
 * Named, reusable discounts — "Staff ward 50% tuition", "Sibling 2nd child
 * ₹500/month" — applied to one or many students. Applying creates ordinary
 * Masters concession grants, through the same rules as Masters → Concessions:
 * the ground is recorded on every grant, and only an owner / admin /
 * principal (or fees·approve) can make one effective at once — anyone else's
 * grant waits in Masters for approval, however small.
 *
 * Templates live on the server (fee_concession_templates). Their money
 * fields cannot be edited once made — that would re-rate every family
 * already on them — so a different rate is a new template.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, Plus, Power, RefreshCw, Trash2, UserPlus, X } from "lucide-react";
import { FeeToolsStudentPicker } from "@/components/fees/FeeToolsStudentPicker";
import { ErpTable, ErpTableBody, ErpTableHead, ErpTableShell } from "@/components/ui/erp-roster";
import { RowActionMenu, type RowAction } from "@/components/ui/erp-grid";
import { CONCESSION_GROUNDS, concessionGroundLabel, type ConcessionGround } from "@/lib/masters";
import type { ConcessionTemplate, TemplatePlanRow } from "@/lib/feeConcessionTemplates";
import { inr, rupeesToPaise, toolsGet, toolsPost, type LookupStudent } from "@/lib/feeToolsClient";

type TemplateRecord = ConcessionTemplate & { updatedAt: string; createdBy: string };
type Head = { id: string; name: string };

const BTN =
  "inline-flex items-center gap-1.5 rounded-xl bg-[var(--primary)] px-3 py-2 text-xs font-semibold text-[var(--primary-foreground)] disabled:opacity-50";
const BTN_OUTLINE =
  "inline-flex items-center gap-1.5 rounded-xl border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--brand-deep)] disabled:opacity-50";

function rateLabel(t: Pick<ConcessionTemplate, "mode" | "value">) {
  return t.mode === "percent" ? `${t.value}%` : `${inr(t.value)} per due`;
}

export function ConcessionTemplatesPanel({ canGrant, canApprove }: { canGrant: boolean; canApprove: boolean }) {
  const [templates, setTemplates] = useState<TemplateRecord[] | null>(null);
  const [heads, setHeads] = useState<Head[]>([]);
  const [loadError, setLoadError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [applying, setApplying] = useState<TemplateRecord | null>(null);
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);

  const load = useCallback(async () => {
    const r = await toolsGet<{ templates: TemplateRecord[]; feeHeads: Head[] }>("/api/fees/tools/concession-templates");
    if (!r.ok) {
      setLoadError(r.error);
      return;
    }
    setLoadError("");
    setTemplates(r.templates);
    setHeads(r.feeHeads);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const headName = (id: string) => heads.find((h) => h.id === id)?.name ?? id;

  async function update(t: TemplateRecord, patch: Record<string, unknown>, done: string) {
    const r = await toolsPost<{ template: TemplateRecord }>("/api/fees/tools/concession-templates", {
      action: "update",
      id: t.id,
      baseUpdatedAt: t.updatedAt,
      ...patch,
    });
    setMsg(r.ok ? { text: done, bad: false } : { text: r.error, bad: true });
    await load();
  }

  const actions: RowAction<TemplateRecord>[] = [
    { id: "apply", label: "Apply to students…", icon: <UserPlus />, hidden: (t) => !t.isActive || !canGrant, onSelect: (t) => setApplying(t) },
    {
      id: "rename",
      label: "Rename / change auto-approve limit",
      hidden: () => !canGrant,
      onSelect: (t) => {
        const name = window.prompt("Template name:", t.name);
        if (name == null) return;
        const lim = window.prompt(
          "Approve at once up to (₹ per due, approvers only). Leave blank for: always needs approval.",
          t.autoApproveMaxPaise == null ? "" : String(t.autoApproveMaxPaise / 100),
        );
        if (lim == null) return;
        const p = lim.trim() ? rupeesToPaise(lim) : null;
        if (lim.trim() && p == null) {
          setMsg({ text: "Enter a plain amount for the limit", bad: true });
          return;
        }
        void update(t, { name, autoApproveMaxPaise: p }, "Template updated");
      },
    },
    {
      id: "toggle",
      label: "Switch off",
      icon: <Power />,
      tone: "danger",
      separatorAbove: true,
      hidden: (t) => !t.isActive || !canGrant,
      onSelect: (t) => {
        if (window.confirm(`Switch off "${t.name}"? Families already granted keep their discount; it just cannot be applied again.`)) {
          void update(t, { isActive: false }, "Template switched off");
        }
      },
    },
    { id: "on", label: "Switch on", icon: <Power />, hidden: (t) => t.isActive || !canGrant, onSelect: (t) => void update(t, { isActive: true }, "Template switched on") },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-xs text-[var(--muted)]">
          Applying a template records ordinary concessions in Masters with the template&apos;s ground.
          {canApprove
            ? " As an approver, grants at or under a template's auto-approve limit take effect at once; others wait for approval."
            : " Your grants wait for a principal, admin or owner to approve them in Masters → Concessions."}
        </p>
        <div className="flex gap-2">
          <button type="button" className={BTN_OUTLINE} onClick={() => void load()} aria-label="Reload">
            <RefreshCw className="size-3.5" />
          </button>
          {canGrant ? (
            <button type="button" className={BTN} onClick={() => setShowForm((v) => !v)}>
              <Plus className="size-3.5" /> New template
            </button>
          ) : null}
        </div>
      </div>

      {msg ? (
        <p className={`rounded-lg px-3 py-2 text-sm font-medium ${msg.bad ? "bg-[var(--danger-soft)] text-[var(--danger)]" : "bg-[var(--surface-sunken)] text-[var(--brand-deep)]"}`}>
          {msg.text}
        </p>
      ) : null}

      {showForm && canGrant ? (
        <TemplateForm
          heads={heads}
          onCancel={() => setShowForm(false)}
          onSaved={async (t) => {
            setShowForm(false);
            setMsg({ text: `Template "${t.name}" created`, bad: false });
            await load();
          }}
        />
      ) : null}

      {applying ? (
        <ApplyTemplate
          template={applying}
          onClose={() => setApplying(null)}
          onApplied={(text) => {
            setApplying(null);
            setMsg({ text, bad: false });
          }}
        />
      ) : null}

      {loadError ? (
        <p className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm font-medium text-[var(--danger)]">Could not load the templates: {loadError}</p>
      ) : templates === null ? (
        <p className="text-sm text-[var(--muted)]">Loading…</p>
      ) : (
        <ErpTableShell exportAs="concession-templates" exportTitle="Concession templates">
          <div className="overflow-x-auto">
            <ErpTable>
              <ErpTableHead>
                <tr>
                  <th className="px-3 py-2">Template</th>
                  <th className="px-3 py-2">Ground</th>
                  <th className="px-3 py-2">Discount</th>
                  <th className="px-3 py-2">Fee heads</th>
                  <th className="px-3 py-2">Ends</th>
                  <th className="px-3 py-2">Approve at once up to</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </ErpTableHead>
              <ErpTableBody hoverable>
                {templates.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-sm text-[var(--muted)]">
                      No templates yet. Make one for each discount the school gives often.
                    </td>
                  </tr>
                ) : (
                  templates.map((t) => (
                    <tr key={t.id} className={t.isActive ? "" : "opacity-60"}>
                      <td className="px-3 py-2">
                        <div className="font-semibold text-[var(--brand-deep)]">{t.name}</div>
                        <div className="text-[11px] text-[var(--muted)]">{t.ruleCode}{t.isActive ? "" : " · switched off"}</div>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {concessionGroundLabel(t.ground)}
                        {t.siblingChildNo ? ` · child ${t.siblingChildNo}` : ""}
                      </td>
                      <td className="px-3 py-2 font-semibold tabular-nums">{rateLabel(t)}</td>
                      <td className="px-3 py-2 text-xs">{t.feeHeadIds.length ? t.feeHeadIds.map(headName).join(", ") : "All heads"}</td>
                      <td className="px-3 py-2 text-xs">{t.endPolicy === "open" ? "No end date" : "31 March (session end)"}</td>
                      <td className="px-3 py-2 text-xs">{t.autoApproveMaxPaise == null ? "Always needs approval" : inr(t.autoApproveMaxPaise)}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          {t.isActive && canGrant ? (
                            <button type="button" className={BTN_OUTLINE} onClick={() => setApplying(t)}>
                              Apply
                            </button>
                          ) : null}
                          <RowActionMenu row={t} actions={actions} />
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </ErpTableBody>
            </ErpTable>
          </div>
        </ErpTableShell>
      )}
    </div>
  );
}

function TemplateForm({ heads, onCancel, onSaved }: { heads: Head[]; onCancel: () => void; onSaved: (t: TemplateRecord) => void | Promise<void> }) {
  const [name, setName] = useState("");
  const [ground, setGround] = useState<ConcessionGround | "">("");
  const [mode, setMode] = useState<"percent" | "fixed">("percent");
  const [value, setValue] = useState("");
  const [headIds, setHeadIds] = useState<string[]>([]);
  const [childNo, setChildNo] = useState("");
  const [endPolicy, setEndPolicy] = useState<"session_end" | "open">("session_end");
  const [limit, setLimit] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setError("");
    if (!ground) {
      setError("Choose the ground — why families qualify");
      return;
    }
    const v = mode === "percent" ? Number(value) : rupeesToPaise(value);
    if (v == null || !Number.isFinite(v) || v <= 0) {
      setError("Enter the discount");
      return;
    }
    const lim = limit.trim() ? rupeesToPaise(limit) : null;
    if (limit.trim() && lim == null) {
      setError("Enter a plain amount for the auto-approve limit, or leave it blank");
      return;
    }
    setBusy(true);
    const r = await toolsPost<{ template: TemplateRecord }>("/api/fees/tools/concession-templates", {
      action: "create",
      name,
      ground,
      mode,
      value: v,
      feeHeadIds: headIds,
      siblingChildNo: ground === "sibling" && childNo ? Number(childNo) : null,
      endPolicy,
      autoApproveMaxPaise: lim,
      defaultReason: reason,
    });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    await onSaved(r.template);
  }

  return (
    <div className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-[var(--brand-deep)]">New concession template</h3>
        <button type="button" className={BTN_OUTLINE} onClick={onCancel} aria-label="Close">
          <X className="size-3.5" />
        </button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-xs">
          <span className="mb-0.5 block text-[var(--muted)]">Name</span>
          <input className="field w-full" value={name} onChange={(e) => setName(e.target.value)} placeholder="Staff ward 50% tuition" />
        </label>
        <label className="text-xs">
          <span className="mb-0.5 block text-[var(--muted)]">Ground (why families qualify)</span>
          <select className="field w-full" value={ground} onChange={(e) => setGround(e.target.value as ConcessionGround)}>
            <option value="">Choose…</option>
            {CONCESSION_GROUNDS.map((g) => (
              <option key={g.id} value={g.id}>{g.label}</option>
            ))}
          </select>
        </label>
        {ground === "sibling" ? (
          <label className="text-xs">
            <span className="mb-0.5 block text-[var(--muted)]">For which child (2 = 2nd child)</span>
            <input className="field w-full" inputMode="numeric" value={childNo} onChange={(e) => setChildNo(e.target.value)} placeholder="2" />
          </label>
        ) : null}
        <div className="text-xs">
          <span className="mb-0.5 block text-[var(--muted)]">Discount</span>
          <div className="flex gap-2">
            <select className="field" value={mode} onChange={(e) => setMode(e.target.value === "fixed" ? "fixed" : "percent")}>
              <option value="percent">Percent</option>
              <option value="fixed">₹ per due</option>
            </select>
            <input className="field w-full" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder={mode === "percent" ? "50" : "500"} />
          </div>
        </div>
        <label className="text-xs">
          <span className="mb-0.5 block text-[var(--muted)]">Ends</span>
          <select className="field w-full" value={endPolicy} onChange={(e) => setEndPolicy(e.target.value === "open" ? "open" : "session_end")}>
            <option value="session_end">31 March — end of the session</option>
            <option value="open">No end date (standing policy)</option>
          </select>
        </label>
        <label className="text-xs">
          <span className="mb-0.5 block text-[var(--muted)]">Approve at once up to ₹ per due (blank = always approval)</span>
          <input className="field w-full" inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} />
        </label>
      </div>
      <div className="text-xs">
        <span className="mb-1 block text-[var(--muted)]">Fee heads (none ticked = every head)</span>
        <div className="flex flex-wrap gap-2">
          {heads.map((h) => (
            <label key={h.id} className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-2 py-1">
              <input
                type="checkbox"
                className="size-3.5 accent-[var(--brand-deep)]"
                checked={headIds.includes(h.id)}
                onChange={() => setHeadIds((prev) => (prev.includes(h.id) ? prev.filter((x) => x !== h.id) : [...prev, h.id]))}
              />
              {h.name}
            </label>
          ))}
        </div>
      </div>
      <label className="block text-xs">
        <span className="mb-0.5 block text-[var(--muted)]">Default reason on each grant</span>
        <input className="field w-full" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Staff ward policy 2026-27" />
      </label>
      <p className="text-[11px] text-[var(--muted)]">The rate, heads and ground cannot be changed later — a different rate is a new template.</p>
      <div className="flex items-center gap-2">
        <button type="button" className={BTN} disabled={busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Save template"}
        </button>
        {error ? <span className="text-xs font-medium text-[var(--danger)]">{error}</span> : null}
      </div>
    </div>
  );
}

function ApplyTemplate({
  template,
  onClose,
  onApplied,
}: {
  template: TemplateRecord;
  onClose: () => void;
  onApplied: (text: string) => void;
}) {
  const [students, setStudents] = useState<LookupStudent[]>([]);
  const [fromMonth, setFromMonth] = useState(() =>
    new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }).slice(0, 7),
  );
  const [reason, setReason] = useState("");
  const [rows, setRows] = useState<TemplatePlanRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ids = useMemo(() => students.map((s) => s.id), [students]);

  useEffect(() => setRows(null), [ids, fromMonth, reason]);

  function add(list: LookupStudent[]) {
    setStudents((prev) => {
      const have = new Set(prev.map((s) => s.id));
      return [...prev, ...list.filter((s) => !have.has(s.id))];
    });
  }

  async function addSiblings(s: LookupStudent) {
    if (!s.siblingIds.length) return;
    const r = await toolsGet<{ students: LookupStudent[] }>(`/api/fees/tools/lookup?studentIds=${encodeURIComponent(s.siblingIds.join(","))}`);
    if (r.ok) add(r.students);
    else setError(r.error);
  }

  async function run(preview: boolean) {
    setBusy(true);
    setError("");
    const r = await toolsPost<{ rows: TemplatePlanRow[]; granted: number; approved: number; pending: number }>(
      "/api/fees/tools/concession-templates",
      { action: "apply", templateId: template.id, studentIds: ids, fromMonth, reason, preview },
    );
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    if (preview) {
      setRows(r.rows);
      return;
    }
    onApplied(
      `"${template.name}": ${r.granted} grant(s) recorded — ${r.approved} approved, ${r.pending} waiting for approval in Masters → Concessions.`,
    );
  }

  const actions: RowAction<LookupStudent>[] = [
    { id: "sibs", label: "Add brothers / sisters", icon: <UserPlus />, hidden: (s) => !s.siblingIds.length, onSelect: (s) => void addSiblings(s) },
    { id: "remove", label: "Remove", icon: <Trash2 />, tone: "danger", separatorAbove: true, onSelect: (s) => setStudents((p) => p.filter((x) => x.id !== s.id)) },
  ];
  const rowFor = (id: string) => rows?.find((r) => r.studentId === id);
  const toGrant = rows?.filter((r) => r.action === "grant").length ?? 0;

  return (
    <div className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-[var(--brand-deep)]">
          Apply “{template.name}” — {rateLabel(template)} · {concessionGroundLabel(template.ground)}
        </h3>
        <button type="button" className={BTN_OUTLINE} onClick={onClose} aria-label="Close">
          <X className="size-3.5" />
        </button>
      </div>
      <div className="grid gap-2 sm:grid-cols-[1fr_auto_1fr]">
        <FeeToolsStudentPicker onPick={(s) => add([s])} />
        <label className="text-xs">
          <span className="mb-0.5 block text-[var(--muted)]">From month</span>
          <input type="month" className="field" value={fromMonth} onChange={(e) => setFromMonth(e.target.value)} />
        </label>
        <label className="text-xs">
          <span className="mb-0.5 block text-[var(--muted)]">Reason (blank = template default)</span>
          <input className="field w-full" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={template.defaultReason || template.name} />
        </label>
      </div>
      {students.length ? (
        <ErpTableShell density="compact">
          <div className="overflow-x-auto">
            <ErpTable minWidth="min-w-[560px]">
              <ErpTableHead>
                <tr>
                  <th className="px-3 py-2">Student</th>
                  <th className="px-3 py-2">Family</th>
                  <th className="px-3 py-2 text-right">Est. per due</th>
                  <th className="px-3 py-2">Result</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </ErpTableHead>
              <ErpTableBody>
                {students.map((s) => {
                  const r = rowFor(s.id);
                  return (
                    <tr key={s.id}>
                      <td className="px-3 py-2">
                        <div className="font-semibold text-[var(--brand-deep)]">{s.name}</div>
                        <div className="text-[11px] text-[var(--muted)]">{s.classLabel} · {s.admissionNo}</div>
                      </td>
                      <td className="px-3 py-2 text-xs">{s.guardianName || "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r ? inr(r.estPaise) : "—"}</td>
                      <td className={`px-3 py-2 text-xs ${r?.action === "skip" ? "text-[var(--muted)]" : "font-semibold"}`}>{r ? r.why : "Preview to see"}</td>
                      <td className="px-3 py-2">
                        <RowActionMenu row={s} actions={actions} />
                      </td>
                    </tr>
                  );
                })}
              </ErpTableBody>
            </ErpTable>
          </div>
        </ErpTableShell>
      ) : (
        <p className="text-xs text-[var(--muted)]">Add the students this discount is for.</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={BTN_OUTLINE} disabled={busy || students.length === 0} onClick={() => void run(true)}>
          <Eye className="size-3.5" /> Preview
        </button>
        <button
          type="button"
          className={BTN}
          disabled={busy || !rows || toGrant === 0}
          onClick={() => {
            if (window.confirm(`Record "${template.name}" for ${toGrant} student(s) from ${fromMonth}?`)) void run(false);
          }}
        >
          {busy ? "Working…" : `Grant to ${toGrant} student(s)`}
        </button>
        {error ? <span className="text-xs font-medium text-[var(--danger)]">{error}</span> : null}
      </div>
    </div>
  );
}
