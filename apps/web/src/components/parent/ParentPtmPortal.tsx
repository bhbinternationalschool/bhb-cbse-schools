"use client";

import { useEffect, useMemo, useState } from "react";
import { DEFAULT_AY, loadMasters, type MastersState } from "@/lib/masters";
import {
  classLabelForStudent,
  resolveParentHousehold,
} from "@/lib/parentPortal";
import { householdWhatsApp, loadSis, type Household, type SisStudent } from "@/lib/sis";
import { StudentNameLabel } from "@/components/students/StudentAvatar";
import {
  activeBookingForStudent,
  bookPtmSlot,
  cancelPtmBooking,
  composeWhatsAppPtmConfirm,
  markPtmWhatsApp,
  modeLabel,
  loadPtm,
  seedPtmIfEmpty,
  slotBookedCount,
  type PtmEvent,
  type PtmSlot,
  type PtmState,
} from "@/lib/ptm";
import { openWaMe } from "@/lib/waMe";
import { btn, btnOutline, field } from "@/components/ui/erp-ui";

export function ParentPtmPortal({
  guardianDisplayName,
}: {
  guardianDisplayName: string;
}) {
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [household, setHousehold] = useState<Household | null>(null);
  const [children, setChildren] = useState<SisStudent[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [ptm, setPtm] = useState<PtmState | null>(null);
  const [eventId, setEventId] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function flash(msg: string) {
    setNotice(msg);
    setError(null);
    window.setTimeout(() => setNotice(null), 2800);
  }

  function reload() {
    const m = loadMasters();
    const sis = loadSis();
    setMasters(m);
    const hh = resolveParentHousehold(sis, {
      guardianName: guardianDisplayName,
      mobile: "9876543210",
    });
    setHousehold(hh);
    if (!hh) {
      setChildren([]);
      setActiveId(null);
      setPtm(seedPtmIfEmpty(DEFAULT_AY));
      return;
    }
    const kids = sis.students.filter(
      (s) => s.householdId === hh.id && s.status === "active",
    );
    setChildren(kids);
    const aid =
      activeId && kids.some((k) => k.id === activeId)
        ? activeId
        : kids[0]?.id ?? null;
    const childAy =
      kids.find((k) => k.id === aid)?.academicYearCode || DEFAULT_AY;
    setPtm(seedPtmIfEmpty(childAy));
    setActiveId(aid);
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guardianDisplayName]);

  const child = useMemo(
    () => children.find((c) => c.id === activeId) ?? null,
    [children, activeId],
  );

  const events = useMemo((): PtmEvent[] => {
    if (!ptm || !child) return [];
    return ptm.events.filter(
      (e) =>
        e.isActive &&
        (e.classIds.length === 0 || e.classIds.includes(child.classId)),
    );
  }, [ptm, child]);

  useEffect(() => {
    if (!eventId && events[0]) setEventId(events[0].id);
    if (eventId && events.length && !events.some((e) => e.id === eventId)) {
      setEventId(events[0]?.id || "");
    }
  }, [eventId, events]);

  const slots = useMemo((): PtmSlot[] => {
    if (!ptm || !eventId) return [];
    return ptm.slots
      .filter((s) => s.eventId === eventId)
      .sort((a, b) => a.startAt.localeCompare(b.startAt));
  }, [ptm, eventId]);

  const booking = useMemo(() => {
    if (!ptm || !child || !eventId) return null;
    return activeBookingForStudent(ptm, eventId, child.id) ?? null;
  }, [ptm, child, eventId]);

  const selectedEvent = events.find((e) => e.id === eventId);

  function bookSlot(slotId: string) {
    if (!child || !household || !eventId) return;
    const r = bookPtmSlot({
      eventId,
      slotId,
      studentId: child.id,
      parentName: household.guardianName,
      householdId: household.id,
    });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setPtm(loadPtm());
    flash("Slot booked");
    const slot = ptm?.slots.find((s) => s.id === slotId);
    const evt = events.find((e) => e.id === eventId);
    const mobile = householdWhatsApp(household);
    if (slot && evt && mobile.replace(/\D/g, "").length >= 10) {
      const msg = composeWhatsAppPtmConfirm({
        childName: child.fullName,
        eventName: evt.name,
        date: evt.date,
        startAt: slot.startAt,
        teacherName: slot.teacherName,
        roomOrLink: slot.roomOrLink,
      });
      openWaMe(mobile, msg);
      markPtmWhatsApp(r.booking.id, "confirmed");
      setPtm(loadPtm());
    }
  }

  function cancelBooking() {
    if (!booking) return;
    const r = cancelPtmBooking(booking.id);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setPtm(loadPtm());
    flash("Booking cancelled");
  }

  function shareWhatsApp() {
    if (!child || !household || !booking || !ptm || !selectedEvent) return;
    const slot = ptm.slots.find((s) => s.id === booking.slotId);
    if (!slot) return;
    const msg = composeWhatsAppPtmConfirm({
      childName: child.fullName,
      eventName: selectedEvent.name,
      date: selectedEvent.date,
      startAt: slot.startAt,
      teacherName: slot.teacherName,
      roomOrLink: slot.roomOrLink,
    });
    const mobile = householdWhatsApp(household);
    if (mobile.replace(/\D/g, "").length < 10) {
      setError("No WhatsApp mobile on household");
      return;
    }
    openWaMe(mobile, msg);
    markPtmWhatsApp(booking.id, "confirmed");
    setPtm(loadPtm());
  }

  if (!household) {
    return (
      <p className="px-4 py-8 text-sm text-[var(--muted)]">
        No household linked for this parent demo.
      </p>
    );
  }

  return (
    <div className="px-4 pb-8 pt-3">
      {error ? (
        <p className="mb-3 rounded-lg bg-[rgba(180,35,24,0.08)] px-3 py-2 text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="mb-3 rounded-lg bg-[rgba(15,122,76,0.1)] px-3 py-2 text-sm text-[var(--success)]">
          {notice}
        </p>
      ) : null}

      {children.length > 1 ? (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {children.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setActiveId(c.id)}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                activeId === c.id
                  ? "bg-[var(--brand-deep)] text-white"
                  : "bg-[rgba(32,48,80,0.08)] text-[var(--brand-deep)]"
              }`}
            >
              <StudentNameLabel student={c} />
            </button>
          ))}
        </div>
      ) : child ? (
        <p className="mb-2 text-sm font-semibold text-[var(--brand-deep)]">
          <StudentNameLabel student={child} />
          {masters ? (
            <span className="ml-2 text-xs font-normal text-[var(--muted)]">
              {classLabelForStudent(child, masters)}
            </span>
          ) : null}
        </p>
      ) : null}

      {!child ? (
        <p className="text-sm text-[var(--muted)]">No children on household.</p>
      ) : events.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">
          No PTM events open for this class.
        </p>
      ) : (
        <div className="space-y-3">
          <label className="block text-xs text-[var(--muted)]">
            PTM event
            <select
              className={`${field} mt-1 w-full`}
              value={eventId}
              onChange={(e) => setEventId(e.target.value)}
            >
              {events.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} · {e.date} · {modeLabel(e.mode)}
                </option>
              ))}
            </select>
          </label>

          {booking ? (
            <div className="rounded-xl border border-[rgba(21,128,61,0.25)] bg-[rgba(21,128,61,0.06)] px-3 py-3">
              <p className="text-sm font-semibold text-[var(--brand-deep)]">
                Your booking
              </p>
              {(() => {
                const slot = ptm?.slots.find((s) => s.id === booking.slotId);
                return (
                  <p className="text-xs text-[var(--muted)]">
                    {slot
                      ? `${slot.startAt}–${slot.endAt} · ${slot.teacherName}`
                      : ""}{" "}
                    · {booking.status}
                  </p>
                );
              })()}
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" className={btnOutline} onClick={shareWhatsApp}>
                  Share on WhatsApp
                </button>
                {booking.status === "booked" ? (
                  <button
                    type="button"
                    className="text-xs text-[var(--danger)] underline"
                    onClick={cancelBooking}
                  >
                    Cancel booking
                  </button>
                ) : null}
              </div>
            </div>
          ) : (
            <>
              <p className="text-sm text-[var(--muted)]">
                Pick an available slot for {child.fullName}.
              </p>
              <ul className="space-y-1.5">
                {slots.length === 0 ? (
                  <li className="text-sm text-[var(--muted)]">
                    No slots published yet.
                  </li>
                ) : (
                  slots.map((s) => {
                    const booked = ptm ? slotBookedCount(ptm, s.id) : 0;
                    const full = booked >= s.capacity;
                    return (
                      <li
                        key={s.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[rgba(32,48,80,0.08)] bg-white px-3 py-2"
                      >
                        <span className="text-sm text-[var(--brand-deep)]">
                          {s.startAt}–{s.endAt} · {s.teacherName}
                          {s.roomOrLink ? ` · ${s.roomOrLink}` : ""}
                        </span>
                        <button
                          type="button"
                          className={full ? btnOutline : btn}
                          disabled={full}
                          onClick={() => bookSlot(s.id)}
                        >
                          {full ? "Full" : "Book"}
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
