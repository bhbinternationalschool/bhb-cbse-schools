"use client";

import { useEffect, useMemo, useState } from "react";
import { DoorOpen } from "lucide-react";
import { useDemoSession, useSessionReadOnly } from "@/components/shell/SessionContext";
import { ModuleTabs, type ModuleTabItem } from "@/components/ui/ModuleTabs";
import { ErpWorkspaceShell } from "@/components/ui/erp-workspace-shell";
import { field } from "@/components/ui/erp-ui";
import { DEFAULT_AY, loadMasters, type MastersState } from "@/lib/masters";
import { classSectionLabel } from "@/lib/timetable";
import { loadSis, type SisState, type SisStudent } from "@/lib/sis";
import { dutyStaffLabel, loadDutyRoster, type DutyRosterState } from "@/lib/dutyRoster";
import {
  checkInVisitor,
  checkOutVisitor,
  deleteGatePass,
  deleteVisitorEntry,
  emptyVisitorState,
  gatePassStatusLabel,
  loadVisitors,
  markGatePassPickedUp,
  notifyGatePassParent,
  onGateDutyNow,
  saveVisitors,
  upsertGatePass,
  visitorPurposeLabel,
  VISITOR_PURPOSES,
  type GatePass,
  type VisitorEntry,
  type VisitorPurpose,
  type VisitorState,
} from "@/lib/visitors";
import { VisitorPassSheet, printVisitorPass } from "@/components/visitors/VisitorPassSheet";
import { useModuleStateHydration } from "@/lib/useModuleStateHydration";

type Tab = "register" | "gatepasses" | "gateduty";

const TABS: ModuleTabItem[] = [
  { id: "register", label: "Visitor register", tone: "teal" },
  { id: "gatepasses", label: "Gate passes", tone: "amber" },
  { id: "gateduty", label: "Gate duty today", tone: "sky" },
];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function StudentPicker({
  sis,
  masters,
  value,
  onPick,
  onClear,
}: {
  sis: SisState | null;
  masters: MastersState | null;
  value: SisStudent | null;
  onPick: (s: SisStudent) => void;
  onClear: () => void;
}) {
  const [query, setQuery] = useState("");
  const matches = useMemo(() => {
    if (!sis) return [];
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return sis.students
      .filter((s) => s.status === "active")
      .filter((s) => s.fullName.toLowerCase().includes(q) || s.admissionNo.toLowerCase().includes(q))
      .slice(0, 15);
  }, [sis, query]);

  if (value) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--surface-sunken)] px-3 py-2">
        <span className="text-sm font-semibold">
          {value.fullName}
          {masters ? ` · ${classSectionLabel(masters, value.classId, value.sectionId)}` : ""}
        </span>
        <button type="button" className="text-xs font-semibold text-[var(--brand-deep)] underline" onClick={onClear}>
          Change
        </button>
      </div>
    );
  }

  return (
    <>
      <input
        className={field}
        placeholder="Search name or admission no…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {matches.length > 0 ? (
        <ul className="mt-1 max-h-52 overflow-y-auto rounded-lg border border-[var(--border)]">
          {matches.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className="w-full px-3 py-2 text-left text-sm hover:bg-[var(--surface-sunken)]"
                onClick={() => {
                  onPick(s);
                  setQuery("");
                }}
              >
                {s.fullName}
                <span className="ml-2 text-xs text-[var(--muted)]">{s.admissionNo}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

export function VisitorsWorkspace() {
  const session = useDemoSession();
  const readOnly = useSessionReadOnly();
  const ay = session.academicYearCode || DEFAULT_AY;
  const [tab, setTab] = useState<Tab>("register");
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [sis, setSis] = useState<SisState | null>(null);
  const [dutyRoster, setDutyRoster] = useState<DutyRosterState | null>(null);
  const [state, setState] = useState<VisitorState>(emptyVisitorState());
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [printEntry, setPrintEntry] = useState<VisitorEntry | null>(null);

  // Re-read when the server copy of this module lands (login/refresh hydration).
  useModuleStateHydration(["visitors", "duty_roster"], () => { setDutyRoster(loadDutyRoster()); setState(loadVisitors()); });
  useEffect(() => {
    setMasters(loadMasters());
    setSis(loadSis());
    setDutyRoster(loadDutyRoster());
    setState(loadVisitors());
    void (async () => {
      const [{ ensureMastersHydrated }, { ensureSisHydrated }, { withHydrationSlot }] =
        await Promise.all([
          import("@/lib/mastersPersistence"),
          import("@/lib/sisPersistence"),
          import("@/lib/deskHydrateGuard"),
        ]);
      await Promise.all([
        withHydrationSlot(() => ensureMastersHydrated()),
        withHydrationSlot(() => ensureSisHydrated()),
      ]);
      setMasters(loadMasters());
      setSis(loadSis());
    })();
  }, []);

  function flash(msg: string) {
    setNotice(msg);
    setError(null);
    window.setTimeout(() => setNotice(null), 4000);
  }

  function studentName(id: string): string {
    return sis?.students.find((s) => s.id === id)?.fullName || "—";
  }

  // --- Visitor register ---
  const [regName, setRegName] = useState("");
  const [regMobile, setRegMobile] = useState("");
  const [regPurpose, setRegPurpose] = useState<VisitorPurpose>("meeting");
  const [regPersonToMeet, setRegPersonToMeet] = useState("");
  const [regIdProof, setRegIdProof] = useState("");

  function resetRegForm() {
    setRegName("");
    setRegMobile("");
    setRegPurpose("meeting");
    setRegPersonToMeet("");
    setRegIdProof("");
  }

  function onCheckIn() {
    if (!regName.trim()) {
      setError("Visitor name is required.");
      return;
    }
    const { state: withEntry, entry } = checkInVisitor(state, {
      visitorName: regName,
      mobile: regMobile,
      purpose: regPurpose,
      personToMeet: regPersonToMeet,
      idProofNote: regIdProof,
      createdBy: session.staffId || session.fullName || "",
    });
    setState(saveVisitors(withEntry));
    resetRegForm();
    flash(`${entry.visitorName} checked in.`);
  }

  function onCheckOut(id: string) {
    setState(checkOutVisitor(state, id));
  }

  function onDeleteEntry(id: string) {
    if (!window.confirm("Delete this visitor entry?")) return;
    setState(deleteVisitorEntry(state, id));
  }

  const visitorRows = useMemo(
    () => state.visitorLog.slice().sort((a, b) => b.inTime.localeCompare(a.inTime)),
    [state],
  );

  // --- Gate passes ---
  const [gpStudent, setGpStudent] = useState<SisStudent | null>(null);
  const [gpDate, setGpDate] = useState(todayIso());
  const [gpTime, setGpTime] = useState("");
  const [gpReason, setGpReason] = useState("");

  function resetGpForm() {
    setGpStudent(null);
    setGpDate(todayIso());
    setGpTime("");
    setGpReason("");
  }

  function onLogGatePass() {
    if (!gpStudent) {
      setError("Pick a student.");
      return;
    }
    if (!gpReason.trim()) {
      setError("Reason is required.");
      return;
    }
    const { state: next } = upsertGatePass(state, {
      studentId: gpStudent.id,
      academicYearCode: ay,
      date: gpDate,
      requestedPickupTime: gpTime,
      reason: gpReason,
      requestedByStaffId: session.staffId || "",
      status: "requested",
    });
    setState(saveVisitors(next));
    resetGpForm();
    flash("Gate pass logged.");
  }

  async function onNotifyGatePass(pass: GatePass) {
    if (!sis) return;
    const res = await notifyGatePassParent(pass, sis);
    if (!res.ok) {
      setError(res.error || "Notify failed");
      return;
    }
    const { state: next } = upsertGatePass(state, { ...pass, notifiedParentAt: new Date().toISOString() });
    setState(saveVisitors(next));
    flash(`Parent notified for ${studentName(pass.studentId)}.`);
  }

  function onMarkPickedUp(pass: GatePass) {
    const name = window.prompt("Name of person picking up the student:", pass.pickedUpByName || "");
    if (name == null) return;
    setState(markGatePassPickedUp(state, pass.id, name));
  }

  function onDeleteGatePass(id: string) {
    if (!window.confirm("Delete this gate pass?")) return;
    setState(deleteGatePass(state, id));
  }

  const gatePassRows = useMemo(
    () => state.gatePasses.slice().sort((a, b) => b.date.localeCompare(a.date)),
    [state],
  );

  // --- Gate duty today ---
  const todayDutyAssignments = useMemo(
    () => (dutyRoster ? onGateDutyNow(dutyRoster, todayIso()) : []),
    [dutyRoster],
  );

  return (
    <ErpWorkspaceShell
      title="Visitor / gate management"
      subtitle="Front-gate visitor register, QR passes, early-pickup gate passes"
      icon={<DoorOpen className="size-6" aria-hidden />}
      notice={notice}
      error={error}
    >
      <ModuleTabs value={tab} onChange={(id) => setTab(id as Tab)} items={TABS} />

      {tab === "register" ? (
        <div className="mt-5 space-y-5">
          <div className="max-w-xl space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <p className="text-sm font-bold">Check in visitor</p>
            <label className="block text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">Visitor name</span>
              <input className={field} value={regName} onChange={(e) => setRegName(e.target.value)} />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">Mobile</span>
                <input className={field} value={regMobile} onChange={(e) => setRegMobile(e.target.value)} />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">Purpose</span>
                <select className={field} value={regPurpose} onChange={(e) => setRegPurpose(e.target.value as VisitorPurpose)}>
                  {VISITOR_PURPOSES.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </label>
            </div>
            <label className="block text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">Meeting (staff / department)</span>
              <input className={field} value={regPersonToMeet} onChange={(e) => setRegPersonToMeet(e.target.value)} />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">ID proof note</span>
              <input className={field} placeholder="e.g. Aadhaar last 4 digits" value={regIdProof} onChange={(e) => setRegIdProof(e.target.value)} />
            </label>
            <button
              type="button"
              className="btn-accent rounded-lg px-4 py-2 text-sm font-bold disabled:opacity-50"
              disabled={readOnly}
              onClick={onCheckIn}
            >
              Check in
            </button>
          </div>

          {visitorRows.length === 0 ? (
            <p className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-8 text-center text-sm text-[var(--muted)]">
              No visitors logged yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {visitorRows.map((v) => (
                <li key={v.id} className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="font-semibold">{v.visitorName}</span>
                      <span className="ml-2 text-xs text-[var(--muted)]">
                        {visitorPurposeLabel(v.purpose)}
                        {v.personToMeet ? ` · meeting ${v.personToMeet}` : ""} · in {new Date(v.inTime).toLocaleTimeString()}
                        {v.outTime ? ` · out ${new Date(v.outTime).toLocaleTimeString()}` : " · on campus"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs font-semibold"
                        onClick={() => setPrintEntry(v)}
                      >
                        Print pass
                      </button>
                      <button
                        type="button"
                        className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs font-semibold disabled:opacity-50"
                        disabled={readOnly || !!v.outTime}
                        onClick={() => onCheckOut(v.id)}
                      >
                        {v.outTime ? "Checked out" : "Check out"}
                      </button>
                      <button
                        type="button"
                        className="text-xs font-bold text-[var(--danger)]"
                        disabled={readOnly}
                        onClick={() => onDeleteEntry(v.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {printEntry ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 print-hide">
              <div className="max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-xl bg-white p-4">
                <VisitorPassSheet entry={printEntry} />
                <div className="mt-3 flex justify-end gap-2">
                  <button
                    type="button"
                    className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-semibold"
                    onClick={() => setPrintEntry(null)}
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    className="btn-accent rounded-lg px-3 py-1.5 text-sm font-bold"
                    onClick={() => printVisitorPass(printEntry.id)}
                  >
                    Print
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === "gatepasses" ? (
        <div className="mt-5 space-y-5">
          <div className="max-w-xl space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <p className="text-sm font-bold">Log early-pickup gate pass</p>
            <label className="block text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">Student</span>
              <StudentPicker sis={sis} masters={masters} value={gpStudent} onPick={setGpStudent} onClear={() => setGpStudent(null)} />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">Date</span>
                <input type="date" className={field} value={gpDate} onChange={(e) => setGpDate(e.target.value)} />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">Requested pickup time</span>
                <input type="time" className={field} value={gpTime} onChange={(e) => setGpTime(e.target.value)} />
              </label>
            </div>
            <label className="block text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">Reason</span>
              <textarea className={field} rows={2} value={gpReason} onChange={(e) => setGpReason(e.target.value)} />
            </label>
            <button
              type="button"
              className="btn-accent rounded-lg px-4 py-2 text-sm font-bold disabled:opacity-50"
              disabled={readOnly}
              onClick={onLogGatePass}
            >
              Log gate pass
            </button>
          </div>

          {gatePassRows.length === 0 ? (
            <p className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-8 text-center text-sm text-[var(--muted)]">
              No gate passes logged yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {gatePassRows.map((g) => (
                <li key={g.id} className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="font-semibold">{studentName(g.studentId)}</span>
                      <span className="ml-2 text-xs text-[var(--muted)]">
                        {g.date}{g.requestedPickupTime ? ` · ${g.requestedPickupTime}` : ""} · {gatePassStatusLabel(g.status)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs font-semibold disabled:opacity-50"
                        disabled={readOnly || !!g.notifiedParentAt}
                        onClick={() => onNotifyGatePass(g)}
                      >
                        {g.notifiedParentAt ? "Notified" : "Notify parent"}
                      </button>
                      <button
                        type="button"
                        className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs font-semibold disabled:opacity-50"
                        disabled={readOnly || g.status === "picked_up" || g.status === "cancelled"}
                        onClick={() => onMarkPickedUp(g)}
                      >
                        Mark picked up
                      </button>
                      <button
                        type="button"
                        className="text-xs font-bold text-[var(--danger)]"
                        disabled={readOnly}
                        onClick={() => onDeleteGatePass(g.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  <p className="mt-1 text-sm text-[var(--muted)]">{g.reason}</p>
                  {g.status === "picked_up" ? (
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      Picked up by {g.pickedUpByName || "—"}
                      {g.actualPickupTime ? ` at ${new Date(g.actualPickupTime).toLocaleTimeString()}` : ""}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {tab === "gateduty" ? (
        <div className="mt-5 space-y-3">
          {!dutyRoster ? (
            <p className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-8 text-center text-sm text-[var(--muted)]">
              Loading duty roster…
            </p>
          ) : todayDutyAssignments.length === 0 ? (
            <p className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-8 text-center text-sm text-[var(--muted)]">
              Nobody is assigned to gate duty today. Set this up from Staff → Duty roster.
            </p>
          ) : (
            <ul className="space-y-2">
              {todayDutyAssignments.map((a) => (
                <li key={a.id} className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 text-sm">
                  <span className="font-semibold">{masters ? dutyStaffLabel(masters, a.staffId) : a.staffId}</span>
                  {a.note ? <span className="ml-2 text-[var(--muted)]">{a.note}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </ErpWorkspaceShell>
  );
}
