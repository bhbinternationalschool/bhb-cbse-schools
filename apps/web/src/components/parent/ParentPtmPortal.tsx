"use client";

import { useState } from "react";
import { btn, btnOutline, field } from "@/components/ui/erp-ui";
import {
  ChildPicker,
  Flash,
  ParentReadState,
  WithChildren,
  parentPost,
  useActiveChild,
  useFlash,
  useParentRead,
  useParentRefresh,
  type ParentChild,
} from "@/components/parent/parentData";

/** GET /api/v1/ptm/overview?studentId= — the app's PTM screen. */
type PtmOverview = {
  studentId: string | null;
  events: {
    id: string;
    name: string;
    date: string;
    endDate?: string;
    mode: string;
    modeLabel: string;
    note: string;
    myBooking: {
      id: string;
      slotId: string;
      status: string;
      bookedAt: string;
    } | null;
    slots: {
      id: string;
      teacherName: string;
      startAt: string;
      endAt: string;
      roomOrLink: string;
      capacity: number;
      seatsLeft: number;
    }[];
  }[];
};

/**
 * PTM for the parent's own child: events and slots read on the server; a
 * booking or cancellation is made by the server (POST /api/v1/ptm/book and
 * /cancel) and the page shows it only once the server has it.
 */
export function ParentPtmPortal() {
  return <WithChildren>{(list) => <PtmForFamily list={list} />}</WithChildren>;
}

function PtmForFamily({ list }: { list: ParentChild[] }) {
  const { child, setActiveId } = useActiveChild(list);
  return (
    <div className="px-4 pb-8 pt-3">
      <ChildPicker list={list} child={child} onPick={setActiveId} />
      {child ? <PtmFor child={child} key={child.id} /> : null}
    </div>
  );
}

function PtmFor({ child }: { child: ParentChild }) {
  const key = ["ptm", child.id] as const;
  const overview = useParentRead<PtmOverview>(
    key,
    `/api/v1/ptm/overview?studentId=${encodeURIComponent(child.id)}`,
    (v) => Array.isArray(v.events),
    "PTM",
  );
  const refresh = useParentRefresh();
  const flash = useFlash();
  const [eventId, setEventId] = useState("");
  const [busy, setBusy] = useState(false);

  async function book(evId: string, slotId: string) {
    setBusy(true);
    const r = await parentPost("/api/v1/ptm/book", {
      eventId: evId,
      slotId,
      studentId: child.id,
    });
    setBusy(false);
    if (!r.ok) return flash.fail(r.error);
    await refresh(key);
    flash.ok("Slot booked");
  }

  async function cancel(bookingId: string) {
    setBusy(true);
    const r = await parentPost("/api/v1/ptm/cancel", { bookingId });
    setBusy(false);
    if (!r.ok) return flash.fail(r.error);
    await refresh(key);
    flash.ok("Booking cancelled");
  }

  return (
    <ParentReadState query={overview} what="PTM">
      {(o) => {
        if (o.events.length === 0) {
          return (
            <p className="text-sm text-[var(--muted)]">
              No PTM events open for this class.
            </p>
          );
        }
        const ev = o.events.find((e) => e.id === eventId) ?? o.events[0]!;
        const myBooking = ev.myBooking;
        const bookedSlot = myBooking
          ? ev.slots.find((s) => s.id === myBooking.slotId)
          : null;
        return (
          <div className="space-y-3" data-testid="parent-ptm">
            <Flash notice={flash.notice} error={flash.error} />
            <label className="block text-xs text-[var(--muted)]">
              PTM event
              <select
                className={`${field} mt-1 w-full`}
                value={ev.id}
                onChange={(e) => setEventId(e.target.value)}
              >
                {o.events.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} · {e.date} · {e.modeLabel}
                  </option>
                ))}
              </select>
            </label>
            {ev.note ? (
              <p className="text-xs text-[var(--muted)]">{ev.note}</p>
            ) : null}
            {myBooking && myBooking.status !== "cancelled" ? (
              <div className="rounded-xl border border-[rgba(21,128,61,0.25)] bg-[rgba(21,128,61,0.06)] px-3 py-3">
                <p className="text-sm font-semibold text-[var(--brand-deep)]">
                  Your booking
                </p>
                <p
                  className="text-xs text-[var(--muted)]"
                  data-testid="parent-ptm-booking"
                >
                  {bookedSlot
                    ? `${bookedSlot.startAt}–${bookedSlot.endAt} · ${bookedSlot.teacherName}`
                    : ""}{" "}
                  · {myBooking.status}
                </p>
                {myBooking.status === "booked" ? (
                  <button
                    type="button"
                    className="mt-2 text-xs text-[var(--danger)] underline"
                    disabled={busy}
                    onClick={() => void cancel(myBooking.id)}
                  >
                    Cancel booking
                  </button>
                ) : null}
              </div>
            ) : (
              <>
                <p className="text-sm text-[var(--muted)]">
                  Pick an available slot for {child.fullName}.
                </p>
                <ul className="space-y-1.5">
                  {ev.slots.length === 0 ? (
                    <li className="text-sm text-[var(--muted)]">
                      No slots published yet.
                    </li>
                  ) : (
                    ev.slots.map((s) => {
                      const full = s.seatsLeft <= 0;
                      return (
                        <li
                          key={s.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[rgba(32,48,80,0.08)] bg-[var(--card)] px-3 py-2"
                        >
                          <span className="text-sm text-[var(--brand-deep)]">
                            {s.startAt}–{s.endAt} · {s.teacherName}
                            {s.roomOrLink ? ` · ${s.roomOrLink}` : ""}
                          </span>
                          <button
                            type="button"
                            className={full ? btnOutline : btn}
                            disabled={full || busy}
                            onClick={() => void book(ev.id, s.id)}
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
        );
      }}
    </ParentReadState>
  );
}
