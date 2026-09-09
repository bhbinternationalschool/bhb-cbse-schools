"use client";

/**
 * Online classes — the office's and the teacher's desk.
 *
 * One list, four windows (today / week / upcoming / past), a scheduling
 * dialog that can be filled from the bell so "Period 3 on Thursday" is two
 * clicks, and an attendance drawer that shows the section roster against
 * who actually tapped Join. Everything goes through /api/v1/staff/online-
 * classes, the same routes the phone uses, so the two never disagree.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Video, RefreshCw, Plus, Copy, Users, Play, Square, Ban, RotateCcw, Megaphone, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { ErpControlBar, type RowAction } from "@/components/ui/erp-grid";
import { ErpWorkspaceShell } from "@/components/ui/erp-workspace-shell";
import { ModuleTabs } from "@/components/ui/ModuleTabs";
import { field } from "@/components/ui/erp-ui";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  minutesToTime,
  phaseLabel,
  timeToMinutes,
  type OnlineClassPhase,
  type OnlineClassProvider,
  type OnlineClassSession,
} from "@/lib/onlineClasses";

type Row = OnlineClassSession & {
  className: string;
  sectionName: string;
  subjectName: string;
  teacherName: string;
  phase: OnlineClassPhase;
  joinedCount: number;
};

type Listing = {
  today: string;
  range: string;
  staffId: string;
  unrestricted: boolean;
  canSchedule: boolean;
  sessions: Row[];
  sections: { classId: string; sectionId: string; className: string; sectionName: string }[];
  subjects: { id: string; name: string }[];
  teachers: { id: string; fullName: string }[];
  bell: { no: number; label: string; startTime: string; endTime: string }[];
  google: { oauthConfigured: boolean; connected: boolean; email: string; canMeet: boolean; connectUrl: string };
};

type AttendanceRow = {
  studentId: string;
  fullName: string;
  rollNo: string;
  joined: boolean;
  source: string;
  firstJoinedAt: string;
  minutes: number;
};

type Attendance = {
  sessionId: string;
  status: string;
  provider: string;
  canSync: boolean;
  attendanceSyncedAt: string;
  total: number;
  joined: number;
  rows: AttendanceRow[];
};

const RANGES = [
  { id: "today", label: "Today" },
  { id: "week", label: "This week" },
  { id: "upcoming", label: "Upcoming" },
  { id: "past", label: "Past" },
];

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
  });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    data?: T;
    error?: { message?: string; details?: { reason?: string } };
  };
  if (!res.ok || !json.ok) {
    const err = new Error(json.error?.message || `HTTP ${res.status}`) as Error & {
      reason?: string;
    };
    err.reason = json.error?.details?.reason;
    throw err;
  }
  return json.data as T;
}

function fmtDate(d: string): string {
  const [y, m, day] = d.split("-");
  const dt = new Date(`${d}T00:00:00+05:30`);
  const wd = dt.toLocaleDateString("en-IN", { weekday: "short", timeZone: "Asia/Kolkata" });
  return `${wd} ${day}/${m}/${y.slice(2)}`;
}

function fmt12(t: string): string {
  const [h, m] = t.split(":").map(Number);
  if (Number.isNaN(h)) return t;
  const ap = h >= 12 ? "PM" : "AM";
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${ap}`;
}

function phaseVariant(p: OnlineClassPhase): "default" | "secondary" | "destructive" | "outline" {
  if (p === "live") return "default";
  if (p === "joinable") return "secondary";
  if (p === "cancelled") return "destructive";
  return "outline";
}

function todayIst(): string {
  return new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
}

export function OnlineClassesWorkspace() {
  const [range, setRange] = useState("week");
  const [data, setData] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sectionFilter, setSectionFilter] = useState("");
  const [search, setSearch] = useState("");
  const [scheduling, setScheduling] = useState(false);
  const [attendanceFor, setAttendanceFor] = useState<Row | null>(null);
  const [confirm, setConfirm] = useState<{ row: Row; action: "cancel" | "end" } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams({ range });
      if (sectionFilter) q.set("sectionId", sectionFilter);
      setData(await api<Listing>(`/api/v1/staff/online-classes?${q}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load online classes");
    } finally {
      setLoading(false);
    }
  }, [range, sectionFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  // The Google callback lands back here with ?connected=1 or ?error=.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const p = new URLSearchParams(window.location.search);
    if (p.get("connected")) setNotice("Google connected — Meet rooms can now be created.");
    const err = p.get("error");
    if (err) setError(`Google: ${err}`);
    if (p.get("connected") || err) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  const act = useCallback(
    async (row: Row, action: "start" | "end" | "cancel" | "reopen") => {
      setError(null);
      try {
        await api(`/api/v1/staff/online-classes`, {
          method: "PATCH",
          body: JSON.stringify({ id: row.id, action }),
        });
        if (action === "start" && row.joinUrl) {
          window.open(row.joinUrl, "_blank", "noopener");
        }
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not update the class");
      }
    },
    [load],
  );

  const announce = useCallback(
    async (row: Row) => {
      setError(null);
      try {
        const r = await api<{ announced: { households: number; sent: number } | null }>(
          `/api/v1/staff/online-classes`,
          { method: "PATCH", body: JSON.stringify({ id: row.id, announce: true }) },
        );
        setNotice(
          r.announced && r.announced.households
            ? `Announced to ${r.announced.households} households (${r.announced.sent} devices reached).`
            : "Already announced — parents are told once per class.",
        );
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not announce");
      }
    },
    [load],
  );

  const rows = useMemo(() => {
    const list = data?.sessions ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((r) =>
      [r.title, r.className, r.sectionName, r.subjectName, r.teacherName, r.date]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [data, search]);

  const columns: DataTableColumn<Row>[] = [
    {
      key: "date",
      header: "Date",
      value: (r) => `${r.date} ${r.startTime}`,
      sortable: true,
      render: (r) => (
        <div>
          <div className="font-medium">{fmtDate(r.date)}</div>
          <div className="text-xs text-muted-foreground">
            {fmt12(r.startTime)} – {fmt12(r.endTime)}
            {r.periodNo ? ` · P${r.periodNo}` : ""}
          </div>
        </div>
      ),
    },
    {
      key: "class",
      header: "Class",
      value: (r) => `${r.className} ${r.sectionName}`,
      sortable: true,
    },
    {
      key: "subject",
      header: "Subject / title",
      value: (r) => r.title || r.subjectName,
      sortable: true,
      render: (r) => (
        <div>
          <div>{r.title || r.subjectName || "—"}</div>
          {r.title && r.subjectName ? (
            <div className="text-xs text-muted-foreground">{r.subjectName}</div>
          ) : null}
        </div>
      ),
    },
    { key: "teacher", header: "Teacher", value: (r) => r.teacherName, sortable: true },
    {
      key: "where",
      header: "Where",
      value: (r) => (r.provider === "google_meet" ? "Google Meet" : "Link"),
      render: (r) => (
        <span className="text-sm">
          {r.provider === "google_meet" ? "Google Meet" : "Link"}
          {r.meetingCode ? (
            <span className="ml-1 text-xs text-muted-foreground">{r.meetingCode}</span>
          ) : null}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      value: (r) => phaseLabel(r.phase),
      sortable: true,
      render: (r) => (
        <Badge variant={phaseVariant(r.phase)}>
          {phaseLabel(r.phase)}
          {r.announcedAt ? "" : r.phase === "upcoming" ? " · not announced" : ""}
        </Badge>
      ),
    },
    {
      key: "joined",
      header: "Joined",
      align: "right",
      value: (r) => r.joinedCount,
      sortable: true,
      render: (r) => (
        <button
          type="button"
          className="tabular-nums underline-offset-2 hover:underline"
          onClick={() => setAttendanceFor(r)}
        >
          {r.joinedCount}
        </button>
      ),
    },
  ];

  const rowActions: RowAction<Row>[] = [
    {
      id: "join",
      label: "Open the room",
      icon: <ExternalLink className="size-4" aria-hidden />,
      onSelect: (r) => window.open(r.joinUrl, "_blank", "noopener"),
      hidden: (r) => !r.joinUrl || r.phase === "cancelled",
    },
    {
      id: "start",
      label: "Start class",
      icon: <Play className="size-4" aria-hidden />,
      onSelect: (r) => void act(r, "start"),
      hidden: (r) => r.status !== "scheduled",
    },
    {
      id: "end",
      label: "End class",
      icon: <Square className="size-4" aria-hidden />,
      onSelect: (r) => setConfirm({ row: r, action: "end" }),
      hidden: (r) => r.status !== "live",
    },
    {
      id: "attendance",
      label: "Who joined",
      icon: <Users className="size-4" aria-hidden />,
      onSelect: (r) => setAttendanceFor(r),
    },
    {
      id: "announce",
      label: "Announce to parents",
      icon: <Megaphone className="size-4" aria-hidden />,
      onSelect: (r) => void announce(r),
      hidden: (r) => !!r.announcedAt || r.status === "cancelled" || r.status === "ended",
    },
    {
      id: "copy",
      label: "Copy link",
      icon: <Copy className="size-4" aria-hidden />,
      onSelect: (r) => {
        void navigator.clipboard?.writeText(r.joinUrl);
        setNotice("Link copied.");
      },
      hidden: (r) => !r.joinUrl,
    },
    {
      id: "reopen",
      label: "Reopen",
      icon: <RotateCcw className="size-4" aria-hidden />,
      onSelect: (r) => void act(r, "reopen"),
      hidden: (r) => r.status !== "ended" && r.status !== "cancelled",
    },
    {
      id: "cancel",
      label: "Cancel class",
      icon: <Ban className="size-4" aria-hidden />,
      tone: "danger",
      separatorAbove: true,
      onSelect: (r) => setConfirm({ row: r, action: "cancel" }),
      hidden: (r) => r.status === "cancelled" || r.status === "ended",
    },
  ];

  const google = data?.google;

  return (
    <ErpWorkspaceShell
      title="Online classes"
      subtitle="Schedule a live class for a section, announce it to parents' phones, and see who joined."
      icon={<Video className="size-5" aria-hidden />}
      error={error}
      notice={notice}
      actions={
        <div className="flex items-center gap-2">
          {google ? (
            google.connected ? (
              <span className="text-xs text-muted-foreground">
                Google: {google.email}
                {google.canMeet ? "" : " (reconnect for Meet)"}
              </span>
            ) : google.oauthConfigured ? (
              <a className="text-xs underline" href={google.connectUrl}>
                Connect Google to create Meet rooms
              </a>
            ) : null
          ) : null}
          {data?.canSchedule ? (
            <Button size="sm" onClick={() => setScheduling(true)}>
              <Plus className="size-4" aria-hidden /> Schedule a class
            </Button>
          ) : null}
        </div>
      }
    >
      <ModuleTabs
        items={RANGES.map((r) => ({ id: r.id, label: r.label }))}
        value={range}
        onChange={setRange}
        aria-label="Time window"
      />
      <DataTable<Row>
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        loading={loading}
        emptyTitle={
          range === "past" ? "No classes were held in this window" : "No online classes scheduled"
        }
        emptyDescription={
          data?.canSchedule
            ? "Schedule one — the section's parents get a notification with the time, and the link opens ten minutes before."
            : undefined
        }
        exportFileBaseName="online-classes"
        exportTitle="Online classes"
        rowActions={rowActions}
        toolbar={
          <ErpControlBar
            search={{ value: search, onChange: setSearch, placeholder: "Search class, subject, teacher…" }}
            filters={
              <select
                className={`${field} h-8 w-44`}
                value={sectionFilter}
                onChange={(e) => setSectionFilter(e.target.value)}
                aria-label="Section"
              >
                <option value="">All sections</option>
                {(data?.sections ?? []).map((s) => (
                  <option key={s.sectionId} value={s.sectionId}>
                    {s.className} {s.sectionName}
                  </option>
                ))}
              </select>
            }
            actions={
              <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
                <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} aria-hidden />{" "}
                Refresh
              </Button>
            }
            summary={
              data ? (
                <span className="text-xs text-muted-foreground">
                  {rows.length} of {data.sessions.length} shown
                </span>
              ) : null
            }
          />
        }
      />

      {scheduling && data ? (
        <ScheduleDialog
          listing={data}
          onClose={() => setScheduling(false)}
          onCreated={(msg) => {
            setScheduling(false);
            setNotice(msg);
            void load();
          }}
        />
      ) : null}

      {attendanceFor ? (
        <AttendanceDialog row={attendanceFor} onClose={() => setAttendanceFor(null)} onChanged={() => void load()} />
      ) : null}

      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm?.action === "cancel" ? "Cancel this class?" : "End this class?"}
        description={
          confirm
            ? confirm.action === "cancel"
              ? `${confirm.row.className} ${confirm.row.sectionName} · ${fmtDate(confirm.row.date)} ${fmt12(confirm.row.startTime)}. Parents will see it as cancelled; nobody is notified automatically.`
              : "Marks the class as over. Parents can no longer join from the app."
            : ""
        }
        confirmLabel={confirm?.action === "cancel" ? "Cancel class" : "End class"}
        tone={confirm?.action === "cancel" ? "danger" : "default"}
        onConfirm={async () => {
          if (!confirm) return;
          const c = confirm;
          setConfirm(null);
          await act(c.row, c.action);
        }}
      />
    </ErpWorkspaceShell>
  );
}

// ─── Schedule dialog ─────────────────────────────────────────────────

function ScheduleDialog({
  listing,
  onClose,
  onCreated,
}: {
  listing: Listing;
  onClose: () => void;
  onCreated: (msg: string) => void;
}) {
  const first = listing.sections[0];
  const [sectionKey, setSectionKey] = useState(first ? `${first.classId}|${first.sectionId}` : "");
  const [subjectId, setSubjectId] = useState("");
  const [teacherId, setTeacherId] = useState(listing.staffId);
  const [date, setDate] = useState(todayIst());
  const [periodNo, setPeriodNo] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [title, setTitle] = useState("");
  const [provider, setProvider] = useState<OnlineClassProvider>(
    listing.google.connected && listing.google.canMeet ? "google_meet" : "link",
  );
  const [joinUrl, setJoinUrl] = useState("");
  const [note, setNote] = useState("");
  const [announce, setAnnounce] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const meetPossible =
    listing.google.connected &&
    listing.google.canMeet &&
    (!listing.unrestricted || teacherId === listing.staffId);

  const pickPeriod = (no: string) => {
    setPeriodNo(no);
    const b = listing.bell.find((x) => String(x.no) === no);
    if (b) {
      setStartTime(b.startTime);
      setEndTime(b.endTime);
    }
  };

  const setStart = (t: string) => {
    setStartTime(t);
    const s = timeToMinutes(t);
    if (!Number.isNaN(s) && (!endTime || timeToMinutes(endTime) <= s)) {
      setEndTime(minutesToTime(s + 40));
    }
  };

  const submit = async () => {
    setBusy(true);
    setErr(null);
    const [classId, sectionId] = sectionKey.split("|");
    try {
      const r = await api<{ session: Row; announced: { households: number; sent: number } | null }>(
        "/api/v1/staff/online-classes",
        {
          method: "POST",
          body: JSON.stringify({
            classId,
            sectionId,
            subjectId,
            teacherId,
            title,
            date,
            startTime,
            endTime,
            periodNo: periodNo ? Number(periodNo) : null,
            provider: meetPossible ? provider : "link",
            joinUrl,
            note,
            announce,
          }),
        },
      );
      const a = r.announced;
      onCreated(
        a && a.households
          ? `Scheduled and announced to ${a.households} households.`
          : "Scheduled.",
      );
    } catch (e) {
      const ex = e as Error & { reason?: string };
      setErr(
        ex.reason === "google_reconnect"
          ? `${ex.message}. Reconnect Google, or paste a link instead.`
          : ex.message,
      );
    } finally {
      setBusy(false);
    }
  };

  const label = "block text-xs font-medium text-muted-foreground";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogPopup size="md">
        <DialogHeader>
          <DialogTitle>Schedule an online class</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={label}>Class &amp; section</label>
            <select className={`${field} mt-1`} value={sectionKey} onChange={(e) => setSectionKey(e.target.value)}>
              {listing.sections.map((s) => (
                <option key={s.sectionId} value={`${s.classId}|${s.sectionId}`}>
                  {s.className} {s.sectionName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>Subject</label>
            <select className={`${field} mt-1`} value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
              <option value="">—</option>
              {listing.subjects.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          {listing.unrestricted ? (
            <div>
              <label className={label}>Teacher (host)</label>
              <select className={`${field} mt-1`} value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
                <option value="">—</option>
                {listing.teachers.map((t) => (
                  <option key={t.id} value={t.id}>{t.fullName}</option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <label className={label}>Title (optional)</label>
              <input className={`${field} mt-1`} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Fractions revision" />
            </div>
          )}
          <div>
            <label className={label}>Date</label>
            <input type="date" className={`${field} mt-1`} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <label className={label}>Bell period (fills the time)</label>
            <select className={`${field} mt-1`} value={periodNo} onChange={(e) => pickPeriod(e.target.value)}>
              <option value="">Custom time</option>
              {listing.bell.map((b) => (
                <option key={b.no} value={b.no}>
                  {b.label} · {fmt12(b.startTime)}–{fmt12(b.endTime)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>Starts</label>
            <input type="time" className={`${field} mt-1`} value={startTime} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div>
            <label className={label}>Ends</label>
            <input type="time" className={`${field} mt-1`} value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </div>
          {listing.unrestricted ? (
            <div className="sm:col-span-2">
              <label className={label}>Title (optional)</label>
              <input className={`${field} mt-1`} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Fractions revision" />
            </div>
          ) : null}
          <div className="sm:col-span-2">
            <label className={label}>Where</label>
            <div className="mt-1 flex flex-wrap gap-3 text-sm">
              <label className={`flex items-center gap-1.5 ${meetPossible ? "" : "opacity-60"}`}>
                <input
                  type="radio"
                  name="provider"
                  checked={provider === "google_meet" && meetPossible}
                  disabled={!meetPossible}
                  onChange={() => setProvider("google_meet")}
                />
                Google Meet (room created on the teacher&apos;s account)
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" name="provider" checked={provider === "link" || !meetPossible} onChange={() => setProvider("link")} />
                Paste a link
              </label>
            </div>
            {!meetPossible ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {listing.unrestricted && teacherId !== listing.staffId
                  ? "A Meet room can only be created on your own Google account. For another teacher's class, paste the link they made."
                  : listing.google.oauthConfigured
                    ? "Connect Google (top right) to create Meet rooms here."
                    : "Google sign-in is not configured on this server."}
              </p>
            ) : null}
            {provider === "link" || !meetPossible ? (
              <input
                className={`${field} mt-2`}
                value={joinUrl}
                onChange={(e) => setJoinUrl(e.target.value)}
                placeholder="https://meet.google.com/abc-defg-hij"
              />
            ) : null}
          </div>
          <div className="sm:col-span-2">
            <label className={label}>Note to parents (optional)</label>
            <input className={`${field} mt-1`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Keep the maths notebook ready" />
          </div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" checked={announce} onChange={(e) => setAnnounce(e.target.checked)} />
            Announce to the section&apos;s parents now (app notification)
          </label>
          {err ? <p className="text-sm text-[var(--danger)] sm:col-span-2">{err}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Close</Button>
          <Button onClick={() => void submit()} disabled={busy || !sectionKey || !date || !startTime || !endTime}>
            {busy ? "Scheduling…" : "Schedule"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

// ─── Attendance dialog ───────────────────────────────────────────────

function AttendanceDialog({
  row,
  onClose,
  onChanged,
}: {
  row: Row;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [data, setData] = useState<Attendance | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<Attendance>(`/api/v1/staff/online-classes/${row.id}/attendance`));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load");
    }
  }, [row.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const sync = async () => {
    setBusy(true);
    setErr(null);
    setSyncNote(null);
    try {
      const r = await api<{ participants: number; matched: number; unmatched: string[] }>(
        `/api/v1/staff/online-classes/${row.id}/attendance`,
        { method: "POST" },
      );
      setSyncNote(
        `${r.participants} in the room, ${r.matched} matched to the roster` +
          (r.unmatched.length ? `; not matched: ${r.unmatched.join(", ")}` : ""),
      );
      await load();
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogPopup size="md" className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Who joined · {row.className} {row.sectionName} · {fmtDate(row.date)} {fmt12(row.startTime)}
          </DialogTitle>
        </DialogHeader>
        {err ? <p className="text-sm text-[var(--danger)]">{err}</p> : null}
        {data ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>
                <strong>{data.joined}</strong> of {data.total} joined
                {data.attendanceSyncedAt ? (
                  <span className="text-xs text-muted-foreground"> · Meet list synced</span>
                ) : null}
              </span>
              {data.canSync ? (
                <Button size="sm" variant="outline" onClick={() => void sync()} disabled={busy}>
                  <RefreshCw className={`size-4 ${busy ? "animate-spin" : ""}`} aria-hidden />{" "}
                  {busy ? "Reading Meet…" : "Sync from Meet"}
                </Button>
              ) : null}
            </div>
            {syncNote ? <p className="text-xs text-muted-foreground">{syncNote}</p> : null}
            <ul className="mt-2 divide-y divide-[var(--border)] text-sm">
              {data.rows.map((r) => (
                <li key={r.studentId} className="flex items-center justify-between py-1.5">
                  <span>
                    <span className="mr-2 inline-block w-6 text-right text-xs text-muted-foreground tabular-nums">
                      {r.rollNo || ""}
                    </span>
                    {r.fullName}
                  </span>
                  <span className={r.joined ? "text-[var(--success)]" : "text-muted-foreground"}>
                    {r.joined
                      ? `Joined${r.minutes ? ` · ${r.minutes} min` : ""}${r.source === "meet_sync" ? " · Meet" : ""}`
                      : "—"}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">
              &ldquo;Joined&rdquo; means the family tapped Join in the app inside the class window, or Google Meet
              listed the child by name. It is a record of presence, not the attendance register.
            </p>
          </>
        ) : !err ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
