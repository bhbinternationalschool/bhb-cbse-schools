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
  nextVisitorNo,
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
import { GateQrPanel } from "@/components/visitors/GateQrPanel";
import { VISITOR_PURPOSE_HI, type VisitorLang } from "@/lib/visitorI18n";

type Tab = "register" | "gateqr" | "gatepasses" | "gateduty";

const TABS_EN: ModuleTabItem[] = [
  { id: "register", label: "Visitor register", tone: "teal" },
  { id: "gateqr", label: "Gate QR", tone: "navy" },
  { id: "gatepasses", label: "Gate passes", tone: "amber" },
  { id: "gateduty", label: "Gate duty today", tone: "sky" },
];
const TABS_HI: ModuleTabItem[] = [
  { id: "register", label: "विज़िटर रजिस्टर", tone: "teal" },
  { id: "gateqr", label: "गेट QR", tone: "navy" },
  { id: "gatepasses", label: "गेट पास", tone: "amber" },
  { id: "gateduty", label: "आज की गेट ड्यूटी", tone: "sky" },
];
const LANG_KEY = "bhb_visitor_desk_lang";
/** Register/gate labels in Hindi for a gateman who does not read English. */
const T = {
  en: { checkIn: "Check in visitor", name: "Visitor name", mobile: "Mobile", purpose: "Purpose", meet: "Person to meet", idProof: "ID proof note", checkInBtn: "Check in", onCampus: "on campus", out: "out", inWord: "in", checkOut: "Check out", checkedOut: "Checked out", printPass: "Print pass", del: "Delete", noVisitors: "No visitors logged yet.", gateQr: "Gate QR", langToggle: "हिन्दी", live: "Live — refreshes every 20 s", meeting: "meeting" },
  hi: { checkIn: "विज़िटर चेक-इन", name: "विज़िटर का नाम", mobile: "मोबाइल", purpose: "उद्देश्य", meet: "किससे मिलना है", idProof: "पहचान पत्र नोट", checkInBtn: "चेक-इन", onCampus: "परिसर में", out: "बाहर", inWord: "अंदर", checkOut: "चेक-आउट", checkedOut: "चेक-आउट हो गया", printPass: "पास प्रिंट", del: "हटाएँ", noVisitors: "अभी कोई विज़िटर दर्ज नहीं।", gateQr: "गेट QR", langToggle: "English", live: "लाइव — हर 20 सेकंड रिफ्रेश", meeting: "मिलना" },
} as const;

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
  const [lang, setLang] = useState<VisitorLang>("en");
  const L = T[lang];
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LANG_KEY);
      if (saved === "hi" || saved === "en") setLang(saved);
    } catch {
      /* ignore */
    }
  }, []);
  function toggleLang() {
    const next: VisitorLang = lang === "en" ? "hi" : "en";
    setLang(next);
    try {
      localStorage.setItem(LANG_KEY, next);
    } catch {
      /* ignore */
    }
  }

  // Re-read when the server copy of this module lands (login/refresh hydration).
  useModuleStateHydration(["visitors", "duty_roster"], () => { setDutyRoster(loadDutyRoster()); setState(loadVisitors()); });

  // Gate-QR check-ins land on the server without this browser knowing —
  // pull every 20 s while the register is open and the tab is visible.
  useEffect(() => {
    if (tab !== "register") return;
    let stopped = false;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      const [{ resetDeskHydrated }, { ensureModuleStateHydrated }] = await Promise.all([
        import("@/lib/deskHydrateGuard"),
        import("@/lib/localModulesPersistence"),
      ]);
      resetDeskHydrated("module_state:visitors");
      const changed = await ensureModuleStateHydrated("visitors");
      if (changed && !stopped) setState(loadVisitors());
    };
    const h = window.setInterval(() => void tick(), 20_000);
    return () => {
      stopped = true;
      window.clearInterval(h);
    };
  }, [tab]);
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
      visitorNo: nextVisitorNo(state),
      source: "reception",
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
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <ModuleTabs value={tab} onChange={(id) => setTab(id as Tab)} items={lang === "hi" ? TABS_HI : TABS_EN} />
        </div>
        <button type="button" onClick={toggleLang} className="rounded-full border border-[var(--border)] px-3 py-1.5 text-xs font-bold" title="Switch language / भाषा बदलें">
          {L.langToggle}
        </button>
      </div>

      {tab === "gateqr" ? <GateQrPanel lang={lang} /> : null}

      {tab === "register" ? (
        <div className="mt-5 space-y-5">
          <div className="max-w-xl space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <p className="text-sm font-bold">{L.checkIn} <span className="ml-2 text-[10px] font-semibold text-[var(--muted)]">{L.live}</span></p>
            <label className="block text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">{L.name}</span>
              <input className={field} value={regName} onChange={(e) => setRegName(e.target.value)} />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">{L.mobile}</span>
                <input className={field} value={regMobile} onChange={(e) => setRegMobile(e.target.value)} />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">{L.purpose}</span>
                <select className={field} value={regPurpose} onChange={(e) => setRegPurpose(e.target.value as VisitorPurpose)}>
                  {VISITOR_PURPOSES.map((p) => (
                    <option key={p.value} value={p.value}>{lang === "hi" ? VISITOR_PURPOSE_HI[p.value] || p.label : p.label}</option>
                  ))}
                </select>
              </label>
            </div>
            <label className="block text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">{L.meet}</span>
              <input className={field} value={regPersonToMeet} onChange={(e) => setRegPersonToMeet(e.target.value)} />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">{L.idProof}</span>
              <input className={field} placeholder="e.g. Aadhaar last 4 digits" value={regIdProof} onChange={(e) => setRegIdProof(e.target.value)} />
            </label>
            <button
              type="button"
              className="btn-accent rounded-lg px-4 py-2 text-sm font-bold disabled:opacity-50"
              disabled={readOnly}
              onClick={onCheckIn}
            >
              {L.checkInBtn}
            </button>
          </div>

          {visitorRows.length === 0 ? (
            <p className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-8 text-center text-sm text-[var(--muted)]">
              {L.noVisitors}
            </p>
          ) : (
            <ul className="space-y-2">
              {visitorRows.map((v) => (
                <li key={v.id} className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      {v.visitorNo ? <span className="mr-2 rounded-md bg-[var(--brand-deep)]/10 px-1.5 py-0.5 font-mono text-[11px] font-black text-[var(--brand-deep)]">{v.visitorNo}</span> : null}
                      <span className="font-semibold">{v.visitorName}</span>
                      {v.source === "gate_qr" || v.source === "whatsapp" ? <span className="ml-2 inline-block whitespace-nowrap rounded-md bg-[var(--success-soft)] px-1.5 py-0.5 text-[10px] font-black uppercase text-[var(--success)]">{v.source === "whatsapp" ? "WhatsApp" : lang === "hi" ? "गेट QR" : "Gate QR"}</span> : null}
                      {!v.outTime ? <span className="ml-2 inline-block whitespace-nowrap rounded-md bg-[var(--warning-soft,var(--surface-sunken))] px-1.5 py-0.5 text-[10px] font-black uppercase">{L.onCampus}</span> : null}
                      <span className="ml-2 text-xs text-[var(--muted)]">
                        {lang === "hi" ? VISITOR_PURPOSE_HI[v.purpose] || v.purpose : visitorPurposeLabel(v.purpose)}
                        {v.personToMeet ? ` · ${L.meeting} ${v.personToMeet}` : ""}
                        {v.mobile ? ` · ${v.mobile}` : ""} · {L.inWord} {new Date(v.inTime).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                        {v.outTime ? ` · ${L.out} ${new Date(v.outTime).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}` : ""}
                      </span>
                      {v.linkedTo ? <div className="text-[11px] text-[var(--muted)]">{v.linkedTo}</div> : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs font-semibold"
                        onClick={() => setPrintEntry(v)}
                      >
                        {L.printPass}
                      </button>
                      <button
                        type="button"
                        className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs font-semibold disabled:opacity-50"
                        disabled={readOnly || !!v.outTime}
                        onClick={() => onCheckOut(v.id)}
                      >
                        {v.outTime ? L.checkedOut : L.checkOut}
                      </button>
                      <button
                        type="button"
                        className="text-xs font-bold text-[var(--danger)]"
                        disabled={readOnly}
                        onClick={() => onDeleteEntry(v.id)}
                      >
                        {L.del}
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
