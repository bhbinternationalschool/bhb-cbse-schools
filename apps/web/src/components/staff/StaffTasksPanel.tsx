"use client";

/**
 * Staff tasks — the "tasks" tab of the Staff screen (director, 30 Oct 2026).
 *
 * Tracked work assigned to staff: deadline, priority, progress, completion
 * evidence and the assigner's review. The director and principal (and anyone
 * granted the staff.tasks function in the RBAC editor) see the whole board,
 * assign and review; every member of staff sees and updates only their own
 * tasks. The server scopes the view — this panel only renders it.
 *
 * Server-authoritative, no local copy: the board reads
 * GET /api/data/views/staff-tasks, one task and its log read
 * GET /api/staff/tasks/<id>, and every change is one POST /api/staff/tasks
 * or one PATCH /api/staff/tasks/<id> naming the rev it loaded; a 409
 * refetches and says so instead of overwriting. Evidence uploads go through
 * POST /api/staff/tasks/evidence and land on the task only with the PATCH.
 *
 * Language: English / हिंदी toggle on the panel (exams/games pattern —
 * session-local, English default, never coupled to any chat language).
 * User-entered titles and notes are shown exactly as typed, never
 * translated. Staff names come from the ERP roster (masters).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useStaffList } from "@/lib/data/client/hooks";
import { ErpPanel } from "@/components/ui/erp-roster";
import { field, btn, btnOutline } from "@/components/ui/erp-ui";
import {
  STAFF_TASK_STATUS_LABELS,
  type StaffTaskAttachment,
  type StaffTaskRow,
  type StaffTasksView,
  type StaffTaskUpdate,
} from "@/lib/staffTasksShared";

type Lang = "en" | "hi";

const STR = {
  board: { en: "Board", hi: "बोर्ड" },
  assign: { en: "Assign", hi: "सौंपें" },
  review: { en: "Review", hi: "रिव्यू" },
  myTasks: { en: "My tasks", hi: "मेरे काम" },
  running: { en: "Running", hi: "चल रहे" },
  late: { en: "Late", hi: "देर हुए" },
  toReview: { en: "To review", hi: "रिव्यू बाकी" },
  due: { en: "due", hi: "अंतिम तिथि" },
  noTasks: { en: "No tasks here yet.", hi: "अभी कोई काम नहीं।" },
  loading: { en: "Loading tasks…", hi: "काम खुल रहे हैं…" },
  newTask: { en: "Assign a new task", hi: "नया काम सौंपें" },
  who: { en: "For", hi: "किसे" },
  title: { en: "Task", hi: "काम" },
  detail: { en: "Detail", hi: "विवरण" },
  dueOn: { en: "Due date", hi: "अंतिम तिथि" },
  priority: { en: "Priority", hi: "प्राथमिकता" },
  normal: { en: "Normal", hi: "सामान्य" },
  urgent: { en: "Urgent", hi: "जरूरी" },
  evidenceReq: { en: "Completion evidence (photo / file) required", hi: "पूरा होने का प्रमाण (फोटो / फाइल) जरूरी" },
  assignBtn: { en: "Assign task", hi: "काम सौंपें" },
  progress: { en: "Progress", hi: "प्रगति" },
  note: { en: "Note", hi: "नोट" },
  saveProgress: { en: "Save progress", hi: "प्रगति दर्ज करें" },
  addEvidence: { en: "Add photo / file", hi: "फोटो / फाइल जोड़ें" },
  addLink: { en: "Add link", hi: "लिंक जोड़ें" },
  submit: { en: "Done — send for review", hi: "पूरा हुआ — रिव्यू के लिए भेजें" },
  accept: { en: "Accept", hi: "स्वीकारें" },
  return: { en: "Return with note", hi: "नोट के साथ वापस भेजें" },
  cancelTask: { en: "Cancel task", hi: "काम रद्द करें" },
  back: { en: "Back", hi: "वापस" },
  history: { en: "History", hi: "इतिहास" },
  evidence: { en: "Evidence", hi: "प्रमाण" },
  reviewNotePh: { en: "Note for the staff member…", hi: "स्टाफ के लिए नोट…" },
  reviewerNote: { en: "Review note", hi: "रिव्यू नोट" },
  assignedBy: { en: "Assigned by", hi: "सौंपा" },
  savedNotLogged: {
    en: "Saved, but the note was not logged — send it again.",
    hi: "दर्ज हो गया, पर नोट लॉग नहीं हुआ — फिर भेजें।",
  },
  changedElsewhere: {
    en: "This task changed elsewhere — reloaded, check it once more.",
    hi: "ये काम कहीं और बदल गया — फिर से खोला गया, एक बार जाँच लें।",
  },
  evidenceMissing: {
    en: "This task needs a photo, file or link as evidence before it can be sent for review.",
    hi: "रिव्यू के लिए भेजने से पहले इस काम के लिए फोटो, फाइल या लिंक प्रमाण जरूरी है।",
  },
  langToggle: { en: "हिंदी", hi: "English" },
} as const;

type StrKey = keyof typeof STR;

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isLate(task: StaffTaskRow): boolean {
  return !!task.dueOn && task.dueOn < todayStr() && task.status !== "done" && task.status !== "cancelled";
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  return iso.slice(0, 16).replace("T", " ");
}

const STATUS_TONES: Record<string, { bg: string; fg: string }> = {
  assigned: { bg: "#eef2ff", fg: "#3730a3" },
  in_progress: { bg: "#ecfeff", fg: "#0e7490" },
  submitted: { bg: "#fef3c7", fg: "#92400e" },
  returned: { bg: "#fee2e2", fg: "#b91c1c" },
  done: { bg: "#dcfce7", fg: "#166534" },
  cancelled: { bg: "#f1f5f9", fg: "#64748b" },
};

function StatusChip({ status, lang }: { status: StaffTaskRow["status"]; lang: Lang }) {
  const tone = STATUS_TONES[status] ?? STATUS_TONES.assigned!;
  return (
    <span
      style={{
        background: tone.bg,
        color: tone.fg,
        borderRadius: 999,
        padding: "2px 10px",
        fontSize: 11,
        fontWeight: 700,
        whiteSpace: "nowrap",
      }}
    >
      {STAFF_TASK_STATUS_LABELS[status]?.[lang] ?? status}
    </span>
  );
}

function ProgressBar({ pct, late }: { pct: number; late: boolean }) {
  return (
    <span
      style={{
        display: "block",
        height: 6,
        borderRadius: 3,
        background: "var(--border)",
        overflow: "hidden",
        marginTop: 6,
      }}
    >
      <span
        style={{
          display: "block",
          height: "100%",
          width: `${Math.min(100, Math.max(0, pct))}%`,
          background: late ? "#dc2626" : "var(--brand-deep, #1e3a5f)",
        }}
      />
    </span>
  );
}

class ApiFailure extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function api<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, { cache: "no-store", credentials: "same-origin", ...init });
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string"
        ? (data as { error: string }).error
        : `Request failed (${res.status})`;
    throw new ApiFailure(res.status, msg, data);
  }
  return data as T;
}

function attachmentHref(a: StaffTaskAttachment): string {
  if (a.kind === "link") return a.path;
  // Task-scoped download route — applies the task-level read rule on every
  // request; the staff-wide /api/file route refuses task evidence.
  return `/api/staff/tasks/evidence/${a.path}`;
}

export type StaffTasksPanelProps = {
  /** Test / demo override for the roster (id → label); production reads masters. */
  staffOptions?: { id: string; label: string }[];
};

export function StaffTasksPanel({ staffOptions }: StaffTasksPanelProps) {
  // Language: the visitor-screen convention — the explicit choice persists
  // in this browser only (localStorage), never touches any chat / WhatsApp
  // language. English default until the person picks हिंदी once.
  const [lang, setLang] = useState<Lang>("en");
  useEffect(() => {
    try {
      const saved = localStorage.getItem("bhb_staff_tasks_lang");
      if (saved === "hi" || saved === "en") setLang(saved);
    } catch {
      /* ignore */
    }
  }, []);
  const pickLang = useCallback((next: Lang) => {
    setLang(next);
    try {
      localStorage.setItem("bhb_staff_tasks_lang", next);
    } catch {
      /* ignore */
    }
  }, []);
  const t = useCallback((k: StrKey) => STR[k][lang], [lang]);

  const [view, setView] = useState<StaffTasksView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sub, setSub] = useState<"board" | "assign" | "review">("board");
  const [openId, setOpenId] = useState<string | null>(null);

  // The roster comes from the server-backed staff-list view (the data-layer
  // 2.1c pattern every sibling panel uses), never from the browser's masters
  // copy — reading the tab copy here would grow the retired-pattern budget.
  const staffList = useStaffList();
  const roster = useMemo(() => {
    if (staffOptions) return staffOptions;
    return (staffList.data?.staff ?? [])
      .filter((s) => s.status === "active")
      .map((s) => ({ id: s.id, label: s.fullName || s.empCode || s.id }));
  }, [staffOptions, staffList.data]);
  const labelFor = useCallback(
    (staffId: string) => roster.find((s) => s.id === staffId)?.label ?? staffId,
    [roster],
  );

  const load = useCallback(async () => {
    try {
      const raw = await api<unknown>("/api/data/views/staff-tasks");
      const d = raw as Partial<StaffTasksView>;
      if (!d || !Array.isArray(d.tasks)) throw new Error("The tasks answer was not understood");
      setView({
        tasks: d.tasks as StaffTaskRow[],
        canManage: !!d.canManage,
        canReview: !!d.canReview,
        selfStaffId: typeof d.selfStaffId === "string" && d.selfStaffId ? d.selfStaffId : null,
      });
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleWriteError = useCallback(
    async (e: unknown) => {
      if (e instanceof ApiFailure && e.status === 409) {
        setNotice(t("changedElsewhere"));
        await load();
        return;
      }
      setNotice(e instanceof Error ? e.message : "Something went wrong");
    },
    [load, t],
  );

  if (loadError) {
    return (
      <ErpPanel title={t("board")}>
        <p className="text-sm text-red-700">{loadError}</p>
      </ErpPanel>
    );
  }
  if (!view) {
    return (
      <ErpPanel title={t("board")}>
        <p className="text-sm text-[var(--muted)]">{t("loading")}</p>
      </ErpPanel>
    );
  }

  const manager = view.canManage || view.canReview;
  const openTask = openId ? (view.tasks.find((x) => x.id === openId) ?? null) : null;

  return (
    <ErpPanel
      title={manager ? t("board") : t("myTasks")}
      description={undefined}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {manager ? (
          <div style={{ display: "flex", gap: 16, borderTop: "1px solid var(--border)", paddingTop: 8, fontSize: 13 }}>
            {(["board", "assign", "review"] as const)
              .filter((s) => s !== "assign" || view.canManage)
              .filter((s) => s !== "review" || view.canReview)
              .map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    setSub(s);
                    setOpenId(null);
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                    fontWeight: sub === s ? 700 : 400,
                    color: sub === s ? "var(--foreground)" : "var(--muted)",
                  }}
                >
                  {t(s)}
                </button>
              ))}
          </div>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={() => pickLang(lang === "en" ? "hi" : "en")}
          className="rounded-full border border-[var(--border)] px-3 py-1.5 text-xs font-bold"
          title="Switch language / भाषा बदलें"
        >
          {t("langToggle")}
        </button>
      </div>

      {notice ? (
        <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {notice}
        </p>
      ) : null}

      {openTask ? (
        <TaskDetail
          task={openTask}
          view={view}
          lang={lang}
          t={t}
          labelFor={labelFor}
          onClose={() => setOpenId(null)}
          onChanged={load}
          onWriteError={handleWriteError}
          setNotice={setNotice}
        />
      ) : sub === "assign" && view.canManage ? (
        <AssignForm
          roster={roster}
          lang={lang}
          t={t}
          onDone={async () => {
            setSub("board");
            await load();
          }}
          onWriteError={handleWriteError}
        />
      ) : sub === "review" && view.canReview ? (
        <ReviewList
          tasks={view.tasks.filter((x) => x.status === "submitted")}
          lang={lang}
          t={t}
          labelFor={labelFor}
          onOpen={setOpenId}
        />
      ) : (
        <BoardList
          tasks={view.tasks}
          manager={manager}
          selfStaffId={view.selfStaffId}
          lang={lang}
          t={t}
          labelFor={labelFor}
          onOpen={setOpenId}
        />
      )}
    </ErpPanel>
  );
}

/* ── Board ────────────────────────────────────────────────────────────── */

function BoardList({
  tasks,
  manager,
  selfStaffId,
  lang,
  t,
  labelFor,
  onOpen,
}: {
  tasks: StaffTaskRow[];
  manager: boolean;
  selfStaffId: string | null;
  lang: Lang;
  t: (k: StrKey) => string;
  labelFor: (id: string) => string;
  onOpen: (id: string) => void;
}) {
  const visible = manager ? tasks : tasks.filter((x) => x.assigneeStaffId === selfStaffId);
  const running = visible.filter((x) => x.status === "assigned" || x.status === "in_progress" || x.status === "returned").length;
  const late = visible.filter(isLate).length;
  const review = visible.filter((x) => x.status === "submitted").length;
  return (
    <div className="mt-3">
      <div style={{ display: "flex", gap: 16, fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
        <span>
          {t("running")} <b style={{ color: "var(--foreground)" }}>{running}</b>
        </span>
        <span style={{ color: late ? "#b91c1c" : undefined }}>
          {t("late")} <b>{late}</b>
        </span>
        <span>
          {t("toReview")} <b style={{ color: "var(--foreground)" }}>{review}</b>
        </span>
      </div>
      {visible.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">{t("noTasks")}</p>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {visible.map((task) => (
            <TaskCard key={task.id} task={task} lang={lang} t={t} labelFor={labelFor} onOpen={onOpen} />
          ))}
        </div>
      )}
    </div>
  );
}

function TaskCard({
  task,
  lang,
  t,
  labelFor,
  onOpen,
}: {
  task: StaffTaskRow;
  lang: Lang;
  t: (k: StrKey) => string;
  labelFor: (id: string) => string;
  onOpen: (id: string) => void;
}) {
  const late = isLate(task);
  return (
    <button
      type="button"
      onClick={() => onOpen(task.id)}
      style={{
        textAlign: "left",
        width: "100%",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: "10px 12px",
        background: task.status === "returned" ? "#fff7f7" : "var(--card)",
        cursor: "pointer",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
        <b style={{ fontSize: 14 }}>
          {task.priority === "urgent" ? (
            <span aria-label="urgent" style={{ display: "inline-block", width: 9, height: 9, borderRadius: 5, background: "#dc2626", marginRight: 6 }} />
          ) : null}
          {task.title}
        </b>
        <StatusChip status={task.status} lang={lang} />
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
        {labelFor(task.assigneeStaffId)}
        {task.dueOn ? (
          <>
            {" · "}
            {t("due")} <span style={late ? { color: "#b91c1c", fontWeight: 700 } : undefined}>{fmtDate(task.dueOn)}</span>
          </>
        ) : null}
        {" · "}
        {t("assignedBy")} {task.assignedByLabel}
      </div>
      <ProgressBar pct={task.progressPct} late={late} />
    </button>
  );
}

/* ── Review queue ─────────────────────────────────────────────────────── */

function ReviewList({
  tasks,
  lang,
  t,
  labelFor,
  onOpen,
}: {
  tasks: StaffTaskRow[];
  lang: Lang;
  t: (k: StrKey) => string;
  labelFor: (id: string) => string;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="mt-3" style={{ display: "grid", gap: 10 }}>
      {tasks.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">{t("noTasks")}</p>
      ) : (
        tasks.map((task) => (
          <TaskCard key={task.id} task={task} lang={lang} t={t} labelFor={labelFor} onOpen={onOpen} />
        ))
      )}
    </div>
  );
}

/* ── Assign form ──────────────────────────────────────────────────────── */

function AssignForm({
  roster,
  lang,
  t,
  onDone,
  onWriteError,
}: {
  roster: { id: string; label: string }[];
  lang: Lang;
  t: (k: StrKey) => string;
  onDone: () => Promise<void>;
  onWriteError: (e: unknown) => Promise<void>;
}) {
  const [assignee, setAssignee] = useState("");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [evidenceRequired, setEvidenceRequired] = useState(true);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!assignee || !title.trim() || busy) return;
    setBusy(true);
    try {
      await api("/api/staff/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          op: "assign",
          title: title.trim(),
          detail: detail.trim(),
          assigneeStaffId: assignee,
          priority: urgent ? "urgent" : "normal",
          dueOn: dueOn || null,
          evidenceRequired,
        }),
      });
      await onDone();
    } catch (e) {
      await onWriteError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3" style={{ display: "grid", gap: 10, maxWidth: 520 }}>
      <h3 style={{ fontSize: 15, fontWeight: 700 }}>{t("newTask")}</h3>
      <label style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--muted)" }}>
        {t("who")}
        <select className={field} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
          <option value="">—</option>
          {roster.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <label style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--muted)" }}>
        {t("title")}
        <input className={field} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
      </label>
      <label style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--muted)" }}>
        {t("detail")}
        <textarea className={field} rows={3} value={detail} onChange={(e) => setDetail(e.target.value)} maxLength={2000} />
      </label>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <label style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--muted)", flex: 1, minWidth: 140 }}>
          {t("dueOn")}
          <input type="date" className={field} value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
        </label>
        <label style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--muted)", flex: 1, minWidth: 140 }}>
          {t("priority")}
          <span style={{ display: "flex", gap: 12, alignItems: "center", height: 36 }}>
            <label style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 13, color: "var(--foreground)" }}>
              <input type="radio" checked={!urgent} onChange={() => setUrgent(false)} /> {t("normal")}
            </label>
            <label style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 13, color: "var(--foreground)" }}>
              <input type="radio" checked={urgent} onChange={() => setUrgent(true)} /> {t("urgent")}
            </label>
          </span>
        </label>
      </div>
      <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
        <input type="checkbox" checked={evidenceRequired} onChange={(e) => setEvidenceRequired(e.target.checked)} />
        {t("evidenceReq")}
      </label>
      <div>
        <button type="button" className={btn} disabled={busy || !assignee || !title.trim()} onClick={() => void submit()}>
          {t("assignBtn")}
        </button>
      </div>
    </div>
  );
}

/* ── Task detail: log, progress, evidence, review ─────────────────────── */

function TaskDetail({
  task,
  view,
  lang,
  t,
  labelFor,
  onClose,
  onChanged,
  onWriteError,
  setNotice,
}: {
  task: StaffTaskRow;
  view: StaffTasksView;
  lang: Lang;
  t: (k: StrKey) => string;
  labelFor: (id: string) => string;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onWriteError: (e: unknown) => Promise<void>;
  setNotice: (n: string | null) => void;
}) {
  const [updates, setUpdates] = useState<StaffTaskUpdate[] | null>(null);
  const [pct, setPct] = useState(task.progressPct);
  const [note, setNote] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [pending, setPending] = useState<StaffTaskAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [showLink, setShowLink] = useState(false);

  const mine = !!view.selfStaffId && task.assigneeStaffId === view.selfStaffId;
  const open = task.status !== "done" && task.status !== "cancelled";
  const mayProgress = open && task.status !== "submitted" && (mine || view.canManage);
  const mayReview = view.canReview && task.status === "submitted";
  const mayCancel = view.canManage && open;

  const loadLog = useCallback(async () => {
    try {
      const d = await api<{ task: StaffTaskRow; updates: StaffTaskUpdate[] }>(
        `/api/staff/tasks/${encodeURIComponent(task.id)}`,
      );
      setUpdates(Array.isArray(d.updates) ? d.updates : []);
    } catch {
      setUpdates([]);
    }
  }, [task.id]);

  useEffect(() => {
    void loadLog();
  }, [loadLog]);

  async function patch(body: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await api<{ task?: StaffTaskRow; logFailed?: boolean }>(`/api/staff/tasks/${encodeURIComponent(task.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.logFailed) setNotice(t("savedNotLogged"));
      else setNotice(null);
      setNote("");
      setReviewNote("");
      setPending([]);
      await onChanged();
      await loadLog();
      onClose();
    } catch (e) {
      await onWriteError(e);
      await loadLog();
    } finally {
      setBusy(false);
    }
  }

  async function uploadEvidence(file: File) {
    if (busy) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("taskId", task.id);
      fd.append("file", file);
      const d = await api<{ ok: boolean; attachment: StaffTaskAttachment }>("/api/staff/tasks/evidence", {
        method: "POST",
        body: fd,
      });
      if (d.attachment) setPending((p) => [...p, d.attachment as StaffTaskAttachment].slice(0, 10));
    } catch (e) {
      await onWriteError(e);
    } finally {
      setBusy(false);
    }
  }

  function addLink() {
    const u = linkUrl.trim();
    if (!u || !/^https?:\/\//i.test(u)) return;
    setPending((p) => [...p, { kind: "link", name: u.slice(0, 80), path: u } as StaffTaskAttachment].slice(0, 10));
    setLinkUrl("");
    setShowLink(false);
  }

  async function submitForReview() {
    if (task.evidenceRequired && pending.length === 0) {
      const hasEvidence = (updates ?? []).some((u) => (u.attachments ?? []).length > 0);
      if (!hasEvidence) {
        setNotice(t("evidenceMissing"));
        return;
      }
    }
    await patch({ op: "submit", base: task.updatedAt, note: note.trim() || undefined, attachments: pending.length ? pending : undefined });
  }

  return (
    <div className="mt-3" style={{ display: "grid", gap: 12, maxWidth: 640 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <button type="button" className={btnOutline} onClick={onClose}>
          ← {t("back")}
        </button>
        <StatusChip status={task.status} lang={lang} />
      </div>
      <div>
        <h3 style={{ fontSize: 16, fontWeight: 700 }}>
          {task.priority === "urgent" ? (
            <span aria-label="urgent" style={{ display: "inline-block", width: 9, height: 9, borderRadius: 5, background: "#dc2626", marginRight: 6 }} />
          ) : null}
          {task.title}
        </h3>
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
          {labelFor(task.assigneeStaffId)}
          {task.dueOn ? (
            <>
              {" · "}
              {t("due")} {fmtDate(task.dueOn)}
            </>
          ) : null}
          {" · "}
          {t("assignedBy")} {task.assignedByLabel}
        </div>
        {task.detail ? <p style={{ fontSize: 13, marginTop: 6, whiteSpace: "pre-wrap" }}>{task.detail}</p> : null}
        <ProgressBar pct={task.progressPct} late={isLate(task)} />
      </div>

      {task.reviewNote ? (
        <p style={{ fontSize: 13, borderLeft: "3px solid #f59e0b", paddingLeft: 8, color: "#92400e" }}>
          {t("reviewerNote")}: “{task.reviewNote}”
        </p>
      ) : null}

      {mayProgress ? (
        <div style={{ display: "grid", gap: 8, border: "1px solid var(--border)", borderRadius: 12, padding: 12 }}>
          <label style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--muted)" }}>
            {t("progress")} — {pct}%
            <input type="range" min={0} max={100} step={5} value={pct} onChange={(e) => setPct(Number(e.target.value))} />
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--muted)" }}>
            {t("note")}
            <input className={field} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
          </label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <label className={btnOutline} style={{ cursor: "pointer" }}>
              {t("addEvidence")}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void uploadEvidence(f);
                  e.target.value = "";
                }}
              />
            </label>
            <button type="button" className={btnOutline} onClick={() => setShowLink(!showLink)}>
              {t("addLink")}
            </button>
            {showLink ? (
              <>
                <input
                  className={field}
                  style={{ maxWidth: 260 }}
                  placeholder="https://…"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                />
                <button type="button" className={btnOutline} onClick={addLink}>
                  +
                </button>
              </>
            ) : null}
          </div>
          {pending.length > 0 ? (
            <ul style={{ fontSize: 12, color: "var(--muted)", margin: 0, paddingLeft: 18 }}>
              {pending.map((a, i) => (
                <li key={`${a.path}-${i}`}>
                  [{a.kind}] {a.name}
                </li>
              ))}
            </ul>
          ) : null}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className={btnOutline}
              disabled={busy}
              onClick={() =>
                void patch({
                  op: "progress",
                  base: task.updatedAt,
                  pct,
                  note: note.trim() || undefined,
                  attachments: pending.length ? pending : undefined,
                })
              }
            >
              {t("saveProgress")}
            </button>
            <button type="button" className={btn} disabled={busy} onClick={() => void submitForReview()}>
              {t("submit")}
            </button>
          </div>
        </div>
      ) : null}

      {mayReview ? (
        <div style={{ display: "grid", gap: 8, border: "1px solid var(--border)", borderRadius: 12, padding: 12 }}>
          <input
            className={field}
            placeholder={t("reviewNotePh")}
            value={reviewNote}
            onChange={(e) => setReviewNote(e.target.value)}
            maxLength={500}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className={btn}
              disabled={busy}
              onClick={() => void patch({ op: "review", base: task.updatedAt, decision: "accept", note: reviewNote.trim() || undefined })}
            >
              ✓ {t("accept")}
            </button>
            <button
              type="button"
              className={btnOutline}
              disabled={busy}
              onClick={() => void patch({ op: "review", base: task.updatedAt, decision: "return", note: reviewNote.trim() || undefined })}
            >
              ↩ {t("return")}
            </button>
          </div>
        </div>
      ) : null}

      {mayCancel ? (
        <div>
          <button
            type="button"
            className={btnOutline}
            disabled={busy}
            onClick={() => void patch({ op: "cancel", base: task.updatedAt })}
          >
            {t("cancelTask")}
          </button>
        </div>
      ) : null}

      <div>
        <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>{t("history")}</h4>
        {updates === null ? (
          <p className="text-sm text-[var(--muted)]">{t("loading")}</p>
        ) : updates.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">{t("noTasks")}</p>
        ) : (
          <ul style={{ display: "grid", gap: 8, margin: 0, padding: 0, listStyle: "none" }}>
            {updates.map((u) => (
              <li key={u.id} style={{ borderLeft: "2px solid var(--border)", paddingLeft: 8, fontSize: 13 }}>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>
                  {fmtDateTime(u.createdAt)} · {labelFor(u.authorStaffId)}{u.pct !== null ? ` · ${u.pct}%` : ""}
                </div>
                {u.note ? <div style={{ whiteSpace: "pre-wrap" }}>{u.note}</div> : null}
                {(u.attachments ?? []).length > 0 ? (
                  <div style={{ marginTop: 2 }}>
                    {t("evidence")}:{" "}
                    {(u.attachments ?? []).map((a, i) => (
                      <a
                        key={`${a.path}-${i}`}
                        href={attachmentHref(a)}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: "var(--brand-deep)", marginRight: 10 }}
                      >
                        [{a.kind}] {a.name}
                      </a>
                    ))}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
