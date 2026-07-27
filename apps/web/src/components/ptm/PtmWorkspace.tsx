"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { UsersRound } from "lucide-react";
import { useDemoSession } from "@/components/shell/SessionContext";
import { ModuleTabs, type ModuleTabItem } from "@/components/ui/ModuleTabs";
import { ModuleDashboardHost } from "@/components/dashboard/ModuleDashboardHost";
import { DEFAULT_AY, loadMasters, type MastersState } from "@/lib/masters";
import { loadSis, type SisState } from "@/lib/sis";
import { useModuleTabQuery } from "@/lib/useModuleTabQuery";
import {
  addPtmSlots,
  cancelPtmBooking,
  composeWhatsAppPtmConfirm,
  composeWhatsAppPtmReminder,
  createPtmEvent,
  markPtmWhatsApp,
  modeLabel,
  PTM_REPORTS,
  ptmBookingMobile,
  runPtmReport,
  savePtmFeedback,
  seedPtmIfEmpty,
  setPtmBookingStatus,
  slotBookedCount,
  type PtmMode,
  type PtmReportId,
  type PtmState,
} from "@/lib/ptm";
import { openWaMe } from "@/lib/waMe";

type PtmTab =
  | "dashboard"
  | "events"
  | "slots"
  | "bookings"
  | "feedback"
  | "reports";

const TABS: ModuleTabItem[] = [
  { id: "dashboard", label: "Dashboard", tone: "navy" },
  { id: "events", label: "Events", tone: "navy" },
  { id: "slots", label: "Slots", tone: "teal" },
  { id: "bookings", label: "Bookings", tone: "amber" },
  { id: "feedback", label: "Feedback", tone: "green" },
  { id: "reports", label: "Reports", tone: "slate" },
];

const field =
  "rounded-lg border border-[rgba(32,48,80,0.15)] bg-white px-2.5 py-1.5 text-sm text-[var(--brand-deep)]";
const btn =
  "rounded-lg bg-[var(--brand-deep)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50";
const btnOutline =
  "rounded-lg border border-[rgba(32,48,80,0.2)] bg-white px-3 py-1.5 text-sm text-[var(--brand-deep)]";

function classLabel(
  masters: MastersState,
  classId: string,
  sectionId?: string,
): string {
  const c = masters.classes.find((x) => x.id === classId);
  const s = sectionId
    ? masters.sections.find((x) => x.id === sectionId)
    : undefined;
  return [c?.name, s?.name].filter(Boolean).join(" · ") || "—";
}

function studentLabel(
  masters: MastersState,
  sis: SisState,
  studentId: string,
): string {
  const st = sis.students.find((s) => s.id === studentId);
  if (!st) return studentId;
  return `${st.fullName} · ${classLabel(masters, st.classId, st.sectionId)}`;
}

export function PtmWorkspace() {
  const session = useDemoSession();
  const ay = session.academicYearCode || DEFAULT_AY;
  const [tab, setTab] = useModuleTabQuery<PtmTab>("dashboard", [
    "dashboard",
    "events",
    "slots",
    "bookings",
    "feedback",
    "reports",
  ]);
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [sis, setSis] = useState<SisState | null>(null);
  const [state, setState] = useState<PtmState | null>(null);
  const [eventId, setEventId] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reportFormat, setReportFormat] = useState<"excel" | "pdf">("excel");

  // Create event
  const [evName, setEvName] = useState("");
  const [evDate, setEvDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [evEndDate, setEvEndDate] = useState("");
  const [evMode, setEvMode] = useState<PtmMode>("in_person");
  const [evNote, setEvNote] = useState("");
  const [evClassIds, setEvClassIds] = useState<string[]>([]);

  // Slots
  const [slotTeacherId, setSlotTeacherId] = useState("");
  const [slotStarts, setSlotStarts] = useState("10:00,10:15,10:30");
  const [slotRoom, setSlotRoom] = useState("Room 12");

  // Feedback
  const [fbBookingId, setFbBookingId] = useState("");
  const [fbStrengths, setFbStrengths] = useState("");
  const [fbAreas, setFbAreas] = useState("");
  const [fbFollowUp, setFbFollowUp] = useState("");

  const actorName = session.fullName || "Staff";

  function flash(msg: string) {
    setNotice(msg);
    setError(null);
    window.setTimeout(() => setNotice(null), 2800);
  }

  function refresh() {
    setMasters(loadMasters());
    setSis(loadSis());
    const ptm = seedPtmIfEmpty(ay);
    setState(ptm);
    if (!eventId && ptm.events[0]) setEventId(ptm.events[0].id);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ay]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    void (async () => {
      const { ensurePtmHydrated } = await import("@/lib/ptmPersistence");
      await ensurePtmHydrated();
      refresh();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ay]);

  const classOptions = useMemo(() => {
    if (!masters) return [];
    return masters.classes.filter((c) => c.isActive !== false);
  }, [masters]);

  const staffOptions = useMemo(() => {
    if (!masters) return [];
    return masters.staff ?? [];
  }, [masters]);

  useEffect(() => {
    if (!slotTeacherId && staffOptions[0]) {
      setSlotTeacherId(staffOptions[0].id);
    }
  }, [slotTeacherId, staffOptions]);

  const activeEvents = useMemo(() => {
    if (!state) return [];
    return state.events.filter(
      (e) => e.academicYearCode === ay && e.isActive,
    );
  }, [state, ay]);

  const eventSlots = useMemo(() => {
    if (!state || !eventId) return [];
    return state.slots.filter((s) => s.eventId === eventId);
  }, [state, eventId]);

  const eventBookings = useMemo(() => {
    if (!state || !eventId) return [];
    return state.bookings.filter((b) => b.eventId === eventId);
  }, [state, eventId]);

  const selectedEvent = useMemo(
    () => state?.events.find((e) => e.id === eventId),
    [state, eventId],
  );

  function toggleClass(id: string) {
    setEvClassIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function createEvent() {
    const r = createPtmEvent({
      academicYearCode: ay,
      name: evName,
      date: evDate,
      endDate: evEndDate || evDate,
      classIds: evClassIds.length
        ? evClassIds
        : classOptions.slice(0, 3).map((c) => c.id),
      mode: evMode,
      note: evNote,
    });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setEvName("");
    setEvNote("");
    refresh();
    setEventId(r.event.id);
    flash("PTM event created");
    setTab("slots");
  }

  function addSlots() {
    const teacher = staffOptions.find((s) => s.id === slotTeacherId);
    const starts = slotStarts
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const r = addPtmSlots({
      eventId,
      teacherStaffId: slotTeacherId,
      teacherName: teacher?.fullName || "Teacher",
      starts,
      roomOrLink: slotRoom,
    });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    refresh();
    flash(`Added ${r.slots.length} slot(s)`);
  }

  function saveFeedback() {
    const booking = state?.bookings.find((b) => b.id === fbBookingId);
    if (!booking) {
      setError("Select a booking");
      return;
    }
    const r = savePtmFeedback({
      bookingId: fbBookingId,
      studentId: booking.studentId,
      strengths: fbStrengths,
      areas: fbAreas,
      followUp: fbFollowUp,
      createdBy: actorName,
    });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setFbStrengths("");
    setFbAreas("");
    setFbFollowUp("");
    setFbBookingId("");
    refresh();
    flash("Feedback saved");
  }

  if (!state || !masters || !sis) {
    return (
      <div className="px-4 py-8 text-sm text-[var(--muted)]">Loading PTM…</div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 pb-10 pt-4">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-[var(--brand-deep)]">
            <UsersRound className="h-7 w-7" aria-hidden />
            PTM scheduler
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Parent–teacher meetings · slots · bookings · feedback (§19b)
          </p>
        </div>
        <Link href="/reports?module=ptm" className={btnOutline}>
          Reports Center
        </Link>
      </header>

      {error ? (
        <p className="mb-3 rounded-lg bg-[rgba(180,35,24,0.08)] px-3 py-2 text-sm text-[#b42318]">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="mb-3 rounded-lg bg-[rgba(15,122,76,0.1)] px-3 py-2 text-sm text-[#0f7a4c]">
          {notice}
        </p>
      ) : null}

      {activeEvents.length > 0 ? (
        <label className="mb-3 block text-xs text-[var(--muted)]">
          Active event
          <select
            className={`${field} mt-1 block min-w-[14rem]`}
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}
          >
            {activeEvents.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} · {e.date}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <ModuleTabs items={TABS} value={tab} onChange={(id) => setTab(id as PtmTab)} />

      {tab === "dashboard" ? (
        <ModuleDashboardHost
          moduleId="ptm"
          onNavigateTab={(t) => setTab(t as PtmTab)}
        />
      ) : null}

      {tab === "events" ? (
        <section className="mt-4 space-y-4">
          <ul className="space-y-2">
            {state.events.map((e) => (
              <li
                key={e.id}
                className="rounded-xl border border-[rgba(32,48,80,0.1)] bg-white px-4 py-3"
              >
                <p className="text-sm font-semibold text-[var(--brand-deep)]">
                  {e.name}
                  {!e.isActive ? (
                    <span className="ml-2 text-xs font-normal text-[var(--muted)]">
                      (inactive)
                    </span>
                  ) : null}
                </p>
                <p className="text-xs text-[var(--muted)]">
                  {e.date}
                  {e.endDate !== e.date ? ` → ${e.endDate}` : ""} ·{" "}
                  {modeLabel(e.mode)} ·{" "}
                  {e.classIds.length
                    ? e.classIds
                        .map((id) => classOptions.find((c) => c.id === id)?.name)
                        .filter(Boolean)
                        .join(", ")
                    : "All classes"}
                </p>
                {e.note ? (
                  <p className="mt-1 text-sm text-[var(--brand-deep)]">{e.note}</p>
                ) : null}
              </li>
            ))}
          </ul>

          <div className="max-w-xl space-y-3 border-t border-[rgba(32,48,80,0.08)] pt-4">
            <h2 className="text-sm font-semibold text-[var(--brand-deep)]">
              New PTM event
            </h2>
            <label className="block text-xs text-[var(--muted)]">
              Name
              <input
                className={`${field} mt-1 w-full`}
                value={evName}
                onChange={(e) => setEvName(e.target.value)}
                placeholder="Term PTM"
              />
            </label>
            <div className="flex flex-wrap gap-3">
              <label className="text-xs text-[var(--muted)]">
                Date
                <input
                  type="date"
                  className={`${field} mt-1 block`}
                  value={evDate}
                  onChange={(e) => setEvDate(e.target.value)}
                />
              </label>
              <label className="text-xs text-[var(--muted)]">
                End date
                <input
                  type="date"
                  className={`${field} mt-1 block`}
                  value={evEndDate}
                  onChange={(e) => setEvEndDate(e.target.value)}
                />
              </label>
              <label className="text-xs text-[var(--muted)]">
                Mode
                <select
                  className={`${field} mt-1 block`}
                  value={evMode}
                  onChange={(e) => setEvMode(e.target.value as PtmMode)}
                >
                  <option value="in_person">In person</option>
                  <option value="video">Video</option>
                  <option value="phone">Phone</option>
                </select>
              </label>
            </div>
            <div>
              <p className="text-xs text-[var(--muted)]">Classes</p>
              <div className="mt-1 flex flex-wrap gap-2">
                {classOptions.map((c) => (
                  <label
                    key={c.id}
                    className="flex items-center gap-1.5 text-xs text-[var(--brand-deep)]"
                  >
                    <input
                      type="checkbox"
                      checked={evClassIds.includes(c.id)}
                      onChange={() => toggleClass(c.id)}
                    />
                    {c.name}
                  </label>
                ))}
              </div>
            </div>
            <label className="block text-xs text-[var(--muted)]">
              Note
              <textarea
                className={`${field} mt-1 w-full`}
                rows={2}
                value={evNote}
                onChange={(e) => setEvNote(e.target.value)}
              />
            </label>
            <button type="button" className={btn} onClick={createEvent}>
              Create event
            </button>
          </div>
        </section>
      ) : null}

      {tab === "slots" ? (
        <section className="mt-4 space-y-4">
          {!eventId ? (
            <p className="text-sm text-[var(--muted)]">
              Create an event first.
            </p>
          ) : (
            <>
              <ul className="space-y-1.5">
                {eventSlots.length === 0 ? (
                  <p className="text-sm text-[var(--muted)]">No slots yet.</p>
                ) : (
                  eventSlots.map((s) => {
                    const booked = slotBookedCount(state, s.id);
                    return (
                      <li
                        key={s.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[rgba(32,48,80,0.08)] bg-white px-3 py-2"
                      >
                        <span className="text-sm text-[var(--brand-deep)]">
                          {s.teacherName} · {s.startAt}–{s.endAt}
                          {s.roomOrLink ? ` · ${s.roomOrLink}` : ""}
                        </span>
                        <span className="text-xs text-[var(--muted)]">
                          {booked}/{s.capacity} booked
                        </span>
                      </li>
                    );
                  })
                )}
              </ul>

              <div className="max-w-xl space-y-3 border-t border-[rgba(32,48,80,0.08)] pt-4">
                <h2 className="text-sm font-semibold text-[var(--brand-deep)]">
                  Add slots
                </h2>
                <label className="block text-xs text-[var(--muted)]">
                  Teacher
                  <select
                    className={`${field} mt-1 w-full`}
                    value={slotTeacherId}
                    onChange={(e) => setSlotTeacherId(e.target.value)}
                  >
                    {staffOptions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.fullName}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs text-[var(--muted)]">
                  Start times (comma-separated)
                  <input
                    className={`${field} mt-1 w-full`}
                    value={slotStarts}
                    onChange={(e) => setSlotStarts(e.target.value)}
                    placeholder="10:00,10:15,10:30"
                  />
                </label>
                <label className="block text-xs text-[var(--muted)]">
                  Room / link
                  <input
                    className={`${field} mt-1 w-full`}
                    value={slotRoom}
                    onChange={(e) => setSlotRoom(e.target.value)}
                  />
                </label>
                <button type="button" className={btn} onClick={addSlots}>
                  Add slots
                </button>
              </div>
            </>
          )}
        </section>
      ) : null}

      {tab === "bookings" ? (
        <section className="mt-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={btn}
              disabled={!eventBookings.some((b) => b.status === "booked")}
              onClick={() => {
                if (!state || !selectedEvent || !sis) return;
                const booked = eventBookings.filter((b) => b.status === "booked");
                let n = 0;
                for (const b of booked) {
                  const slot = state.slots.find((s) => s.id === b.slotId);
                  const mobile = ptmBookingMobile(b, sis);
                  if (!slot || mobile.replace(/\D/g, "").length < 10) continue;
                  const stu = sis.students.find((s) => s.id === b.studentId);
                  const msg = composeWhatsAppPtmReminder({
                    childName: stu?.fullName || b.parentName,
                    eventName: selectedEvent.name,
                    date: selectedEvent.date,
                    startAt: slot.startAt,
                    teacherName: slot.teacherName,
                    roomOrLink: slot.roomOrLink,
                  });
                  window.setTimeout(() => openWaMe(mobile, msg), n * 500);
                  markPtmWhatsApp(b.id, "reminded");
                  n += 1;
                }
                refresh();
                if (!n) setError("No booked parents with WhatsApp mobile");
                else flash(`Opened WhatsApp reminder for ${n} booking(s)`);
              }}
            >
              Remind all booked
            </button>
          </div>
          {eventBookings.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">No bookings yet.</p>
          ) : (
            eventBookings.map((b) => {
              const slot = state.slots.find((s) => s.id === b.slotId);
              return (
                <div
                  key={b.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[rgba(32,48,80,0.1)] bg-white px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-medium text-[var(--brand-deep)]">
                      {studentLabel(masters, sis, b.studentId)}
                    </p>
                    <p className="text-xs text-[var(--muted)]">
                      {b.parentName} ·{" "}
                      {slot
                        ? `${slot.startAt}–${slot.endAt} · ${slot.teacherName}`
                        : "—"}{" "}
                      · {b.status}
                      {b.whatsappConfirmedAt ? " · WA ✓" : ""}
                      {b.whatsappRemindedAt ? " · reminded" : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {b.status === "booked" ? (
                      <>
                        <button
                          type="button"
                          className={btnOutline}
                          onClick={() => {
                            if (!selectedEvent || !sis || !slot) return;
                            const mobile = ptmBookingMobile(b, sis);
                            if (mobile.replace(/\D/g, "").length < 10) {
                              setError("No WhatsApp mobile on household");
                              return;
                            }
                            const stu = sis.students.find(
                              (s) => s.id === b.studentId,
                            );
                            const msg = composeWhatsAppPtmConfirm({
                              childName: stu?.fullName || b.parentName,
                              eventName: selectedEvent.name,
                              date: selectedEvent.date,
                              startAt: slot.startAt,
                              teacherName: slot.teacherName,
                              roomOrLink: slot.roomOrLink,
                            });
                            openWaMe(mobile, msg);
                            markPtmWhatsApp(b.id, "confirmed");
                            refresh();
                            flash("WhatsApp confirm opened");
                          }}
                        >
                          Confirm WA
                        </button>
                        <button
                          type="button"
                          className={btnOutline}
                          onClick={() => {
                            if (!selectedEvent || !sis || !slot) return;
                            const mobile = ptmBookingMobile(b, sis);
                            if (mobile.replace(/\D/g, "").length < 10) {
                              setError("No WhatsApp mobile on household");
                              return;
                            }
                            const stu = sis.students.find(
                              (s) => s.id === b.studentId,
                            );
                            const msg = composeWhatsAppPtmReminder({
                              childName: stu?.fullName || b.parentName,
                              eventName: selectedEvent.name,
                              date: selectedEvent.date,
                              startAt: slot.startAt,
                              teacherName: slot.teacherName,
                              roomOrLink: slot.roomOrLink,
                            });
                            openWaMe(mobile, msg);
                            markPtmWhatsApp(b.id, "reminded");
                            refresh();
                            flash("WhatsApp reminder opened");
                          }}
                        >
                          Remind
                        </button>
                        <button
                          type="button"
                          className={btnOutline}
                          onClick={() => {
                            setPtmBookingStatus(b.id, "completed");
                            refresh();
                            flash("Marked completed");
                          }}
                        >
                          Complete
                        </button>
                        <button
                          type="button"
                          className={btnOutline}
                          onClick={() => {
                            setPtmBookingStatus(b.id, "no_show");
                            refresh();
                            flash("Marked no-show");
                          }}
                        >
                          No-show
                        </button>
                        <button
                          type="button"
                          className="text-xs text-[#b42318] underline"
                          onClick={() => {
                            cancelPtmBooking(b.id);
                            refresh();
                            flash("Cancelled");
                          }}
                        >
                          Cancel
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
        </section>
      ) : null}

      {tab === "feedback" ? (
        <section className="mt-4 max-w-xl space-y-3">
          <label className="block text-xs text-[var(--muted)]">
            Booking (completed or booked)
            <select
              className={`${field} mt-1 w-full`}
              value={fbBookingId}
              onChange={(e) => setFbBookingId(e.target.value)}
            >
              <option value="">Select…</option>
              {eventBookings
                .filter((b) => b.status === "booked" || b.status === "completed")
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {studentLabel(masters, sis, b.studentId)} · {b.status}
                  </option>
                ))}
            </select>
          </label>
          <label className="block text-xs text-[var(--muted)]">
            Strengths
            <textarea
              className={`${field} mt-1 w-full`}
              rows={2}
              value={fbStrengths}
              onChange={(e) => setFbStrengths(e.target.value)}
            />
          </label>
          <label className="block text-xs text-[var(--muted)]">
            Areas to improve
            <textarea
              className={`${field} mt-1 w-full`}
              rows={2}
              value={fbAreas}
              onChange={(e) => setFbAreas(e.target.value)}
            />
          </label>
          <label className="block text-xs text-[var(--muted)]">
            Follow-up
            <textarea
              className={`${field} mt-1 w-full`}
              rows={2}
              value={fbFollowUp}
              onChange={(e) => setFbFollowUp(e.target.value)}
            />
          </label>
          <button type="button" className={btn} onClick={saveFeedback}>
            Save feedback
          </button>

          {state.feedback.length > 0 ? (
            <ul className="space-y-2 border-t border-[rgba(32,48,80,0.08)] pt-4">
              {state.feedback.slice(0, 10).map((f) => (
                <li
                  key={f.id}
                  className="rounded-lg border border-[rgba(32,48,80,0.08)] px-3 py-2 text-sm"
                >
                  <p className="font-medium text-[var(--brand-deep)]">
                    {studentLabel(masters, sis, f.studentId)}
                  </p>
                  <p className="text-xs text-[var(--muted)]">
                    {f.createdBy} · {f.createdAt.slice(0, 10)}
                  </p>
                  {f.strengths ? (
                    <p className="mt-1 text-xs">+ {f.strengths}</p>
                  ) : null}
                  {f.areas ? (
                    <p className="text-xs">− {f.areas}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {tab === "reports" ? (
        <section className="mt-4 space-y-3">
          <label className="text-xs text-[var(--muted)]">
            Format
            <select
              className={`${field} mt-1 block`}
              value={reportFormat}
              onChange={(e) =>
                setReportFormat(e.target.value as "excel" | "pdf")
              }
            >
              <option value="excel">Excel</option>
              <option value="pdf">PDF</option>
            </select>
          </label>
          <ul className="space-y-1.5">
            {PTM_REPORTS.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[rgba(32,48,80,0.08)] bg-white px-3 py-2"
              >
                <div>
                  <p className="text-sm font-medium text-[var(--brand-deep)]">
                    {r.label}
                  </p>
                  {r.hint ? (
                    <p className="text-xs text-[var(--muted)]">{r.hint}</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  className={btn}
                  onClick={() => {
                    const res = runPtmReport(r.id as PtmReportId, {
                      eventId,
                      format: reportFormat,
                      ptm: state,
                      masters,
                    });
                    if (!res.ok) setError(res.error);
                    else flash(res.message);
                  }}
                >
                  Export
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
