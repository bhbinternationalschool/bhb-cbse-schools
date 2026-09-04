"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BarChart3,
  CalendarDays,
  CalendarHeart,
  Images,
  LayoutDashboard,
  ListChecks,
  Send,
  Trophy,
} from "lucide-react";
import { InterSchoolPanel } from "@/components/events/InterSchoolPanel";
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
import { loadFees, type FeesState } from "@/lib/fees";
import { loadExams, type ExamsState } from "@/lib/exams";
import { loadPtm, type PtmState } from "@/lib/ptm";
import { loadSchoolComms, type GalleryAlbum } from "@/lib/schoolComms";
import { useModuleTabQuery } from "@/lib/useModuleTabQuery";
import {
  EVENT_KINDS,
  eventKindLabel,
  listUpcomingCalendarItems,
  setEventsClientCache,
  type CalendarItem,
  type EventKind,
  type EventRsvp,
  type SchoolEvent,
} from "@/lib/events";

type EventsTab = "dashboard" | "calendar" | "events" | "rsvps" | "interschool";

const TAB_ITEMS: WorkspaceTabItem[] = [
  { id: "dashboard", label: "Dashboard", tone: "navy", icon: <LayoutDashboard /> },
  { id: "calendar", label: "Calendar", tone: "amber", icon: <CalendarDays /> },
  { id: "events", label: "Events", tone: "violet", icon: <CalendarHeart /> },
  { id: "rsvps", label: "RSVPs", tone: "teal", icon: <ListChecks /> },
  { id: "interschool", label: "Inter-school", tone: "green", icon: <Trophy /> },
];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function kindBadgeTone(kind: CalendarItem["kind"]): string {
  switch (kind) {
    case "event":
      return "bg-[var(--brand-gold)]/15 text-[#8a6d12]";
    case "holiday":
      return "bg-[var(--ok)]/15 text-[var(--ok)]";
    case "exam":
      return "bg-[rgba(91,33,182,0.12)] text-[#5b21b6]";
    case "ptm":
      return "bg-[rgba(2,132,199,0.12)] text-[#0369a1]";
    default:
      return "bg-[rgba(180,35,24,0.1)] text-[var(--danger)]";
  }
}

export function EventsWorkspace() {
  const session = useDemoSession();
  const readOnly = useSessionReadOnly();
  const ay = session.academicYearCode || DEFAULT_AY;
  const [tab, setTab] = useModuleTabQuery<EventsTab>("dashboard", [
    "dashboard",
    "calendar",
    "events",
    "rsvps",
    "interschool",
  ]);

  const [masters, setMasters] = useState<MastersState | null>(null);
  const [sis, setSis] = useState<SisState | null>(null);
  const [fees, setFees] = useState<FeesState | null>(null);
  const [examsState, setExamsState] = useState<ExamsState | null>(null);
  const [ptmState, setPtmState] = useState<PtmState | null>(null);
  const [albums, setAlbums] = useState<GalleryAlbum[]>([]);
  const [events, setEvents] = useState<SchoolEvent[]>([]);
  const [rsvps, setRsvps] = useState<EventRsvp[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedRsvpEventId, setSelectedRsvpEventId] = useState("");
  const [dashboardRefreshKey, setDashboardRefreshKey] = useState(0);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<EventKind>("function");
  const [startsOn, setStartsOn] = useState(todayIso());
  const [endsOn, setEndsOn] = useState("");
  const [startTime, setStartTime] = useState("");
  const [location, setLocation] = useState("");
  const [classIds, setClassIds] = useState<string[]>([]);
  const [rsvpEnabled, setRsvpEnabled] = useState(false);
  const [albumId, setAlbumId] = useState("");

  function flash(msg: string) {
    setNotice(msg);
    setError(null);
    window.setTimeout(() => setNotice(null), 2800);
  }

  const refreshLocal = useCallback(() => {
    setMasters(loadMasters());
    setSis(loadSis());
    setFees(loadFees());
    setExamsState(loadExams());
    setPtmState(loadPtm());
    setAlbums(loadSchoolComms().albums);
  }, []);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/school-data/events?academicYearCode=${encodeURIComponent(ay)}`,
      );
      const json = (await res.json()) as {
        ok?: boolean;
        events?: SchoolEvent[];
        rsvps?: EventRsvp[];
        error?: string;
      };
      if (!res.ok || !json.ok) {
        setError(json.error || "Could not load events");
        return;
      }
      setEvents(json.events ?? []);
      setRsvps(json.rsvps ?? []);
      setEventsClientCache(json.events ?? [], json.rsvps ?? []);
      setDashboardRefreshKey((k) => k + 1);
    } catch {
      setError("Could not load events");
    } finally {
      setLoading(false);
    }
  }, [ay]);

  useEffect(() => {
    refreshLocal();
    void fetchEvents();
  }, [refreshLocal, fetchEvents]);

  const classOptions = useMemo(() => {
    if (!masters) return [];
    return masters.classes.filter((c) => c.isActive !== false);
  }, [masters]);

  function classLabel(id: string): string {
    return classOptions.find((c) => c.id === id)?.name ?? id;
  }

  function toggleClass(id: string) {
    setClassIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function resetForm() {
    setEditingId(null);
    setTitle("");
    setDescription("");
    setKind("function");
    setStartsOn(todayIso());
    setEndsOn("");
    setStartTime("");
    setLocation("");
    setClassIds([]);
    setRsvpEnabled(false);
    setAlbumId("");
  }

  function beginEdit(e: SchoolEvent) {
    setEditingId(e.id);
    setTitle(e.title);
    setDescription(e.description);
    setKind(e.kind);
    setStartsOn(e.startsOn);
    setEndsOn(e.endsOn !== e.startsOn ? e.endsOn : "");
    setStartTime(e.startTime);
    setLocation(e.location);
    setClassIds(e.classIds);
    setRsvpEnabled(e.rsvpEnabled);
    setAlbumId(e.albumId);
  }

  async function saveEvent() {
    if (!title.trim() || !startsOn) {
      setError("Title and start date are required");
      return;
    }
    try {
      const res = await fetch("/api/school-data/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: editingId ?? undefined,
          academicYearCode: ay,
          title: title.trim(),
          description,
          kind,
          startsOn,
          endsOn: endsOn || startsOn,
          startTime,
          location,
          classIds,
          rsvpEnabled,
          albumId,
          isActive: true,
        }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setError(json.error || "Could not save event");
        return;
      }
      flash(editingId ? "Event updated" : "Event created");
      resetForm();
      await fetchEvents();
    } catch {
      setError("Could not save event");
    }
  }

  async function deleteEvent(id: string) {
    try {
      const res = await fetch(`/api/school-data/events?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setError(json.error || "Could not delete event");
        return;
      }
      if (editingId === id) resetForm();
      if (selectedRsvpEventId === id) setSelectedRsvpEventId("");
      flash("Event deleted");
      await fetchEvents();
    } catch {
      setError("Could not delete event");
    }
  }

  async function sendRsvpPrompts(id: string) {
    try {
      const res = await fetch("/api/school-data/events", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ eventId: id, action: "send_rsvp" }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        sent?: number;
        failed?: number;
        skippedNoMobile?: number;
      };
      if (!res.ok || !json.ok) {
        setError(json.error || "Could not send RSVP prompts");
        return;
      }
      flash(
        `RSVP sent to ${json.sent ?? 0} household${json.sent === 1 ? "" : "s"}` +
          (json.failed ? ` · ${json.failed} failed` : "") +
          (json.skippedNoMobile ? ` · ${json.skippedNoMobile} without WhatsApp` : ""),
      );
      await fetchEvents();
    } catch {
      setError("Could not send RSVP prompts");
    }
  }

  const calendarGroups = useMemo(() => {
    if (!masters || !sis || !fees || !examsState || !ptmState) {
      return { thisWeek: [] as CalendarItem[], thisMonth: [] as CalendarItem[] };
    }
    const from = todayIso();
    const weekEnd = addDaysIso(from, 6);
    const monthEnd = addDaysIso(from, 30);
    const items = listUpcomingCalendarItems({
      from,
      to: monthEnd,
      academicYearCode: ay,
      masters,
      sis,
      fees,
      examsState,
      ptmState,
      events,
    });
    return {
      thisWeek: items.filter((i) => i.date <= weekEnd),
      thisMonth: items.filter((i) => i.date > weekEnd),
    };
  }, [masters, sis, fees, examsState, ptmState, events, ay]);

  const rsvpEvents = useMemo(() => events.filter((e) => e.rsvpEnabled), [events]);

  useEffect(() => {
    if (!selectedRsvpEventId && rsvpEvents[0]) {
      setSelectedRsvpEventId(rsvpEvents[0].id);
    }
  }, [selectedRsvpEventId, rsvpEvents]);

  const rsvpTally = useMemo(() => {
    const rows = rsvps.filter((r) => r.eventId === selectedRsvpEventId);
    const counts = { yes: 0, no: 0, maybe: 0, pending: 0 };
    for (const r of rows) {
      if (r.choice === "yes") counts.yes += 1;
      else if (r.choice === "no") counts.no += 1;
      else if (r.choice === "maybe") counts.maybe += 1;
      else counts.pending += 1;
    }
    return { rows, counts };
  }, [rsvps, selectedRsvpEventId]);

  function householdLabel(householdId: string): string {
    const hh = sis?.households.find((h) => h.id === householdId);
    return hh?.guardianName || householdId;
  }

  if (loading && !masters) {
    return (
      <div className="flex items-center justify-center px-4 py-12 text-sm text-muted-foreground">
        Loading events…
      </div>
    );
  }

  return (
    <ErpWorkspaceShell
      title="Events & calendar"
      subtitle="School events, unified academic calendar and WhatsApp RSVP"
      icon={<CalendarHeart className="size-6" aria-hidden />}
      actions={
        <Link
          href="/reports?module=events"
          className={cn(buttonVariants({ variant: "outline" }))}
        >
          <BarChart3 className="size-4" />
          Reports Center
        </Link>
      }
      error={error}
      notice={notice}
    >
      <WorkspaceTabs
        value={tab}
        onValueChange={(value) => setTab(value as EventsTab)}
        items={TAB_ITEMS}
        aria-label="Events sections"
      >
        <TabsContent value="dashboard">
          <ModuleDashboardHost
            moduleId="events"
            refreshKey={dashboardRefreshKey}
            onNavigateTab={(t) => setTab(t as EventsTab)}
          />
        </TabsContent>

        <TabsContent value="calendar" className="space-y-6">
          {(
            [
              ["This week", calendarGroups.thisWeek],
              ["This month", calendarGroups.thisMonth],
            ] as const
          ).map(([label, items]) => (
            <div key={label} className="space-y-2">
              <h3 className="text-sm font-semibold text-[var(--brand-deep)]">{label}</h3>
              {items.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing scheduled.</p>
              ) : (
                <div className="grid gap-2">
                  {items.map((item) => (
                    <div
                      key={item.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[rgba(32,48,80,0.1)] px-3 py-2"
                    >
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className={kindBadgeTone(item.kind)}>
                          {item.kind === "fee_due" ? "Fees" : item.kind}
                        </Badge>
                        <span className="text-sm font-medium">{item.title}</span>
                        {item.detail ? (
                          <span className="text-xs text-muted-foreground">{item.detail}</span>
                        ) : null}
                      </div>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {item.date}
                        {item.endDate ? ` → ${item.endDate}` : ""}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </TabsContent>

        <TabsContent value="events" className="space-y-6">
          <div className="grid gap-3">
            {events.length === 0 ? (
              <p className="text-sm text-muted-foreground">No events yet.</p>
            ) : (
              events.map((e) => (
                <Card key={e.id} size="sm">
                  <CardHeader>
                    <CardTitle className="flex flex-wrap items-center gap-2">
                      {e.title}
                      <Badge variant="secondary">{eventKindLabel(e.kind)}</Badge>
                      {e.rsvpEnabled ? <Badge>RSVP on</Badge> : null}
                    </CardTitle>
                    <CardDescription>
                      <CalendarDays className="mr-1 inline size-3.5" />
                      {e.startsOn}
                      {e.endsOn !== e.startsOn ? ` → ${e.endsOn}` : ""}
                      {" · "}
                      {e.classIds.length
                        ? e.classIds.map(classLabel).join(", ")
                        : "All classes"}
                      {e.location ? ` · ${e.location}` : ""}
                    </CardDescription>
                  </CardHeader>
                  {e.description ? (
                    <CardContent className="pt-0 text-sm">{e.description}</CardContent>
                  ) : null}
                  <CardFooter className="flex flex-wrap gap-2 border-t-0 pt-0">
                    {e.rsvpEnabled ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={readOnly}
                        onClick={() => sendRsvpPrompts(e.id)}
                      >
                        <Send className="size-3.5" />
                        Send RSVP
                      </Button>
                    ) : null}
                    {e.albumId ? (
                      <Link
                        href={`/comms?tab=gallery&album=${encodeURIComponent(e.albumId)}`}
                        className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                      >
                        <Images className="size-3.5" />
                        View photos
                      </Link>
                    ) : null}
                    <DeskListActions
                      readOnly={readOnly}
                      onEdit={() => beginEdit(e)}
                      onDelete={() => deleteEvent(e.id)}
                      deleteConfirm={`Delete event "${e.title}"?`}
                    />
                  </CardFooter>
                </Card>
              ))
            )}
          </div>

          <Separator />

          <Card>
            <CardHeader>
              <CardTitle>{editingId ? "Edit event" : "New event"}</CardTitle>
              <CardDescription>
                Functions, sports day, trips and other school events.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid max-w-xl gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="evt-title">Title</Label>
                <Input
                  id="evt-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Annual Day"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="evt-start">Start date</Label>
                  <Input
                    id="evt-start"
                    type="date"
                    value={startsOn}
                    onChange={(e) => setStartsOn(e.target.value)}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="evt-end">End date</Label>
                  <Input
                    id="evt-end"
                    type="date"
                    value={endsOn}
                    onChange={(e) => setEndsOn(e.target.value)}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="evt-kind">Kind</Label>
                  <Select value={kind} onValueChange={(v) => setKind(v as EventKind)}>
                    <SelectTrigger id="evt-kind" className="w-full">
                      <SelectValue>{(v: EventKind) => eventKindLabel(v)}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {EVENT_KINDS.map((k) => (
                        <SelectItem key={k.id} value={k.id}>
                          {k.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="evt-time">Start time</Label>
                  <Input
                    id="evt-time"
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="evt-location">Location</Label>
                  <Input
                    id="evt-location"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="School auditorium"
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label>Classes (blank = all classes)</Label>
                <div className="flex flex-wrap gap-3">
                  {classOptions.map((c) => (
                    <label
                      key={c.id}
                      className="flex cursor-pointer items-center gap-2 text-sm"
                    >
                      <Checkbox
                        checked={classIds.includes(c.id)}
                        onCheckedChange={() => toggleClass(c.id)}
                      />
                      {c.name}
                    </label>
                  ))}
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="evt-album">Link photo album</Label>
                <Select value={albumId} onValueChange={(v) => setAlbumId(v ?? "")}>
                  <SelectTrigger id="evt-album" className="w-full">
                    <SelectValue placeholder="— none —">
                      {(v: string) => {
                        const a = albums.find((x) => x.id === v);
                        return a ? a.title : "— none —";
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">— none —</SelectItem>
                    {albums.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="evt-desc">Description</Label>
                <Textarea
                  id="evt-desc"
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox
                  checked={rsvpEnabled}
                  onCheckedChange={(v) => setRsvpEnabled(!!v)}
                />
                Collect WhatsApp RSVP for this event
              </label>
            </CardContent>
            <CardFooter className="flex flex-wrap gap-2">
              <Button type="button" onClick={saveEvent} disabled={readOnly}>
                {editingId ? "Save changes" : "Create event"}
              </Button>
              {editingId ? (
                <Button type="button" variant="outline" onClick={resetForm}>
                  Cancel
                </Button>
              ) : null}
            </CardFooter>
          </Card>
        </TabsContent>

        <TabsContent value="rsvps" className="space-y-4">
          {rsvpEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No events have RSVP enabled yet — turn it on from the Events tab.
            </p>
          ) : (
            <>
              <div className="grid max-w-sm gap-1.5">
                <Label htmlFor="rsvp-event">Event</Label>
                <Select
                  value={selectedRsvpEventId}
                  onValueChange={(v) => setSelectedRsvpEventId(v ?? "")}
                >
                  <SelectTrigger id="rsvp-event" className="w-full">
                    <SelectValue placeholder="Select event">
                      {(v: string) => {
                        const e = rsvpEvents.find((x) => x.id === v);
                        return e ? `${e.title} · ${e.startsOn}` : "Select event";
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {rsvpEvents.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.title} · {e.startsOn}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-wrap gap-3">
                <Badge className="bg-[var(--ok)]/15 text-[var(--ok)]">
                  Yes: {rsvpTally.counts.yes}
                </Badge>
                <Badge variant="destructive">No: {rsvpTally.counts.no}</Badge>
                <Badge variant="secondary">Maybe: {rsvpTally.counts.maybe}</Badge>
                <Badge variant="outline">Pending: {rsvpTally.counts.pending}</Badge>
              </div>

              <div className="grid gap-2">
                {rsvpTally.rows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No RSVP prompts sent yet for this event — use &ldquo;Send RSVP&rdquo; on the Events tab.
                  </p>
                ) : (
                  rsvpTally.rows.map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center justify-between rounded-lg border border-[rgba(32,48,80,0.1)] px-3 py-2 text-sm"
                    >
                      <span>{householdLabel(r.householdId)}</span>
                      <Badge
                        variant={
                          r.choice === "yes"
                            ? undefined
                            : r.choice === "no"
                              ? "destructive"
                              : r.choice === "maybe"
                                ? "secondary"
                                : "outline"
                        }
                      >
                        {r.choice ? r.choice : "Pending"}
                      </Badge>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="interschool" className="space-y-4">
          <InterSchoolPanel readOnly={readOnly} cashierName={session.fullName} />
        </TabsContent>
      </WorkspaceTabs>
    </ErpWorkspaceShell>
  );
}
