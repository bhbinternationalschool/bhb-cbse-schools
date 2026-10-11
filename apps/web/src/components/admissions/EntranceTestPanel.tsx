"use client";

/**
 * Admissions → Entrance test.
 *
 * The old SStudy ERP's admission exam, in six steps: set up the test (date,
 * time, venue, classes, subjects and maximum marks, pass mark) → put the
 * applicants on the roll and print the roll list / attendance sheet → enter
 * marks → decide results (pass mark in bulk, override by hand) → message the
 * families (preview, then send through approved templates) → class summary.
 *
 * Everything here is server truth (admission_entrance_* via
 * /api/admissions/entrance-test). The leads desk is never written: the roll
 * points at a lead by id, and the CRM record shows a read-only badge.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ClipboardList, FileText, Plus, RefreshCw, Send } from "lucide-react";
import { StepTabs, type StepDef } from "@/components/ui/StepTabs";
import {
  ErpMetricCard,
  ErpMetricGrid,
  ErpPanel,
  ErpTable,
  ErpTableBody,
  ErpTableHead,
  ErpTableShell,
} from "@/components/ui/erp-roster";
import {
  BulkActionBar,
  ErpControlBar,
  ExportMenu,
  RowActionMenu,
  RowCheckbox,
  useRowSelection,
  type ExportRow,
} from "@/components/ui/erp-grid";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { erpBtn, erpBtnOutline, erpField } from "@/components/ui/erp-ui";
import { pushToast } from "@/components/shell/Toast";
import { downloadPdfReport, type ReportColumn } from "@/lib/reportExport";
import type { SchoolClass } from "@/lib/masters";
import {
  ENTRANCE_RESULT_STATUSES,
  candidateScore,
  classSummary,
  entranceStatusLabel,
  formatTestDate,
  formatTestTime,
  parseMarkInput,
  rankCandidates,
  rollCompare,
  suggestedStatus,
  type EntranceCandidate,
  type EntranceNotifyKind,
  type EntranceResultStatus,
  type EntranceSession,
  type EntranceSubject,
} from "@/lib/admissionEntranceTest";
import { cn } from "@/lib/utils";

type Step = "setup" | "roll" | "marks" | "results" | "notify" | "summary";

type Load<T> = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: T };

type Bundle = { session: EntranceSession; candidates: EntranceCandidate[] };

const API = "/api/admissions/entrance-test";

async function getJson<T>(url: string): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string } & T;
    if (!res.ok || body.ok === false) return { ok: false, error: body.error || `Request failed (${res.status})` };
    return { ok: true, data: body };
  } catch (e) {
    return { ok: false, error: `Could not reach the server (${e instanceof Error ? e.message : "network"})` };
  }
}

async function postJson<T>(
  url: string,
  payload: unknown,
): Promise<{ ok: true; data: T } | { ok: false; error: string; data?: T }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string } & T;
    if (!res.ok) return { ok: false, error: body.error || `Request failed (${res.status})`, data: body };
    return { ok: true, data: body };
  } catch (e) {
    return { ok: false, error: `Could not reach the server (${e instanceof Error ? e.message : "network"}) — nothing was confirmed saved.` };
  }
}

function toastError(message: string) {
  pushToast({ kind: "error", message });
}
function toastOk(message: string) {
  pushToast({ kind: "success", message });
}

/** Merge rows the server just returned into the roll, by id. */
function mergeCandidates(list: EntranceCandidate[], saved: EntranceCandidate[]): EntranceCandidate[] {
  const byId = new Map(saved.map((c) => [c.id, c]));
  return list.map((c) => byId.get(c.id) ?? c);
}

const STATUS_CHIP: Record<string, string> = {
  selected: "bg-[var(--success-soft)] text-[var(--success)]",
  waitlisted: "bg-[var(--warning-soft)] text-[var(--warning)]",
  not_selected: "bg-[var(--danger-soft)] text-[var(--danger)]",
  absent: "bg-[var(--surface-sunken)] text-[var(--muted)]",
  "": "bg-[var(--surface-sunken)] text-[var(--muted)]",
};

export function EntranceStatusChip({ status, manual }: { status: EntranceResultStatus; manual?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold", STATUS_CHIP[status])}>
      {entranceStatusLabel(status)}
      {manual ? <span className="font-normal opacity-75">· by hand</span> : null}
    </span>
  );
}

export function EntranceTestPanel({
  classes,
  academicYearCode,
  canCreate,
  canEdit,
  canDelete,
  focusSessionId,
  onOpenLead,
}: {
  classes: SchoolClass[];
  /** The header's session. "" = not known — the panel refuses rather than guessing a year. */
  academicYearCode: string;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  /** Open this sitting first (from a lead's badge). */
  focusSessionId?: string;
  onOpenLead: (leadId: string) => void;
}) {
  const [step, setStep] = useState<Step>("setup");
  const [sessions, setSessions] = useState<Load<EntranceSession[]>>({ status: "loading" });
  const [selectedId, setSelectedId] = useState(focusSessionId || "");
  const [bundle, setBundle] = useState<Load<Bundle> | null>(null);

  const className = useCallback(
    (id: string) => classes.find((c) => c.id === id)?.name || "",
    [classes],
  );

  const loadSessions = useCallback(async () => {
    if (!academicYearCode) return;
    setSessions({ status: "loading" });
    const r = await getJson<{ sessions: EntranceSession[] }>(
      `${API}?view=sessions&academicYearCode=${encodeURIComponent(academicYearCode)}`,
    );
    if (!r.ok) setSessions({ status: "error", message: r.error });
    else setSessions({ status: "ready", data: r.data.sessions });
  }, [academicYearCode]);

  const loadBundle = useCallback(async (id: string) => {
    if (!id) {
      setBundle(null);
      return;
    }
    setBundle({ status: "loading" });
    const r = await getJson<Bundle>(`${API}?view=session&id=${encodeURIComponent(id)}`);
    if (!r.ok) setBundle({ status: "error", message: r.error });
    else setBundle({ status: "ready", data: { session: r.data.session, candidates: r.data.candidates } });
  }, []);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    void loadBundle(selectedId);
  }, [selectedId, loadBundle]);

  useEffect(() => {
    if (focusSessionId) {
      setSelectedId(focusSessionId);
      setStep("results");
    }
  }, [focusSessionId]);

  const ready = bundle?.status === "ready" ? bundle.data : null;

  const setCandidates = useCallback((fn: (list: EntranceCandidate[]) => EntranceCandidate[]) => {
    setBundle((b) => (b && b.status === "ready" ? { status: "ready", data: { ...b.data, candidates: fn(b.data.candidates) } } : b));
  }, []);

  const steps: StepDef<Step>[] = [
    { id: "setup", title: "Test setup", what: "Name, date, time, venue, classes, subjects with maximum marks, and the pass mark.", badge: sessions.status === "ready" ? sessions.data.length : undefined },
    { id: "roll", title: "Roll & attendance", what: "Put applicants for these classes on the roll; print the roll list and the attendance sheet.", badge: ready?.candidates.length },
    { id: "marks", title: "Marks", what: "Type marks subject by subject — Enter moves down. Tick Absent for a child who did not come." },
    { id: "results", title: "Results", what: "Apply the pass mark to everyone, then change any child by hand. A hand decision is never overwritten by the rule." },
    { id: "notify", title: "Message families", what: "Preview each family's WhatsApp in their language, then send through the approved template." },
    { id: "summary", title: "Summary", what: "Class by class: on the roll, appeared, selected, waitlisted." },
  ];

  if (!academicYearCode) {
    return (
      <ErpPanel title="Entrance test">
        <p className="text-sm text-[var(--muted)]">
          The academic session is not known on this screen — choose a session in the header, then come back.
        </p>
      </ErpPanel>
    );
  }

  const sessionPicker =
    step !== "setup" && step !== "summary" ? (
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2">
        <label className="text-xs font-semibold text-[var(--muted)]" htmlFor="entrance-session-pick">
          Test
        </label>
        <select
          id="entrance-session-pick"
          className={cn(erpField, "max-w-md")}
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
        >
          <option value="">— choose a test —</option>
          {sessions.status === "ready"
            ? sessions.data.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {formatTestDate(s.testDate, "en")}
                </option>
              ))
            : null}
        </select>
        {selectedId ? (
          <button type="button" className={erpBtnOutline} onClick={() => void loadBundle(selectedId)}>
            <RefreshCw className="size-4" /> Reload
          </button>
        ) : null}
      </div>
    ) : null;

  function needSession() {
    if (!selectedId) {
      return <p className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-6 text-center text-sm text-[var(--muted)]">Choose a test above (or create one in step 1).</p>;
    }
    if (!bundle || bundle.status === "loading") {
      return <p className="px-3 py-6 text-center text-sm text-[var(--muted)]">Loading the test…</p>;
    }
    if (bundle.status === "error") {
      return (
        <p className="rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] px-3 py-3 text-sm text-[var(--danger)]">
          Could not load this test: {bundle.message}. Nothing is shown rather than an empty roll — use Reload.
        </p>
      );
    }
    return null;
  }

  return (
    <StepTabs aria-label="Entrance test steps" steps={steps} value={step} onChange={setStep}>
      {sessionPicker}
      {step === "setup" ? (
        <SetupStep
          sessions={sessions}
          classes={classes}
          academicYearCode={academicYearCode}
          canCreate={canCreate}
          canEdit={canEdit}
          canDelete={canDelete}
          className={className}
          onReload={loadSessions}
          onOpen={(id, next) => {
            setSelectedId(id);
            setStep(next);
          }}
          onSaved={(s) => {
            void loadSessions();
            if (s.id === selectedId) void loadBundle(s.id);
          }}
          onDeleted={(id) => {
            if (id === selectedId) setSelectedId("");
            void loadSessions();
          }}
        />
      ) : null}
      {step === "summary" ? <SummaryStep academicYearCode={academicYearCode} className={className} /> : null}
      {step !== "setup" && step !== "summary" ? (needSession() ?? (ready ? (
        <>
          {step === "roll" ? (
            <RollStep bundle={ready} className={className} canCreate={canCreate} canDelete={canDelete} onOpenLead={onOpenLead} onChanged={() => void loadBundle(ready.session.id)} />
          ) : null}
          {step === "marks" ? (
            <MarksStep bundle={ready} className={className} canEdit={canEdit} onSaved={(saved) => setCandidates((l) => mergeCandidates(l, saved))} onReload={() => void loadBundle(ready.session.id)} />
          ) : null}
          {step === "results" ? (
            <ResultsStep bundle={ready} className={className} canEdit={canEdit} onOpenLead={onOpenLead} onSaved={(saved) => setCandidates((l) => mergeCandidates(l, saved))} />
          ) : null}
          {step === "notify" ? (
            <NotifyStep bundle={ready} className={className} canEdit={canEdit} onSent={() => void loadBundle(ready.session.id)} />
          ) : null}
        </>
      ) : null)) : null}
    </StepTabs>
  );
}

/* ─── Step 1: setup ─────────────────────────────────────────────── */

type SessionForm = {
  id: string;
  updatedAt: string;
  name: string;
  testDate: string;
  startTime: string;
  venue: string;
  classIds: string[];
  subjects: { id: string; name: string; maxMarks: string }[];
  passPercent: string;
  waitlistPercent: string;
  notes: string;
};

function blankForm(): SessionForm {
  return {
    id: "",
    updatedAt: "",
    name: "",
    testDate: "",
    startTime: "10:00",
    venue: "",
    classIds: [],
    subjects: [
      { id: "", name: "English", maxMarks: "25" },
      { id: "", name: "Hindi", maxMarks: "25" },
      { id: "", name: "Mathematics", maxMarks: "25" },
    ],
    passPercent: "40",
    waitlistPercent: "",
    notes: "",
  };
}

function formFrom(s: EntranceSession): SessionForm {
  return {
    id: s.id,
    updatedAt: s.updatedAt,
    name: s.name,
    testDate: s.testDate,
    startTime: s.startTime,
    venue: s.venue,
    classIds: [...s.classIds],
    subjects: s.subjects.map((x) => ({ id: x.id, name: x.name, maxMarks: String(x.maxMarks) })),
    passPercent: String(s.passPercent),
    waitlistPercent: s.waitlistPercent === null ? "" : String(s.waitlistPercent),
    notes: s.notes,
  };
}

function SetupStep({
  sessions,
  classes,
  academicYearCode,
  canCreate,
  canEdit,
  canDelete,
  className,
  onReload,
  onOpen,
  onSaved,
  onDeleted,
}: {
  sessions: Load<EntranceSession[]>;
  classes: SchoolClass[];
  academicYearCode: string;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  className: (id: string) => string;
  onReload: () => void;
  onOpen: (id: string, step: Step) => void;
  onSaved: (s: EntranceSession) => void;
  onDeleted: (id: string) => void;
}) {
  const [form, setForm] = useState<SessionForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<EntranceSession | null>(null);

  async function save() {
    if (!form) return;
    setBusy(true);
    const session = {
      name: form.name,
      academicYearCode,
      testDate: form.testDate,
      startTime: form.startTime,
      venue: form.venue,
      classIds: form.classIds,
      subjects: form.subjects.map((s) => ({ id: s.id, name: s.name, maxMarks: Number(s.maxMarks) })),
      passPercent: form.passPercent === "" ? NaN : Number(form.passPercent),
      waitlistPercent: form.waitlistPercent,
      notes: form.notes,
    };
    const r = await postJson<{ session: EntranceSession }>(
      API,
      form.id
        ? { action: "update_session", id: form.id, updatedAt: form.updatedAt, session }
        : { action: "create_session", session },
    );
    setBusy(false);
    if (!r.ok) {
      toastError(r.error);
      return;
    }
    toastOk(form.id ? "Test updated" : "Test created");
    setForm(null);
    onSaved(r.data.session);
  }

  async function doDelete(s: EntranceSession) {
    const r = await postJson(API, { action: "delete_session", id: s.id });
    if (!r.ok) {
      toastError(r.error);
      return;
    }
    toastOk("Test deleted");
    onDeleted(s.id);
  }

  const list = sessions.status === "ready" ? sessions.data : [];

  return (
    <div className="space-y-4">
      <ErpControlBar
        summary={<span className="text-xs text-[var(--muted)]">Session {academicYearCode}</span>}
        actions={
          <>
            <button type="button" className={erpBtnOutline} onClick={onReload}>
              <RefreshCw className="size-4" /> Reload
            </button>
            {canCreate ? (
              <button type="button" className={erpBtn} onClick={() => setForm(blankForm())}>
                <Plus className="size-4" /> New test
              </button>
            ) : null}
          </>
        }
      />

      {form ? (
        <ErpPanel title={form.id ? "Edit test" : "New entrance test"} description="Marks already entered keep their subject: a subject that holds marks cannot be removed, and a maximum cannot drop below a mark already given.">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1 text-xs font-semibold text-[var(--muted)]">
              Name
              <input className={erpField} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Entrance test — April" />
            </label>
            <label className="space-y-1 text-xs font-semibold text-[var(--muted)]">
              Venue
              <input className={erpField} value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })} placeholder="Main building, Room 4" />
            </label>
            <label className="space-y-1 text-xs font-semibold text-[var(--muted)]">
              Date
              <input type="date" className={erpField} value={form.testDate} onChange={(e) => setForm({ ...form, testDate: e.target.value })} />
            </label>
            <label className="space-y-1 text-xs font-semibold text-[var(--muted)]">
              Start time
              <input type="time" className={erpField} value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} />
            </label>
            <label className="space-y-1 text-xs font-semibold text-[var(--muted)]">
              Pass mark (% of total) — at or above = Selected
              <input inputMode="decimal" className={erpField} value={form.passPercent} onChange={(e) => setForm({ ...form, passPercent: e.target.value })} />
            </label>
            <label className="space-y-1 text-xs font-semibold text-[var(--muted)]">
              Waitlist mark (%) — optional, below the pass mark
              <input inputMode="decimal" className={erpField} value={form.waitlistPercent} onChange={(e) => setForm({ ...form, waitlistPercent: e.target.value })} placeholder="e.g. 30 — blank = no waitlist band" />
            </label>
          </div>

          <fieldset className="mt-4">
            <legend className="text-xs font-semibold text-[var(--muted)]">Classes this test is for</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {classes.map((c) => {
                const on = form.classIds.includes(c.id);
                return (
                  <label key={c.id} className={cn("inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs", on ? "border-[var(--brand-deep)] bg-[var(--surface-sunken)] font-semibold text-[var(--brand-deep)]" : "border-[var(--border)] text-[var(--foreground)]")}>
                    <input
                      type="checkbox"
                      className="accent-[var(--brand-deep)]"
                      checked={on}
                      onChange={() =>
                        setForm({
                          ...form,
                          classIds: on ? form.classIds.filter((x) => x !== c.id) : [...form.classIds, c.id],
                        })
                      }
                    />
                    {c.name}
                  </label>
                );
              })}
              {classes.length === 0 ? <span className="text-xs text-[var(--muted)]">Classes have not loaded from Masters yet.</span> : null}
            </div>
          </fieldset>

          <fieldset className="mt-4">
            <legend className="text-xs font-semibold text-[var(--muted)]">Subjects and maximum marks</legend>
            <div className="mt-2 space-y-2">
              {form.subjects.map((s, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <input className={cn(erpField, "max-w-xs")} value={s.name} aria-label={`Subject ${i + 1} name`} onChange={(e) => setForm({ ...form, subjects: form.subjects.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                  <input className={cn(erpField, "w-24")} inputMode="decimal" value={s.maxMarks} aria-label={`Subject ${i + 1} maximum marks`} onChange={(e) => setForm({ ...form, subjects: form.subjects.map((x, j) => (j === i ? { ...x, maxMarks: e.target.value } : x)) })} />
                  <span className="text-xs text-[var(--muted)]">max</span>
                  <button type="button" className="text-xs font-semibold text-[var(--danger)]" onClick={() => setForm({ ...form, subjects: form.subjects.filter((_, j) => j !== i) })}>
                    Remove
                  </button>
                </div>
              ))}
              <button type="button" className={erpBtnOutline} onClick={() => setForm({ ...form, subjects: [...form.subjects, { id: "", name: "", maxMarks: "25" }] })}>
                <Plus className="size-4" /> Add subject
              </button>
            </div>
          </fieldset>

          <label className="mt-4 block space-y-1 text-xs font-semibold text-[var(--muted)]">
            Notes (office only)
            <textarea className={cn(erpField, "h-16 py-2")} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </label>

          <div className="mt-4 flex gap-2">
            <button type="button" className={erpBtn} disabled={busy || !(form.id ? canEdit : canCreate)} onClick={() => void save()}>
              {busy ? "Saving…" : form.id ? "Save changes" : "Create test"}
            </button>
            <button type="button" className={erpBtnOutline} onClick={() => setForm(null)}>
              Cancel
            </button>
          </div>
        </ErpPanel>
      ) : null}

      {sessions.status === "error" ? (
        <p className="rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] px-3 py-3 text-sm text-[var(--danger)]">
          Could not load the tests: {sessions.message}
        </p>
      ) : null}

      <ErpTableShell>
        <div className="overflow-x-auto">
          <ErpTable minWidth="min-w-[860px]">
            <ErpTableHead>
              <tr>
                <th className="px-3 py-2">Test</th>
                <th className="px-3 py-2">Date &amp; time</th>
                <th className="px-3 py-2">Venue</th>
                <th className="px-3 py-2">Classes</th>
                <th className="px-3 py-2">Subjects</th>
                <th className="px-3 py-2">Pass mark</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </ErpTableHead>
            <ErpTableBody hoverable>
              {sessions.status === "loading" ? (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-sm text-[var(--muted)]">Loading…</td></tr>
              ) : null}
              {sessions.status === "ready" && list.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-sm text-[var(--muted)]">No entrance test in {academicYearCode} yet.{canCreate ? " Click New test." : ""}</td></tr>
              ) : null}
              {list.map((s) => (
                <tr key={s.id} className="cursor-pointer" onClick={() => onOpen(s.id, "roll")}>
                  <td className="px-3 py-2 font-semibold text-[var(--brand-deep)]">{s.name}</td>
                  <td className="px-3 py-2">{formatTestDate(s.testDate, "en")}{s.startTime ? ` · ${formatTestTime(s.startTime, "en")}` : ""}</td>
                  <td className="px-3 py-2">{s.venue || <span className="text-[var(--muted)]">not set</span>}</td>
                  <td className="px-3 py-2">{s.classIds.map((id) => className(id) || id).join(", ")}</td>
                  <td className="px-3 py-2 text-xs">{s.subjects.map((x) => `${x.name} (${x.maxMarks})`).join(" · ")}</td>
                  <td className="px-3 py-2">{s.passPercent}%{s.waitlistPercent !== null ? ` · waitlist ${s.waitlistPercent}%` : ""}</td>
                  <td className="px-3 py-2 text-right">
                    <RowActionMenu
                      row={s}
                      actions={[
                        { id: "roll", label: "Roll & attendance", onSelect: (r) => onOpen(r.id, "roll") },
                        { id: "marks", label: "Enter marks", onSelect: (r) => onOpen(r.id, "marks") },
                        { id: "results", label: "Results", onSelect: (r) => onOpen(r.id, "results") },
                        { id: "edit", label: "Edit test", hidden: () => !canEdit, onSelect: (r) => setForm(formFrom(r)) },
                        { id: "delete", label: "Delete test", tone: "danger", separatorAbove: true, hidden: () => !canDelete, onSelect: (r) => setConfirmDelete(r) },
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </ErpTableBody>
          </ErpTable>
        </div>
      </ErpTableShell>

      <ConfirmDialog
        open={!!confirmDelete}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
        title={`Delete “${confirmDelete?.name ?? ""}”?`}
        description="Only a test with nobody on its roll can be deleted. This cannot be undone."
        confirmLabel="Delete test"
        onConfirm={async () => {
          if (confirmDelete) await doDelete(confirmDelete);
          setConfirmDelete(null);
        }}
      />
    </div>
  );
}

/* ─── Step 2: roll ──────────────────────────────────────────────── */

type Applicant = {
  leadId: string;
  childName: string;
  guardianName: string;
  mobile: string;
  classId: string;
  stage: string;
  applicationNo: string;
  enquiryNo: string;
  onRoll: boolean;
};

const STAGE_LABEL: Record<string, string> = { enquiry: "Open", applied: "Registered", verified: "Verified" };

function RollStep({
  bundle,
  className,
  canCreate,
  canDelete,
  onOpenLead,
  onChanged,
}: {
  bundle: Bundle;
  className: (id: string) => string;
  canCreate: boolean;
  canDelete: boolean;
  onOpenLead: (id: string) => void;
  onChanged: () => void;
}) {
  const { session } = bundle;
  const roll = useMemo(() => [...bundle.candidates].sort((a, b) => rollCompare(a.rollNo, b.rollNo)), [bundle.candidates]);
  const [picker, setPicker] = useState<Load<Applicant[]> | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<EntranceCandidate | null>(null);
  const applicantKeys = useMemo(() => (picker?.status === "ready" ? picker.data.filter((a) => !a.onRoll).map((a) => a.leadId) : []), [picker]);
  const pick = useRowSelection(applicantKeys);

  async function openPicker() {
    setPicker({ status: "loading" });
    const r = await getJson<{ applicants: Applicant[] }>(`${API}?view=eligible&id=${encodeURIComponent(session.id)}`);
    if (!r.ok) setPicker({ status: "error", message: r.error });
    else setPicker({ status: "ready", data: r.data.applicants });
  }

  async function addTicked(keys: string[]) {
    setBusy(true);
    const r = await postJson<{ added: EntranceCandidate[]; skipped: { leadId: string; reason: string }[] }>(API, {
      action: "add_candidates",
      sessionId: session.id,
      leadIds: keys,
    });
    setBusy(false);
    if (!r.ok) {
      toastError(r.error);
      return;
    }
    const { added, skipped } = r.data;
    pushToast({
      kind: skipped.length ? "info" : "success",
      message: `${added.length} added to the roll${skipped.length ? ` · ${skipped.length} skipped (${[...new Set(skipped.map((s) => s.reason))].join(", ")})` : ""}`,
    });
    pick.clear();
    setPicker(null);
    onChanged();
  }

  async function remove(c: EntranceCandidate) {
    const r = await postJson(API, { action: "remove_candidate", id: c.id, updatedAt: c.updatedAt });
    if (!r.ok) {
      toastError(r.error);
      return;
    }
    toastOk(`${c.childName} removed from the roll`);
    onChanged();
  }

  const rollColumns: ReportColumn[] = [
    { key: "roll", header: "Roll no", width: 0.7 },
    { key: "child", header: "Applicant", width: 2 },
    { key: "cls", header: "Class", width: 1 },
    { key: "guardian", header: "Parent / guardian", width: 1.8 },
    { key: "app", header: "Application / enquiry no", width: 1.4 },
  ];
  const rollRows = (): ExportRow[] =>
    roll.map((c) => ({
      roll: c.rollNo,
      child: c.childName,
      cls: className(c.classId),
      guardian: c.guardianName,
      app: c.applicationNo || c.enquiryNo,
    }));
  const subtitle = `${formatTestDate(session.testDate, "en")}${session.startTime ? ` · ${formatTestTime(session.startTime, "en")}` : ""}${session.venue ? ` · ${session.venue}` : ""}`;

  async function attendanceSheet() {
    if (roll.length === 0) {
      toastError("Nobody is on the roll yet");
      return;
    }
    try {
      await downloadPdfReport({
        title: `${session.name} — attendance sheet`,
        subtitle,
        columns: [
          { key: "roll", header: "Roll no", width: 0.6 },
          { key: "child", header: "Applicant", width: 2 },
          { key: "cls", header: "Class", width: 0.9 },
          { key: "app", header: "Application no", width: 1.1 },
          { key: "present", header: "Present / Absent", width: 1 },
          { key: "sign", header: "Applicant's signature", width: 1.8 },
        ],
        rows: roll.map((c) => ({ roll: c.rollNo, child: c.childName, cls: className(c.classId), app: c.applicationNo || c.enquiryNo, present: "", sign: "" })),
        fileBaseName: "entrance_attendance_sheet",
      });
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Could not make the PDF");
    }
  }

  const applicants = picker?.status === "ready" ? picker.data : [];
  const shownApplicants = applicants.filter((a) => {
    const t = q.trim().toLowerCase();
    if (!t) return true;
    return [a.childName, a.guardianName, a.mobile, a.applicationNo, a.enquiryNo].some((x) => x.toLowerCase().includes(t));
  });
  const shownKeys = shownApplicants.filter((a) => !a.onRoll).map((a) => a.leadId);

  return (
    <div className="space-y-4">
      <ErpMetricGrid>
        <ErpMetricCard title="On the roll" value={roll.length} tone="navy" icon={<ClipboardList className="size-4" />} />
        <ErpMetricCard title="Classes" value={session.classIds.map((id) => className(id) || id).join(", ") || "—"} tone="sky" />
        <ErpMetricCard title="Date" value={formatTestDate(session.testDate, "en")} tone="violet" hint={session.startTime ? formatTestTime(session.startTime, "en") : "time not set"} />
        <ErpMetricCard title="Venue" value={session.venue || "not set"} tone="amber" />
      </ErpMetricGrid>

      <ErpControlBar
        summary={<span className="text-xs text-[var(--muted)]">{session.name}</span>}
        actions={
          <>
            {canCreate ? (
              <button type="button" className={erpBtn} onClick={() => void openPicker()}>
                <Plus className="size-4" /> Add applicants
              </button>
            ) : null}
            <button type="button" className={erpBtnOutline} onClick={() => void attendanceSheet()}>
              <FileText className="size-4" /> Attendance sheet (PDF)
            </button>
          </>
        }
        exportMenu={<ExportMenu title={`${session.name} — roll list`} subtitle={subtitle} columns={rollColumns} rows={rollRows} fileBaseName="entrance_roll_list" onMessage={(m) => pushToast({ kind: "info", message: m })} />}
      />

      {picker ? (
        <ErpPanel title="Add applicants" description={`Open, registered and verified enquiries for ${session.classIds.map((id) => className(id) || id).join(", ")} in ${session.academicYearCode}, read from the CRM. Tick and add — roll numbers follow on from the last one.`}>
          {picker.status === "loading" ? <p className="text-sm text-[var(--muted)]">Loading applicants…</p> : null}
          {picker.status === "error" ? <p className="text-sm text-[var(--danger)]">Could not load applicants: {picker.message}</p> : null}
          {picker.status === "ready" ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <input className={cn(erpField, "max-w-sm")} placeholder="Search name, mobile, number…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search applicants" />
                <span className="text-xs text-[var(--muted)]">{applicants.filter((a) => !a.onRoll).length} not on the roll · {applicants.filter((a) => a.onRoll).length} already on it</span>
                <button type="button" className={erpBtn} disabled={busy || pick.count === 0} onClick={() => void addTicked([...pick.selected])}>
                  {busy ? "Adding…" : `Add ${pick.count} to the roll`}
                </button>
                <button type="button" className={erpBtnOutline} onClick={() => { pick.clear(); setPicker(null); }}>
                  Close
                </button>
              </div>
              <ErpTableShell>
                <div className="max-h-[50vh] overflow-auto">
                  <ErpTable minWidth="min-w-[760px]">
                    <ErpTableHead sticky>
                      <tr>
                        <th className="w-10 px-3 py-2">
                          <RowCheckbox checked={pick.allSelected(shownKeys)} indeterminate={pick.someSelected(shownKeys)} onChange={() => pick.toggleAll(shownKeys)} label="Tick all shown" />
                        </th>
                        <th className="px-3 py-2">Applicant</th>
                        <th className="px-3 py-2">Class</th>
                        <th className="px-3 py-2">Stage</th>
                        <th className="px-3 py-2">Parent</th>
                        <th className="px-3 py-2">Number</th>
                        <th className="px-3 py-2 text-right">Actions</th>
                      </tr>
                    </ErpTableHead>
                    <ErpTableBody>
                      {shownApplicants.length === 0 ? (
                        <tr><td colSpan={7} className="px-3 py-6 text-center text-sm text-[var(--muted)]">No applicants match.</td></tr>
                      ) : null}
                      {shownApplicants.map((a) => (
                        <tr key={a.leadId} className={a.onRoll ? "opacity-60" : ""}>
                          <td className="px-3 py-2">
                            {a.onRoll ? null : <RowCheckbox checked={pick.isSelected(a.leadId)} onChange={() => pick.toggle(a.leadId)} label={`Tick ${a.childName}`} />}
                          </td>
                          <td className="px-3 py-2 font-medium">{a.childName}{a.onRoll ? <span className="ml-2 text-[11px] text-[var(--muted)]">on the roll</span> : null}</td>
                          <td className="px-3 py-2">{className(a.classId)}</td>
                          <td className="px-3 py-2">{STAGE_LABEL[a.stage] || a.stage}</td>
                          <td className="px-3 py-2">{a.guardianName}</td>
                          <td className="px-3 py-2 text-xs">{a.applicationNo || a.enquiryNo}</td>
                          <td className="px-3 py-2 text-right">
                            <RowActionMenu row={a} actions={[{ id: "open", label: "Open in CRM", onSelect: (r) => onOpenLead(r.leadId) }]} />
                          </td>
                        </tr>
                      ))}
                    </ErpTableBody>
                  </ErpTable>
                </div>
              </ErpTableShell>
            </div>
          ) : null}
        </ErpPanel>
      ) : null}

      <ErpTableShell>
        <div className="overflow-x-auto">
          <ErpTable minWidth="min-w-[760px]">
            <ErpTableHead>
              <tr>
                <th className="px-3 py-2">Roll no</th>
                <th className="px-3 py-2">Applicant</th>
                <th className="px-3 py-2">Class</th>
                <th className="px-3 py-2">Parent / guardian</th>
                <th className="px-3 py-2">Application no</th>
                <th className="px-3 py-2">Invited</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </ErpTableHead>
            <ErpTableBody hoverable>
              {roll.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-sm text-[var(--muted)]">Nobody on the roll yet.{canCreate ? " Click Add applicants." : ""}</td></tr>
              ) : null}
              {roll.map((c) => (
                <tr key={c.id}>
                  <td className="px-3 py-2 font-mono font-semibold">{c.rollNo}</td>
                  <td className="px-3 py-2 font-medium">{c.childName}</td>
                  <td className="px-3 py-2">{className(c.classId)}</td>
                  <td className="px-3 py-2">{c.guardianName}</td>
                  <td className="px-3 py-2 text-xs">{c.applicationNo || c.enquiryNo}</td>
                  <td className="px-3 py-2 text-xs">{c.inviteSentAt ? c.inviteSentAt.slice(0, 10) : <span className="text-[var(--muted)]">no</span>}</td>
                  <td className="px-3 py-2 text-right">
                    <RowActionMenu
                      row={c}
                      actions={[
                        { id: "open", label: "Open in CRM", onSelect: (r) => onOpenLead(r.leadId) },
                        { id: "remove", label: "Remove from roll", tone: "danger", separatorAbove: true, hidden: () => !canDelete, onSelect: (r) => setConfirmRemove(r) },
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </ErpTableBody>
          </ErpTable>
        </div>
      </ErpTableShell>

      <ConfirmDialog
        open={!!confirmRemove}
        onOpenChange={(o) => !o && setConfirmRemove(null)}
        title={`Remove ${confirmRemove?.childName ?? ""} from the roll?`}
        description="Their marks and result on this test go with them. The lead in the CRM is not touched. The roll number is not reused."
        confirmLabel="Remove"
        onConfirm={async () => {
          if (confirmRemove) await remove(confirmRemove);
          setConfirmRemove(null);
        }}
      />
      <BulkActionBar
        selection={pick}
        noun="applicant"
        actions={[{ id: "add", label: busy ? "Adding…" : "Add to the roll", disabled: busy || !canCreate, onRun: (keys) => addTicked(keys) }]}
      />
    </div>
  );
}

/* ─── Step 3: marks ─────────────────────────────────────────────── */

type Draft = { marks: Record<string, string>; absent: boolean };

function draftOf(c: EntranceCandidate, subjects: EntranceSubject[]): Draft {
  const marks: Record<string, string> = {};
  for (const s of subjects) marks[s.id] = typeof c.marks[s.id] === "number" ? String(c.marks[s.id]) : "";
  return { marks, absent: c.absent };
}

function sameDraft(a: Draft, b: Draft): boolean {
  if (a.absent !== b.absent) return false;
  return Object.keys({ ...a.marks, ...b.marks }).every((k) => (a.marks[k] ?? "").trim() === (b.marks[k] ?? "").trim());
}

function MarksStep({
  bundle,
  className,
  canEdit,
  onSaved,
  onReload,
}: {
  bundle: Bundle;
  className: (id: string) => string;
  canEdit: boolean;
  onSaved: (saved: EntranceCandidate[]) => void;
  onReload: () => void;
}) {
  const { session } = bundle;
  const roll = useMemo(() => [...bundle.candidates].sort((a, b) => rollCompare(a.rollNo, b.rollNo)), [bundle.candidates]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);

  const draftFor = (c: EntranceCandidate) => drafts[c.id] ?? draftOf(c, session.subjects);
  const dirtyIds = roll.filter((c) => drafts[c.id] && !sameDraft(drafts[c.id]!, draftOf(c, session.subjects))).map((c) => c.id);
  const errors = new Set<string>();
  for (const c of roll) {
    const d = draftFor(c);
    for (const s of session.subjects) {
      if (!parseMarkInput(d.marks[s.id] ?? "", s.maxMarks).ok) errors.add(`${c.id}:${s.id}`);
    }
  }

  function setMark(c: EntranceCandidate, sid: string, v: string) {
    setDrafts((prev) => {
      const d = prev[c.id] ?? draftOf(c, session.subjects);
      return { ...prev, [c.id]: { ...d, marks: { ...d.marks, [sid]: v } } };
    });
  }
  function setAbsent(c: EntranceCandidate, absent: boolean) {
    setDrafts((prev) => {
      const d = prev[c.id] ?? draftOf(c, session.subjects);
      return { ...prev, [c.id]: { ...d, absent } };
    });
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>, row: number, col: number) {
    let r = row;
    let k = col;
    if (e.key === "Enter" || e.key === "ArrowDown") r = row + 1;
    else if (e.key === "ArrowUp") r = row - 1;
    else if (e.key === "ArrowRight" && e.currentTarget.selectionStart === e.currentTarget.value.length) k = col + 1;
    else if (e.key === "ArrowLeft" && e.currentTarget.selectionStart === 0) k = col - 1;
    else return;
    const next = gridRef.current?.querySelector<HTMLInputElement>(`input[data-r="${r}"][data-c="${k}"]`);
    if (next) {
      e.preventDefault();
      next.focus();
      next.select();
    }
  }

  async function save() {
    if (errors.size > 0) {
      toastError("Fix the boxes in red first (a mark above the maximum, or not a number).");
      return;
    }
    const rows = roll
      .filter((c) => dirtyIds.includes(c.id))
      .map((c) => {
        const d = drafts[c.id]!;
        const marks: Record<string, number | null> = {};
        for (const s of session.subjects) {
          const p = parseMarkInput(d.marks[s.id] ?? "", s.maxMarks);
          marks[s.id] = p.ok ? p.value : null;
        }
        return { id: c.id, marks, absent: d.absent, updatedAt: c.updatedAt };
      });
    if (rows.length === 0) return;
    setBusy(true);
    const r = await postJson<{
      saved: EntranceCandidate[];
      conflicts: { id: string; childName: string }[];
      errors: { id: string; childName: string; error: string }[];
    }>(API, { action: "save_marks", sessionId: session.id, rows });
    setBusy(false);
    if (!r.ok && !r.data?.saved) {
      toastError(r.error);
      return;
    }
    const data = r.data!;
    onSaved(data.saved);
    setDrafts((prev) => {
      const next = { ...prev };
      for (const s of data.saved) delete next[s.id];
      return next;
    });
    if (data.conflicts.length || data.errors.length) {
      toastError(
        [
          data.saved.length ? `${data.saved.length} saved.` : "",
          data.conflicts.length ? `${data.conflicts.length} changed on another screen (${data.conflicts.map((x) => x.childName).slice(0, 3).join(", ")}) — not saved; Reload, then re-enter.` : "",
          data.errors.length ? `${data.errors.length} refused: ${data.errors[0]!.error}` : "",
        ].filter(Boolean).join(" "),
      );
    } else {
      toastOk(`${data.saved.length} saved`);
    }
  }

  if (session.subjects.length === 0) {
    return <p className="text-sm text-[var(--muted)]">This test has no subjects — add them in step 1.</p>;
  }

  return (
    <div className="space-y-3">
      <ErpControlBar
        summary={
          <span className="text-xs text-[var(--muted)]">
            {dirtyIds.length ? `${dirtyIds.length} row${dirtyIds.length === 1 ? "" : "s"} changed — not saved yet` : "All saved"}
            {errors.size ? ` · ${errors.size} box${errors.size === 1 ? "" : "es"} to fix` : ""}
          </span>
        }
        actions={
          <>
            <button type="button" className={erpBtnOutline} disabled={busy} onClick={() => { setDrafts({}); onReload(); }}>
              <RefreshCw className="size-4" /> Reload
            </button>
            {canEdit ? (
              <button type="button" className={erpBtn} disabled={busy || dirtyIds.length === 0 || errors.size > 0} onClick={() => void save()}>
                {busy ? "Saving…" : `Save marks${dirtyIds.length ? ` (${dirtyIds.length})` : ""}`}
              </button>
            ) : null}
          </>
        }
      />
      <ErpTableShell density="compact">
        <div className="overflow-x-auto" ref={gridRef}>
          <ErpTable minWidth="min-w-[720px]">
            <ErpTableHead sticky>
              <tr>
                <th className="px-3 py-2">Roll</th>
                <th className="px-3 py-2">Applicant</th>
                <th className="px-3 py-2">Class</th>
                {session.subjects.map((s) => (
                  <th key={s.id} className="px-2 py-2 text-center">{s.name}<span className="block font-normal normal-case">/ {s.maxMarks}</span></th>
                ))}
                <th className="px-2 py-2 text-center">Absent</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </ErpTableHead>
            <ErpTableBody zebra>
              {roll.length === 0 ? (
                <tr><td colSpan={session.subjects.length + 6} className="px-3 py-8 text-center text-sm text-[var(--muted)]">Nobody on the roll yet — add applicants in step 2.</td></tr>
              ) : null}
              {roll.map((c, ri) => {
                const d = draftFor(c);
                const marks: Record<string, number> = {};
                for (const s of session.subjects) {
                  const p = parseMarkInput(d.marks[s.id] ?? "", s.maxMarks);
                  if (p.ok && p.value !== null) marks[s.id] = p.value;
                }
                const score = candidateScore(session, { marks, absent: d.absent });
                const dirty = dirtyIds.includes(c.id);
                return (
                  <tr key={c.id} className={dirty ? "bg-[var(--warning-soft)]" : ""}>
                    <td className="px-3 py-1.5 font-mono font-semibold">{c.rollNo}</td>
                    <td className="px-3 py-1.5 font-medium">{c.childName}</td>
                    <td className="px-3 py-1.5 text-xs">{className(c.classId)}</td>
                    {session.subjects.map((s, si) => {
                      const bad = errors.has(`${c.id}:${s.id}`);
                      return (
                        <td key={s.id} className="px-2 py-1.5 text-center">
                          <input
                            data-r={ri}
                            data-c={si}
                            inputMode="decimal"
                            disabled={!canEdit || d.absent}
                            value={d.marks[s.id] ?? ""}
                            onChange={(e) => setMark(c, s.id, e.target.value)}
                            onKeyDown={(e) => onKey(e, ri, si)}
                            onFocus={(e) => e.currentTarget.select()}
                            aria-label={`${s.name} marks for ${c.childName}`}
                            aria-invalid={bad}
                            title={bad ? `Must be a number from 0 to ${s.maxMarks}` : undefined}
                            className={cn(erpField, "h-8 w-16 text-center tabular-nums", bad && "border-[var(--danger)] text-[var(--danger)]")}
                          />
                        </td>
                      );
                    })}
                    <td className="px-2 py-1.5 text-center">
                      <input
                        type="checkbox"
                        className="size-4 accent-[var(--brand-deep)]"
                        disabled={!canEdit}
                        checked={d.absent}
                        onChange={(e) => setAbsent(c, e.target.checked)}
                        aria-label={`${c.childName} absent`}
                      />
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {d.absent ? (
                        <span className="text-[var(--muted)]">Absent</span>
                      ) : score.complete ? (
                        <span className="font-semibold">{score.total} / {score.max} <span className="text-xs font-normal text-[var(--muted)]">({score.percent}%)</span></span>
                      ) : (
                        <span className="text-xs text-[var(--muted)]">{score.entered} so far · {score.missing.length} blank</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <RowActionMenu
                        row={c}
                        actions={[
                          {
                            id: "clear",
                            label: "Clear this row's marks",
                            hidden: () => !canEdit,
                            onSelect: (r) =>
                              setDrafts((prev) => ({
                                ...prev,
                                [r.id]: { absent: false, marks: Object.fromEntries(session.subjects.map((s) => [s.id, ""])) },
                              })),
                          },
                          {
                            id: "undo",
                            label: "Undo unsaved changes",
                            hidden: (r) => !drafts[r.id],
                            onSelect: (r) =>
                              setDrafts((prev) => {
                                const next = { ...prev };
                                delete next[r.id];
                                return next;
                              }),
                          },
                        ]}
                      />
                    </td>
                  </tr>
                );
              })}
            </ErpTableBody>
          </ErpTable>
        </div>
      </ErpTableShell>
      <p className="text-xs text-[var(--muted)]">
        Enter or ↓ moves down the subject, ↑ moves up, ← → move across at the edge of a box. A blank box is “not entered”, never zero — a child with a blank has no total and no result until it is filled.
      </p>
    </div>
  );
}

/* ─── Step 4: results ───────────────────────────────────────────── */

function ResultsStep({
  bundle,
  className,
  canEdit,
  onOpenLead,
  onSaved,
}: {
  bundle: Bundle;
  className: (id: string) => string;
  canEdit: boolean;
  onOpenLead: (id: string) => void;
  onSaved: (saved: EntranceCandidate[]) => void;
}) {
  const { session, candidates } = bundle;
  const [classFilter, setClassFilter] = useState("");
  const ranked = useMemo(
    () => rankCandidates(session, candidates).filter((c) => !classFilter || c.classId === classFilter),
    [session, candidates, classFilter],
  );
  const keys = useMemo(() => ranked.map((c) => c.id), [ranked]);
  const sel = useRowSelection(useMemo(() => candidates.map((c) => c.id), [candidates]));
  const [busy, setBusy] = useState(false);

  const counts = useMemo(() => {
    const k = { selected: 0, waitlisted: 0, not_selected: 0, absent: 0, undecided: 0 };
    for (const c of candidates) {
      if (c.resultStatus === "") k.undecided++;
      else k[c.resultStatus]++;
    }
    return k;
  }, [candidates]);

  async function applyRule(ids: string[] | null, includeManual = false) {
    setBusy(true);
    const r = await postJson<{ saved: EntranceCandidate[]; skippedIncomplete: number; skippedManual: number }>(API, {
      action: "apply_pass_mark",
      sessionId: session.id,
      candidateIds: ids,
      includeManual,
    });
    setBusy(false);
    if (!r.ok) {
      toastError(r.error);
      return;
    }
    onSaved(r.data.saved);
    const bits = [`${r.data.saved.length} result${r.data.saved.length === 1 ? "" : "s"} set by the pass mark`];
    if (r.data.skippedIncomplete) bits.push(`${r.data.skippedIncomplete} skipped — marks incomplete`);
    if (r.data.skippedManual) bits.push(`${r.data.skippedManual} kept — decided by hand`);
    pushToast({ kind: "info", message: bits.join(" · ") });
  }

  async function setStatus(ids: string[], status: EntranceResultStatus) {
    if (ids.length === 0) return;
    setBusy(true);
    const r = await postJson<{ saved: EntranceCandidate[] }>(API, {
      action: "set_status",
      sessionId: session.id,
      candidateIds: ids,
      status,
    });
    setBusy(false);
    if (!r.ok) {
      toastError(r.error);
      return;
    }
    onSaved(r.data.saved);
    toastOk(`${r.data.saved.length} marked ${entranceStatusLabel(status)}`);
    sel.clear();
  }

  const exportRows = (): ExportRow[] =>
    ranked.map((c, i) => {
      const sc = candidateScore(session, c);
      const row: ExportRow = {
        rank: sc.percent === null ? "" : i + 1,
        roll: c.rollNo,
        child: c.childName,
        cls: className(c.classId),
        total: c.absent ? "Absent" : sc.total === null ? "" : `${sc.total} / ${sc.max}`,
        pct: sc.percent ?? "",
        result: entranceStatusLabel(c.resultStatus),
      };
      for (const s of session.subjects) row[`s_${s.id}`] = c.marks[s.id] ?? "";
      return row;
    });
  const exportCols: ReportColumn[] = [
    { key: "rank", header: "Rank", width: 0.5 },
    { key: "roll", header: "Roll", width: 0.6 },
    { key: "child", header: "Applicant", width: 1.8 },
    { key: "cls", header: "Class", width: 0.9 },
    ...session.subjects.map((s) => ({ key: `s_${s.id}`, header: `${s.name} /${s.maxMarks}`, width: 0.8, align: "right" as const })),
    { key: "total", header: "Total", width: 0.9, align: "right" },
    { key: "pct", header: "%", width: 0.6, align: "right" },
    { key: "result", header: "Result", width: 1 },
  ];

  return (
    <div className="space-y-4">
      <ErpMetricGrid className="xl:grid-cols-5">
        <ErpMetricCard title="Selected" value={counts.selected} tone="green" />
        <ErpMetricCard title="Waitlisted" value={counts.waitlisted} tone="amber" />
        <ErpMetricCard title="Not selected" value={counts.not_selected} tone="rose" />
        <ErpMetricCard title="Absent" value={counts.absent} tone="violet" />
        <ErpMetricCard title="Not decided" value={counts.undecided} tone="sky" hint={`Pass mark ${session.passPercent}%${session.waitlistPercent !== null ? ` · waitlist ${session.waitlistPercent}%` : ""}`} />
      </ErpMetricGrid>

      <ErpControlBar
        filters={
          <select className={cn(erpField, "w-auto")} value={classFilter} onChange={(e) => setClassFilter(e.target.value)} aria-label="Filter by class">
            <option value="">All classes</option>
            {session.classIds.map((id) => (
              <option key={id} value={id}>{className(id) || id}</option>
            ))}
          </select>
        }
        actions={
          canEdit ? (
            <button type="button" className={erpBtn} disabled={busy} onClick={() => void applyRule(null)} title="Sets every child with complete marks (and every absentee) by the pass mark. Children you decided by hand keep your decision.">
              Apply pass mark to all
            </button>
          ) : null
        }
        exportMenu={<ExportMenu title={`${session.name} — results`} subtitle={formatTestDate(session.testDate, "en")} columns={exportCols} rows={exportRows} fileBaseName="entrance_results" onMessage={(m) => pushToast({ kind: "info", message: m })} />}
      />

      <ErpTableShell>
        <div className="overflow-x-auto">
          <ErpTable minWidth="min-w-[820px]">
            <ErpTableHead>
              <tr>
                <th className="w-10 px-3 py-2">
                  <RowCheckbox checked={sel.allSelected(keys)} indeterminate={sel.someSelected(keys)} onChange={() => sel.toggleAll(keys)} label="Tick all shown" />
                </th>
                <th className="px-3 py-2">Rank</th>
                <th className="px-3 py-2">Roll</th>
                <th className="px-3 py-2">Applicant</th>
                <th className="px-3 py-2">Class</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2 text-right">%</th>
                <th className="px-3 py-2">By pass mark</th>
                <th className="px-3 py-2">Result</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </ErpTableHead>
            <ErpTableBody hoverable>
              {ranked.length === 0 ? (
                <tr><td colSpan={10} className="px-3 py-8 text-center text-sm text-[var(--muted)]">Nobody on the roll{classFilter ? " in this class" : ""}.</td></tr>
              ) : null}
              {ranked.map((c, i) => {
                const sc = candidateScore(session, c);
                const sug = suggestedStatus(session, c);
                return (
                  <tr key={c.id}>
                    <td className="px-3 py-2"><RowCheckbox checked={sel.isSelected(c.id)} onChange={() => sel.toggle(c.id)} label={`Tick ${c.childName}`} /></td>
                    <td className="px-3 py-2 tabular-nums">{sc.percent === null ? "—" : i + 1}</td>
                    <td className="px-3 py-2 font-mono">{c.rollNo}</td>
                    <td className="px-3 py-2 font-medium">{c.childName}</td>
                    <td className="px-3 py-2 text-xs">{className(c.classId)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.absent ? "—" : sc.total === null ? <span className="text-xs text-[var(--muted)]">{sc.missing.length} blank</span> : `${sc.total} / ${sc.max}`}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{sc.percent ?? "—"}</td>
                    <td className="px-3 py-2 text-xs text-[var(--muted)]">{sug ? entranceStatusLabel(sug) : "marks incomplete"}</td>
                    <td className="px-3 py-2"><EntranceStatusChip status={c.resultStatus} manual={c.statusSource === "manual"} /></td>
                    <td className="px-3 py-2 text-right">
                      <RowActionMenu
                        row={c}
                        actions={[
                          ...ENTRANCE_RESULT_STATUSES.map((s) => ({
                            id: s.value,
                            label: `Mark ${s.label}`,
                            hidden: () => !canEdit,
                            onSelect: (r: EntranceCandidate) => void setStatus([r.id], s.value),
                          })),
                          { id: "rule", label: "Use the pass mark", hidden: () => !canEdit, onSelect: (r) => void applyRule([r.id], true) },
                          { id: "clear", label: "Clear result", hidden: () => !canEdit, onSelect: (r) => void setStatus([r.id], "") },
                          { id: "open", label: "Open in CRM", separatorAbove: true, onSelect: (r) => onOpenLead(r.leadId) },
                        ]}
                      />
                    </td>
                  </tr>
                );
              })}
            </ErpTableBody>
          </ErpTable>
        </div>
      </ErpTableShell>

      <BulkActionBar
        selection={sel}
        noun="child"
        actions={
          canEdit
            ? [
                { id: "rule", label: "Apply pass mark", disabled: busy, onRun: (k) => applyRule(k) },
                ...ENTRANCE_RESULT_STATUSES.map((s) => ({ id: s.value, label: s.label, disabled: busy, onRun: (k: string[]) => setStatus(k, s.value) })),
                { id: "clear", label: "Clear result", disabled: busy, onRun: (k) => setStatus(k, "") },
              ]
            : []
        }
      />
    </div>
  );
}

/* ─── Step 5: notify ────────────────────────────────────────────── */

type PlanRow = {
  candidateId: string;
  rollNo: string;
  childName: string;
  mobileTail: string;
  language: "en" | "hi";
  text: string;
  skipReason: string;
};
type Plan = {
  kind: EntranceNotifyKind;
  familyKey: string;
  templateReady: boolean;
  templateNote: string;
  rows: PlanRow[];
  sendable: number;
};

function NotifyStep({
  bundle,
  className,
  canEdit,
  onSent,
}: {
  bundle: Bundle;
  className: (id: string) => string;
  canEdit: boolean;
  onSent: () => void;
}) {
  const { session, candidates } = bundle;
  const [kind, setKind] = useState<EntranceNotifyKind>("invite");
  const [resend, setResend] = useState(false);
  const [plan, setPlan] = useState<Load<Plan> | null>(null);
  const [confirm, setConfirm] = useState(false);
  const roll = useMemo(() => [...candidates].sort((a, b) => rollCompare(a.rollNo, b.rollNo)), [candidates]);
  const keys = useMemo(() => roll.map((c) => c.id), [roll]);
  const sel = useRowSelection(keys);

  // A changed choice invalidates the preview: what was approved must be what is sent.
  useEffect(() => {
    setPlan(null);
  }, [kind, resend, sel.selected]);

  async function preview() {
    setPlan({ status: "loading" });
    const r = await postJson<{ plan: Plan }>(`${API}/notify`, {
      sessionId: session.id,
      kind,
      candidateIds: [...sel.selected],
      resend,
      dryRun: true,
    });
    if (!r.ok) setPlan({ status: "error", message: r.error });
    else setPlan({ status: "ready", data: r.data.plan });
  }

  async function send(count: number) {
    const r = await postJson<{ sent: number; deferred: number; failed: number; errors: string[]; error?: string }>(`${API}/notify`, {
      sessionId: session.id,
      kind,
      candidateIds: [...sel.selected],
      resend,
      confirmCount: count,
    });
    if (!r.ok) {
      toastError(r.error);
      return;
    }
    const d = r.data;
    pushToast({
      kind: d.failed ? "error" : "success",
      message: `${d.sent} sent${d.deferred ? ` · ${d.deferred} held for the family's quiet hours — send again later` : ""}${d.failed ? ` · ${d.failed} failed${d.errors[0] ? `: ${d.errors[0]}` : ""}` : ""}`,
      durationMs: d.failed ? 0 : undefined,
    });
    setPlan(null);
    sel.clear();
    onSent();
  }

  const ready = plan?.status === "ready" ? plan.data : null;

  return (
    <div className="space-y-4">
      <ErpPanel
        title="Message families on WhatsApp"
        description="Pick what to send, tick the children, then Preview. Each family gets the school's approved template in its own language — Hindi unless the family chose English. Nothing is sent from a preview."
      >
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-1.5 text-sm">
            <input type="radio" name="entrance-notify-kind" className="accent-[var(--brand-deep)]" checked={kind === "invite"} onChange={() => setKind("invite")} />
            Test invitation (date, time, venue, roll no)
          </label>
          <label className="inline-flex items-center gap-1.5 text-sm">
            <input type="radio" name="entrance-notify-kind" className="accent-[var(--brand-deep)]" checked={kind === "result"} onChange={() => setKind("result")} />
            Result
          </label>
          <label className="inline-flex items-center gap-1.5 text-xs text-[var(--muted)]">
            <input type="checkbox" className="accent-[var(--brand-deep)]" checked={resend} onChange={(e) => setResend(e.target.checked)} />
            Include families already messaged
          </label>
          <button type="button" className={erpBtn} disabled={sel.count === 0 || plan?.status === "loading"} onClick={() => void preview()}>
            {plan?.status === "loading" ? "Preparing…" : `Preview ${sel.count || ""} message${sel.count === 1 ? "" : "s"}`}
          </button>
        </div>
      </ErpPanel>

      {plan?.status === "error" ? <p className="rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] px-3 py-3 text-sm text-[var(--danger)]">{plan.message}</p> : null}

      {ready ? (
        <ErpPanel title={`Preview — ${ready.sendable} of ${ready.rows.length} can be sent`}>
          {!ready.templateReady ? (
            <p className="mb-3 rounded-lg border border-[var(--warning)] bg-[var(--warning-soft)] px-3 py-2 text-sm text-[var(--warning)]">
              {ready.templateNote || "The template is not approved yet."} The text below is what families will read once it is approved.
            </p>
          ) : null}
          <div className="max-h-[50vh] space-y-2 overflow-auto">
            {ready.rows.map((r) => (
              <div key={r.candidateId} className={cn("rounded-lg border border-[var(--border)] p-3", r.skipReason && "opacity-60")}>
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-mono font-semibold">{r.rollNo}</span>
                  <span className="font-semibold">{r.childName}</span>
                  <span className="text-[var(--muted)]">{r.mobileTail ? `…${r.mobileTail}` : "no number"} · {r.language === "hi" ? "Hindi" : "English"}</span>
                  {r.skipReason ? <span className="rounded bg-[var(--danger-soft)] px-1.5 py-0.5 font-semibold text-[var(--danger)]">Not sent: {r.skipReason}</span> : null}
                </div>
                <pre className="whitespace-pre-wrap font-sans text-[13px] text-[var(--foreground)]">{r.text}</pre>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={erpBtn}
              disabled={!canEdit || !ready.templateReady || ready.sendable === 0}
              title={!ready.templateReady ? "Waiting for WhatsApp to approve the template" : !canEdit ? "Your role cannot send" : undefined}
              onClick={() => setConfirm(true)}
            >
              <Send className="size-4" /> Send {ready.sendable} message{ready.sendable === 1 ? "" : "s"}
            </button>
          </div>
        </ErpPanel>
      ) : null}

      <ErpTableShell>
        <div className="overflow-x-auto">
          <ErpTable minWidth="min-w-[720px]">
            <ErpTableHead>
              <tr>
                <th className="w-10 px-3 py-2">
                  <RowCheckbox checked={sel.allSelected(keys)} indeterminate={sel.someSelected(keys)} onChange={() => sel.toggleAll(keys)} label="Tick all" />
                </th>
                <th className="px-3 py-2">Roll</th>
                <th className="px-3 py-2">Applicant</th>
                <th className="px-3 py-2">Class</th>
                <th className="px-3 py-2">Result</th>
                <th className="px-3 py-2">Invitation sent</th>
                <th className="px-3 py-2">Result sent</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </ErpTableHead>
            <ErpTableBody hoverable>
              {roll.length === 0 ? (
                <tr><td colSpan={8} className="px-3 py-8 text-center text-sm text-[var(--muted)]">Nobody on the roll yet.</td></tr>
              ) : null}
              {roll.map((c) => (
                <tr key={c.id}>
                  <td className="px-3 py-2"><RowCheckbox checked={sel.isSelected(c.id)} onChange={() => sel.toggle(c.id)} label={`Tick ${c.childName}`} /></td>
                  <td className="px-3 py-2 font-mono">{c.rollNo}</td>
                  <td className="px-3 py-2 font-medium">{c.childName}</td>
                  <td className="px-3 py-2 text-xs">{className(c.classId)}</td>
                  <td className="px-3 py-2"><EntranceStatusChip status={c.resultStatus} /></td>
                  <td className="px-3 py-2 text-xs">{c.inviteSentAt ? c.inviteSentAt.slice(0, 10) : "—"}</td>
                  <td className="px-3 py-2 text-xs">{c.resultSentAt ? c.resultSentAt.slice(0, 10) : "—"}</td>
                  <td className="px-3 py-2 text-right">
                    <RowActionMenu
                      row={c}
                      actions={[
                        { id: "only", label: "Tick only this family", onSelect: (r) => { sel.clear(); sel.toggle(r.id); } },
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </ErpTableBody>
          </ErpTable>
        </div>
      </ErpTableShell>

      <BulkActionBar
        selection={sel}
        noun="family"
        actions={[
          { id: "decided", label: "Keep only decided results", onRun: () => sel.setMany(roll.filter((c) => !c.resultStatus).map((c) => c.id), false) },
        ]}
      />

      <ConfirmDialog
        open={confirm && !!ready}
        onOpenChange={(o) => !o && setConfirm(false)}
        tone="default"
        title={`Send ${ready?.sendable ?? 0} WhatsApp message${ready?.sendable === 1 ? "" : "s"}?`}
        description={`${kind === "invite" ? "Test invitation" : "Result"} to ${ready?.sendable ?? 0} families from the school's WhatsApp number, each in its own language. Families in their quiet hours are held and can be sent again later.`}
        confirmLabel="Send now"
        onConfirm={async () => {
          if (ready) await send(ready.sendable);
          setConfirm(false);
        }}
      />
    </div>
  );
}

/* ─── Step 6: summary ───────────────────────────────────────────── */

function SummaryStep({ academicYearCode, className }: { academicYearCode: string; className: (id: string) => string }) {
  const [data, setData] = useState<Load<{ sessions: EntranceSession[]; candidates: EntranceCandidate[] }>>({ status: "loading" });

  const load = useCallback(async () => {
    setData({ status: "loading" });
    const r = await getJson<{ sessions: EntranceSession[]; candidates: EntranceCandidate[] }>(
      `${API}?view=summary&academicYearCode=${encodeURIComponent(academicYearCode)}`,
    );
    if (!r.ok) setData({ status: "error", message: r.error });
    else setData({ status: "ready", data: { sessions: r.data.sessions, candidates: r.data.candidates } });
  }, [academicYearCode]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(
    () => (data.status === "ready" ? classSummary(data.data.sessions, data.data.candidates, className) : []),
    [data, className],
  );
  const total = rows.reduce(
    (t, r) => ({
      onRoll: t.onRoll + r.onRoll,
      appeared: t.appeared + r.appeared,
      selected: t.selected + r.selected,
      waitlisted: t.waitlisted + r.waitlisted,
    }),
    { onRoll: 0, appeared: 0, selected: 0, waitlisted: 0 },
  );

  const cols: ReportColumn[] = [
    { key: "cls", header: "Class", width: 1.2 },
    { key: "onRoll", header: "On roll", align: "right" },
    { key: "appeared", header: "Appeared", align: "right" },
    { key: "absent", header: "Absent", align: "right" },
    { key: "selected", header: "Selected", align: "right" },
    { key: "waitlisted", header: "Waitlisted", align: "right" },
    { key: "notSelected", header: "Not selected", align: "right" },
    { key: "undecided", header: "Not decided", align: "right" },
    { key: "top", header: "Top %", align: "right" },
    { key: "avg", header: "Average %", align: "right" },
  ];
  const exportRows = (): ExportRow[] =>
    rows.map((r) => ({
      cls: r.className,
      onRoll: r.onRoll,
      appeared: r.appeared,
      absent: r.absent,
      selected: r.selected,
      waitlisted: r.waitlisted,
      notSelected: r.notSelected,
      undecided: r.undecided,
      top: r.topPercent ?? "",
      avg: r.averagePercent ?? "",
    }));

  return (
    <div className="space-y-4">
      <ErpMetricGrid>
        <ErpMetricCard title="On the roll" value={total.onRoll} tone="navy" hint={`all tests in ${academicYearCode}`} />
        <ErpMetricCard title="Appeared" value={total.appeared} tone="sky" />
        <ErpMetricCard title="Selected" value={total.selected} tone="green" />
        <ErpMetricCard title="Waitlisted" value={total.waitlisted} tone="amber" />
      </ErpMetricGrid>
      <ErpControlBar
        summary={<span className="text-xs text-[var(--muted)]">{data.status === "ready" ? `${data.data.sessions.length} test${data.data.sessions.length === 1 ? "" : "s"} in ${academicYearCode}` : ""}</span>}
        actions={
          <button type="button" className={erpBtnOutline} onClick={() => void load()}>
            <RefreshCw className="size-4" /> Reload
          </button>
        }
        exportMenu={<ExportMenu title={`Entrance test summary — ${academicYearCode}`} columns={cols} rows={exportRows} fileBaseName="entrance_summary" onMessage={(m) => pushToast({ kind: "info", message: m })} />}
      />
      {data.status === "error" ? (
        <p className="rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] px-3 py-3 text-sm text-[var(--danger)]">Could not load the summary: {data.message}</p>
      ) : null}
      <ErpTableShell>
        <div className="overflow-x-auto">
          <ErpTable minWidth="min-w-[760px]">
            <ErpTableHead>
              <tr>
                {cols.map((c) => (
                  <th key={c.key} className={cn("px-3 py-2", c.align === "right" && "text-right")}>{c.header}</th>
                ))}
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </ErpTableHead>
            <ErpTableBody hoverable>
              {data.status === "loading" ? (
                <tr><td colSpan={cols.length + 1} className="px-3 py-8 text-center text-sm text-[var(--muted)]">Loading…</td></tr>
              ) : null}
              {data.status === "ready" && rows.length === 0 ? (
                <tr><td colSpan={cols.length + 1} className="px-3 py-8 text-center text-sm text-[var(--muted)]">Nobody has been put on an entrance test roll in {academicYearCode} yet.</td></tr>
              ) : null}
              {rows.map((r) => (
                <tr key={r.classId || "none"}>
                  <td className="px-3 py-2 font-semibold">{r.className}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.onRoll}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.appeared}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.absent}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-[var(--success)]">{r.selected}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-[var(--warning)]">{r.waitlisted}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.notSelected}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-[var(--muted)]">{r.undecided}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.topPercent ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.averagePercent ?? "—"}</td>
                  <td className="px-3 py-2 text-right">
                    <RowActionMenu
                      row={r}
                      actions={[
                        {
                          id: "copy",
                          label: "Copy this line",
                          onSelect: (x) => {
                            const line = `${x.className}: ${x.appeared} appeared, ${x.selected} selected, ${x.waitlisted} waitlisted`;
                            if (!navigator.clipboard) {
                              pushToast({ kind: "error", message: "This browser cannot copy here" });
                              return;
                            }
                            navigator.clipboard.writeText(line).then(
                              () => pushToast({ kind: "info", message: "Copied" }),
                              () => pushToast({ kind: "error", message: "Could not copy" }),
                            );
                          },
                        },
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </ErpTableBody>
          </ErpTable>
        </div>
      </ErpTableShell>
      <p className="text-xs text-[var(--muted)]">
        “Appeared” = on the roll and not marked absent. A child who appeared but has no result yet is counted under Not decided, never as Not selected.
      </p>
    </div>
  );
}
