"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BarChart3,
  CalendarDays,
  ClipboardList,
  LayoutDashboard,
  MessageSquare,
  Star,
  UsersRound,
} from "lucide-react";
import { useDemoSession, useSessionReadOnly } from "@/components/shell/SessionContext";
import { ModuleDashboardHost } from "@/components/dashboard/ModuleDashboardHost";
import { ErpWorkspaceShell } from "@/components/ui/erp-workspace-shell";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { TabsContent, WorkspaceTabs, type WorkspaceTabItem } from "@/components/ui/workspace-tabs";
import { Textarea } from "@/components/ui/textarea";
import { DeskListActions } from "@/components/ui/desk-list-actions";
import { cn } from "@/lib/utils";
import { DEFAULT_AY, loadMasters, type MastersState } from "@/lib/masters";
import { loadSis, type SisState } from "@/lib/sis";
import { useModuleTabQuery } from "@/lib/useModuleTabQuery";
import {
  addPtmSlots,
  cancelPtmBooking,
  composeWhatsAppPtmConfirm,
  composeWhatsAppPtmReminder,
  createPtmEvent,
  deletePtmEvent,
  deletePtmSlot,
  markPtmWhatsApp,
  modeLabel,
  PTM_REPORTS,
  ptmBookingMobile,
  runPtmReport,
  savePtmFeedback,
  seedPtmIfEmpty,
  setPtmBookingStatus,
  slotBookedCount,
  updatePtmEvent,
  type PtmMode,
  type PtmEvent,
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

const TAB_ITEMS: WorkspaceTabItem[] = [
  { id: "dashboard", label: "Dashboard", tone: "navy", icon: <LayoutDashboard /> },
  { id: "events", label: "Events", tone: "navy", icon: <CalendarDays /> },
  { id: "slots", label: "Slots", tone: "teal", icon: <ClipboardList /> },
  { id: "bookings", label: "Bookings", tone: "amber", icon: <UsersRound /> },
  { id: "feedback", label: "Feedback", tone: "green", icon: <Star /> },
  { id: "reports", label: "Reports", tone: "slate", icon: <BarChart3 /> },
];

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

function bookingStatusBadge(status: string) {
  switch (status) {
    case "booked":
      return <Badge>Booked</Badge>;
    case "completed":
      return (
        <Badge variant="secondary" className="bg-[var(--ok)]/15 text-[var(--ok)]">
          Completed
        </Badge>
      );
    case "no_show":
      return <Badge variant="outline">No-show</Badge>;
    case "cancelled":
      return <Badge variant="destructive">Cancelled</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

export function PtmWorkspace() {
  const session = useDemoSession();
  const readOnly = useSessionReadOnly();
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

  const [evName, setEvName] = useState("");
  const [evDate, setEvDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [evEndDate, setEvEndDate] = useState("");
  const [evMode, setEvMode] = useState<PtmMode>("in_person");
  const [evNote, setEvNote] = useState("");
  const [evClassIds, setEvClassIds] = useState<string[]>([]);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);

  const [slotTeacherId, setSlotTeacherId] = useState("");
  const [slotStarts, setSlotStarts] = useState("10:00,10:15,10:30");
  const [slotRoom, setSlotRoom] = useState("Room 12");

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

  function resetEventForm() {
    setEditingEventId(null);
    setEvName("");
    setEvDate(new Date().toISOString().slice(0, 10));
    setEvEndDate("");
    setEvMode("in_person");
    setEvNote("");
    setEvClassIds([]);
  }

  function beginEditEvent(e: PtmEvent) {
    setEditingEventId(e.id);
    setEvName(e.name);
    setEvDate(e.date);
    setEvEndDate(e.endDate !== e.date ? e.endDate : "");
    setEvMode(e.mode);
    setEvNote(e.note);
    setEvClassIds(e.classIds);
    setEventId(e.id);
  }

  function createEvent() {
    if (editingEventId) {
      const r = updatePtmEvent({
        id: editingEventId,
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
      resetEventForm();
      refresh();
      flash("PTM event updated");
      return;
    }
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
    resetEventForm();
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
      <div className="flex items-center justify-center px-4 py-12 text-sm text-muted-foreground">
        Loading PTM…
      </div>
    );
  }

  return (
    <ErpWorkspaceShell
      title="PTM scheduler"
      subtitle="Parent–teacher meetings · slots · bookings · feedback"
      icon={<UsersRound className="size-6" aria-hidden />}
      actions={
        <Link
          href="/reports?module=ptm"
          className={cn(buttonVariants({ variant: "outline" }))}
        >
          <BarChart3 className="size-4" />
          Reports Center
        </Link>
      }
      error={error}
      notice={notice}
      toolbar={
        activeEvents.length > 0 ? (
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="ptm-active-event">Active event</Label>
              <Select
                value={eventId}
                onValueChange={(v) => setEventId(v ?? "")}
              >
                <SelectTrigger id="ptm-active-event" className="min-w-56">
                  <SelectValue placeholder="Select event" />
                </SelectTrigger>
                <SelectContent>
                  {activeEvents.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.name} · {e.date}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedEvent ? (
              <Badge variant="secondary" className="mb-1">
                {modeLabel(selectedEvent.mode)}
              </Badge>
            ) : null}
          </div>
        ) : null
      }
    >
      <WorkspaceTabs
        value={tab}
        onValueChange={(value) => setTab(value as PtmTab)}
        items={TAB_ITEMS}
        aria-label="PTM sections"
      >

        <TabsContent value="dashboard">
          <ModuleDashboardHost
            moduleId="ptm"
            onNavigateTab={(t) => setTab(t as PtmTab)}
          />
        </TabsContent>

        <TabsContent value="events" className="space-y-6">
          <div className="grid gap-3">
            {state.events.length === 0 ? (
              <p className="text-sm text-muted-foreground">No events yet.</p>
            ) : (
              state.events.map((e) => (
                <Card key={e.id} size="sm">
                  <CardHeader>
                    <CardTitle className="flex flex-wrap items-center gap-2">
                      {e.name}
                      {!e.isActive ? (
                        <Badge variant="outline">Inactive</Badge>
                      ) : (
                        <Badge variant="secondary">{modeLabel(e.mode)}</Badge>
                      )}
                    </CardTitle>
                    <CardDescription>
                      <CalendarDays className="mr-1 inline size-3.5" />
                      {e.date}
                      {e.endDate !== e.date ? ` → ${e.endDate}` : ""}
                      {" · "}
                      {e.classIds.length
                        ? e.classIds
                            .map(
                              (id) =>
                                classOptions.find((c) => c.id === id)?.name,
                            )
                            .filter(Boolean)
                            .join(", ")
                        : "All classes"}
                    </CardDescription>
                  </CardHeader>
                  {e.note ? (
                    <CardContent className="pt-0 text-sm">{e.note}</CardContent>
                  ) : null}
                  <CardFooter className="border-t-0 pt-0">
                    <DeskListActions
                      readOnly={readOnly}
                      onEdit={() => beginEditEvent(e)}
                      onDelete={() => {
                        const r = deletePtmEvent(e.id);
                        if (!r.ok) setError(r.error);
                        else {
                          if (eventId === e.id) setEventId("");
                          if (editingEventId === e.id) resetEventForm();
                          refresh();
                          flash("Event deleted");
                        }
                      }}
                      deleteConfirm={`Delete PTM event "${e.name}"?`}
                    />
                  </CardFooter>
                </Card>
              ))
            )}
          </div>

          <Separator />

          <Card>
            <CardHeader>
              <CardTitle>{editingEventId ? "Edit PTM event" : "New PTM event"}</CardTitle>
              <CardDescription>
                Schedule a parent–teacher meeting for selected classes.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid max-w-xl gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="ev-name">Name</Label>
                <Input
                  id="ev-name"
                  value={evName}
                  onChange={(e) => setEvName(e.target.value)}
                  placeholder="Term PTM"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="ev-date">Date</Label>
                  <Input
                    id="ev-date"
                    type="date"
                    value={evDate}
                    onChange={(e) => setEvDate(e.target.value)}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="ev-end">End date</Label>
                  <Input
                    id="ev-end"
                    type="date"
                    value={evEndDate}
                    onChange={(e) => setEvEndDate(e.target.value)}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="ev-mode">Mode</Label>
                  <Select
                    value={evMode}
                    onValueChange={(v) => setEvMode(v as PtmMode)}
                  >
                    <SelectTrigger id="ev-mode" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="in_person">In person</SelectItem>
                      <SelectItem value="video">Video</SelectItem>
                      <SelectItem value="phone">Phone</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-2">
                <Label>Classes</Label>
                <div className="flex flex-wrap gap-3">
                  {classOptions.map((c) => (
                    <label
                      key={c.id}
                      className="flex cursor-pointer items-center gap-2 text-sm"
                    >
                      <Checkbox
                        checked={evClassIds.includes(c.id)}
                        onCheckedChange={() => toggleClass(c.id)}
                      />
                      {c.name}
                    </label>
                  ))}
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ev-note">Note</Label>
                <Textarea
                  id="ev-note"
                  rows={2}
                  value={evNote}
                  onChange={(e) => setEvNote(e.target.value)}
                />
              </div>
            </CardContent>
            <CardFooter className="flex flex-wrap gap-2">
              <Button type="button" onClick={createEvent} disabled={readOnly}>
                {editingEventId ? "Save changes" : "Create event"}
              </Button>
              {editingEventId ? (
                <Button type="button" variant="outline" onClick={resetEventForm}>
                  Cancel
                </Button>
              ) : null}
            </CardFooter>
          </Card>
        </TabsContent>

        <TabsContent value="slots" className="space-y-6">
          {!eventId ? (
            <p className="text-sm text-muted-foreground">Create an event first.</p>
          ) : (
            <>
              <div className="grid gap-2">
                {eventSlots.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No slots yet.</p>
                ) : (
                  eventSlots.map((s) => {
                    const booked = slotBookedCount(state, s.id);
                    return (
                      <Card key={s.id} size="sm">
                        <CardContent className="flex flex-wrap items-center justify-between gap-2 py-3">
                          <span className="text-sm font-medium">
                            {s.teacherName} · {s.startAt}–{s.endAt}
                            {s.roomOrLink ? ` · ${s.roomOrLink}` : ""}
                          </span>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline">
                              {booked}/{s.capacity} booked
                            </Badge>
                            {!readOnly && booked === 0 ? (
                              <button
                                type="button"
                                className="text-xs font-semibold text-[#b42318]"
                                onClick={() => {
                                  if (!window.confirm("Delete this slot?")) return;
                                  const r = deletePtmSlot(s.id);
                                  if (!r.ok) setError(r.error);
                                  else {
                                    refresh();
                                    flash("Slot deleted");
                                  }
                                }}
                              >
                                Delete
                              </button>
                            ) : null}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })
                )}
              </div>

              <Separator />

              <Card>
                <CardHeader>
                  <CardTitle>Add slots</CardTitle>
                  <CardDescription>
                    Comma-separated start times for the selected teacher.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid max-w-xl gap-4">
                  <div className="grid gap-1.5">
                    <Label htmlFor="slot-teacher">Teacher</Label>
                    <Select
                      value={slotTeacherId}
                      onValueChange={(v) => setSlotTeacherId(v ?? "")}
                    >
                      <SelectTrigger id="slot-teacher" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {staffOptions.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.fullName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="slot-starts">Start times</Label>
                    <Input
                      id="slot-starts"
                      value={slotStarts}
                      onChange={(e) => setSlotStarts(e.target.value)}
                      placeholder="10:00,10:15,10:30"
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="slot-room">Room / link</Label>
                    <Input
                      id="slot-room"
                      value={slotRoom}
                      onChange={(e) => setSlotRoom(e.target.value)}
                    />
                  </div>
                </CardContent>
                <CardFooter>
                  <Button type="button" onClick={addSlots}>
                    Add slots
                  </Button>
                </CardFooter>
              </Card>
            </>
          )}
        </TabsContent>

        <TabsContent value="bookings" className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
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
              <MessageSquare className="size-4" />
              Remind all booked
            </Button>
          </div>

          {eventBookings.length === 0 ? (
            <p className="text-sm text-muted-foreground">No bookings yet.</p>
          ) : (
            eventBookings.map((b) => {
              const slot = state.slots.find((s) => s.id === b.slotId);
              return (
                <Card key={b.id}>
                  <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
                    <div className="space-y-1">
                      <CardTitle className="text-base">
                        {studentLabel(masters, sis, b.studentId)}
                      </CardTitle>
                      <CardDescription>
                        {b.parentName}
                        {slot
                          ? ` · ${slot.startAt}–${slot.endAt} · ${slot.teacherName}`
                          : ""}
                        {b.whatsappConfirmedAt ? " · WA confirmed" : ""}
                        {b.whatsappRemindedAt ? " · reminded" : ""}
                      </CardDescription>
                    </div>
                    {bookingStatusBadge(b.status)}
                  </CardHeader>
                  {b.status === "booked" ? (
                    <CardFooter className="flex flex-wrap gap-2 border-t-0 pt-0">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
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
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
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
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setPtmBookingStatus(b.id, "completed");
                          refresh();
                          flash("Marked completed");
                        }}
                      >
                        Complete
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setPtmBookingStatus(b.id, "no_show");
                          refresh();
                          flash("Marked no-show");
                        }}
                      >
                        No-show
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={() => {
                          cancelPtmBooking(b.id);
                          refresh();
                          flash("Cancelled");
                        }}
                      >
                        Cancel
                      </Button>
                    </CardFooter>
                  ) : null}
                </Card>
              );
            })
          )}
        </TabsContent>

        <TabsContent value="feedback" className="space-y-6">
          <Card className="max-w-xl">
            <CardHeader>
              <CardTitle>Meeting feedback</CardTitle>
              <CardDescription>
                Record strengths, areas to improve, and follow-up actions.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="fb-booking">Booking</Label>
                <Select
                  value={fbBookingId}
                  onValueChange={(v) => setFbBookingId(v ?? "")}
                >
                  <SelectTrigger id="fb-booking" className="w-full">
                    <SelectValue placeholder="Select booking…" />
                  </SelectTrigger>
                  <SelectContent>
                    {eventBookings
                      .filter(
                        (b) =>
                          b.status === "booked" || b.status === "completed",
                      )
                      .map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {studentLabel(masters, sis, b.studentId)} · {b.status}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="fb-strengths">Strengths</Label>
                <Textarea
                  id="fb-strengths"
                  rows={2}
                  value={fbStrengths}
                  onChange={(e) => setFbStrengths(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="fb-areas">Areas to improve</Label>
                <Textarea
                  id="fb-areas"
                  rows={2}
                  value={fbAreas}
                  onChange={(e) => setFbAreas(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="fb-follow">Follow-up</Label>
                <Textarea
                  id="fb-follow"
                  rows={2}
                  value={fbFollowUp}
                  onChange={(e) => setFbFollowUp(e.target.value)}
                />
              </div>
            </CardContent>
            <CardFooter>
              <Button type="button" onClick={saveFeedback}>
                Save feedback
              </Button>
            </CardFooter>
          </Card>

          {state.feedback.length > 0 ? (
            <div className="grid max-w-xl gap-2">
              <h2 className="text-sm font-semibold text-primary">
                Recent feedback
              </h2>
              {state.feedback.slice(0, 10).map((f) => (
                <Card key={f.id} size="sm">
                  <CardHeader>
                    <CardTitle className="text-sm">
                      {studentLabel(masters, sis, f.studentId)}
                    </CardTitle>
                    <CardDescription>
                      {f.createdBy} · {f.createdAt.slice(0, 10)}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-1 pt-0 text-sm">
                    {f.strengths ? <p>+ {f.strengths}</p> : null}
                    {f.areas ? <p>− {f.areas}</p> : null}
                    {f.followUp ? (
                      <p className="text-muted-foreground">{f.followUp}</p>
                    ) : null}
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : null}
        </TabsContent>

        <TabsContent value="reports" className="space-y-4">
          <div className="grid max-w-xs gap-1.5">
            <Label htmlFor="report-format">Export format</Label>
            <Select
              value={reportFormat}
              onValueChange={(v) => setReportFormat(v as "excel" | "pdf")}
            >
              <SelectTrigger id="report-format" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="excel">Excel</SelectItem>
                <SelectItem value="pdf">PDF</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            {PTM_REPORTS.map((r) => (
              <Card key={r.id} size="sm">
                <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div>
                    <p className="text-sm font-medium">{r.label}</p>
                    {r.hint ? (
                      <p className="text-xs text-muted-foreground">{r.hint}</p>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    size="sm"
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
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </WorkspaceTabs>
    </ErpWorkspaceShell>
  );
}
