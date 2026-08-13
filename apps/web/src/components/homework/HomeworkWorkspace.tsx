"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BookOpen } from "lucide-react";
import { useDemoSession, useSessionReadOnly } from "@/components/shell/SessionContext";
import { ModuleTabs, type ModuleTabItem } from "@/components/ui/ModuleTabs";
import { ErpWorkspaceShell } from "@/components/ui/erp-workspace-shell";
import { ModuleDashboardHost } from "@/components/dashboard/ModuleDashboardHost";
import {
  DEFAULT_AY,
  loadMasters,
  type MastersState,
} from "@/lib/masters";
import { loadSis, type SisState } from "@/lib/sis";
import {
  acknowledgeSubmission,
  classLabel,
  composeWhatsAppHomeworkNotify,
  createDiaryEntry,
  createHomeworkPost,
  deleteDiaryEntry,
  HOMEWORK_REPORTS,
  homeworkWhatsAppUrl,
  isSeen,
  listDiaryForDay,
  listPostsForDay,
  listSectionParentContacts,
  markHomeworkWhatsAppNotified,
  readImageAsDataUrl,
  resolveTeacherHomeworkDefaults,
  rosterForSection,
  runHomeworkReport,
  seedHomeworkIfEmpty,
  seenPctForPost,
  setHomeworkExamFreeze,
  subjectLabel,
  submissionForStudent,
  updateDiaryEntry,
  updateHomeworkPost,
  withdrawHomeworkPost,
  type DiaryEntry,
  type HomeworkParentContact,
  type HomeworkPost,
  type HomeworkReportFormat,
  type HomeworkReportId,
  type HomeworkState,
} from "@/lib/homework";
import { ClassroomSyncPanel } from "@/components/homework/ClassroomSyncPanel";
import { TENANT } from "@/lib/types";
import { btn, btnOutline, field } from "@/components/ui/erp-ui";
import { DeskListActions } from "@/components/ui/desk-list-actions";

type HwTab =
  | "dashboard"
  | "today"
  | "compose"
  | "diary"
  | "submissions"
  | "reports"
  | "classroom";

const TABS: ModuleTabItem[] = [
  { id: "dashboard", label: "Dashboard", tone: "navy" },
  { id: "today", label: "Today", tone: "navy" },
  { id: "compose", label: "Compose HW", tone: "teal" },
  { id: "classroom", label: "Classroom", tone: "teal" },
  { id: "diary", label: "Class diary", tone: "amber" },
  { id: "submissions", label: "Submissions", tone: "green" },
  { id: "reports", label: "Reports", tone: "slate" },
];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function monthStart() {
  return `${todayIso().slice(0, 7)}-01`;
}

export function HomeworkWorkspace() {
  const session = useDemoSession();
  const readOnly = useSessionReadOnly();
  const ay = session.academicYearCode || DEFAULT_AY;
  const [tab, setTab] = useState<HwTab>("dashboard");
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [sis, setSis] = useState<SisState | null>(null);
  const [state, setState] = useState<HomeworkState | null>(null);
  const [date, setDate] = useState(todayIso);
  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Compose
  const [title, setTitle] = useState("");
  const [bodyEn, setBodyEn] = useState("");
  const [bodyHi, setBodyHi] = useState("");
  const [dueAt, setDueAt] = useState(todayIso);
  const [requiresSubmit, setRequiresSubmit] = useState(false);
  const [aiHint, setAiHint] = useState("");
  const [attachUrl, setAttachUrl] = useState("");
  const [attachLabel, setAttachLabel] = useState("");
  const [defaultsNote, setDefaultsNote] = useState<string | null>(null);
  const [notifyTarget, setNotifyTarget] = useState<{
    kind: "homework" | "diary";
    post?: HomeworkPost;
    diary?: DiaryEntry;
  } | null>(null);

  // Diary
  const [diaryTitle, setDiaryTitle] = useState("");
  const [diaryEn, setDiaryEn] = useState("");
  const [diaryHi, setDiaryHi] = useState("");
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [editingDiaryId, setEditingDiaryId] = useState<string | null>(null);

  // Reports
  const [fromDate, setFromDate] = useState(monthStart);
  const [toDate, setToDate] = useState(todayIso);
  const [format, setFormat] = useState<HomeworkReportFormat>("excel");

  const teacherName = session.fullName || "Teacher";
  const teacherStaffId = session.staffId || "";

  function flash(msg: string) {
    setNotice(msg);
    setError(null);
    window.setTimeout(() => setNotice(null), 2800);
  }

  function refresh() {
    setMasters(loadMasters());
    setSis(loadSis());
    setState(seedHomeworkIfEmpty(ay));
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ay]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    void (async () => {
      const { ensureHomeworkHydrated } = await import(
        "@/lib/homeworkPersistence"
      );
      await ensureHomeworkHydrated();
      refresh();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ay]);

  useEffect(() => {
    if (!masters) return;
    const d = resolveTeacherHomeworkDefaults(teacherStaffId || undefined, ay, masters);
    if (d.source === "none") return;
    if (d.classId) setClassId(d.classId);
    if (d.sectionId) setSectionId(d.sectionId);
    if (d.subjectId) setSubjectId(d.subjectId);
    setDefaultsNote(
      d.source === "teaching"
        ? "Defaults from your subject teaching map"
        : "Defaults from class-teacher assignment",
    );
  }, [masters, teacherStaffId, ay]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = new URLSearchParams(window.location.search).get("tab");
    const allowed: HwTab[] = [
      "dashboard",
      "today",
      "compose",
      "classroom",
      "diary",
      "submissions",
      "reports",
    ];
    if (raw && (allowed as string[]).includes(raw)) setTab(raw as HwTab);
  }, []);

  const teacherDefaults = useMemo(() => {
    if (!masters) return null;
    return resolveTeacherHomeworkDefaults(
      teacherStaffId || undefined,
      ay,
      masters,
    );
  }, [masters, teacherStaffId, ay]);

  const classOptions = useMemo(() => {
    if (!masters) return [];
    return masters.classes.filter((c) => c.isActive !== false);
  }, [masters]);

  const sectionOptions = useMemo(() => {
    if (!masters || !classId) return [];
    return masters.sections.filter(
      (s) => s.classId === classId && s.isActive !== false,
    );
  }, [masters, classId]);

  const subjectOptions = useMemo(() => {
    if (!masters) return [];
    const all = (masters.subjects ?? []).filter(
      (s) => s.isActive !== false && !s.parentId,
    );
    const allowed = teacherDefaults?.subjectIds ?? [];
    if (allowed.length === 0) return all;
    const filtered = all.filter((s) => allowed.includes(s.id));
    return filtered.length > 0 ? filtered : all;
  }, [masters, teacherDefaults]);

  useEffect(() => {
    if (!classId && classOptions[0]) setClassId(classOptions[0].id);
  }, [classId, classOptions]);

  useEffect(() => {
    if (!sectionId && sectionOptions[0]) setSectionId(sectionOptions[0].id);
    if (
      sectionId &&
      sectionOptions.length &&
      !sectionOptions.some((s) => s.id === sectionId)
    ) {
      setSectionId(sectionOptions[0]?.id || "");
    }
  }, [sectionId, sectionOptions]);

  useEffect(() => {
    if (!subjectId && subjectOptions[0]) setSubjectId(subjectOptions[0].id);
  }, [subjectId, subjectOptions]);

  const parentContacts = useMemo(() => {
    if (!sis || !sectionId) return [] as HomeworkParentContact[];
    return listSectionParentContacts(sectionId, ay, sis);
  }, [sis, sectionId, ay]);

  const todayPosts = useMemo(() => {
    if (!state) return [];
    return listPostsForDay(state, {
      academicYearCode: ay,
      date,
      classId: classId || undefined,
      sectionId: sectionId || undefined,
      includeWithdrawn: true,
    });
  }, [state, ay, date, classId, sectionId]);

  const todayDiary = useMemo(() => {
    if (!state) return [];
    return listDiaryForDay(state, {
      academicYearCode: ay,
      date,
      classId: classId || undefined,
      sectionId: sectionId || undefined,
    });
  }, [state, ay, date, classId, sectionId]);

  const pendingSubs = useMemo(() => {
    if (!state || !sis) return [];
    return state.submissions
      .filter((s) => !s.teacherAckAt)
      .map((s) => {
        const post = state.posts.find((p) => p.id === s.postId);
        const student = sis.students.find((x) => x.id === s.studentId);
        return { submission: s, post, student };
      })
      .filter((x) => x.post && x.student)
      .sort((a, b) =>
        b.submission.submittedAt.localeCompare(a.submission.submittedAt),
      );
  }, [state, sis]);

  function resetComposeForm() {
    setEditingPostId(null);
    setTitle("");
    setBodyEn("");
    setBodyHi("");
    setAttachUrl("");
    setAttachLabel("");
    setRequiresSubmit(false);
    setAiHint("");
  }

  function beginEditPost(p: HomeworkPost) {
    setEditingPostId(p.id);
    setSubjectId(p.subjectId);
    setTitle(p.title);
    setBodyEn(p.bodyEn);
    setBodyHi(p.bodyHi);
    setDueAt(p.dueAt || date);
    setRequiresSubmit(p.requiresSubmit);
    setAiHint(p.aiTutorHint || "");
    const att = p.attachments[0];
    setAttachUrl(att?.url || "");
    setAttachLabel(att?.label || "");
    setTab("compose");
  }

  function publishHw() {
    const payload = {
      academicYearCode: ay,
      classId,
      sectionId,
      subjectId,
      teacherStaffId,
      teacherName,
      date,
      title,
      bodyEn,
      bodyHi,
      dueAt,
      requiresSubmit,
      aiTutorHint: aiHint,
      attachments: attachUrl.trim()
        ? [
            {
              id: `att_${Date.now()}`,
              label: attachLabel.trim() || "Attachment",
              url: attachUrl.trim(),
            },
          ]
        : [],
    };
    const wasEdit = !!editingPostId;
    const r = editingPostId
      ? updateHomeworkPost({ ...payload, id: editingPostId })
      : createHomeworkPost(payload);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    resetComposeForm();
    refresh();
    if (wasEdit) {
      flash("Homework updated");
    } else {
      setNotifyTarget({ kind: "homework", post: r.post });
      flash("Homework published — notify parents below");
    }
    setTab("today");
  }

  function resetDiaryForm() {
    setEditingDiaryId(null);
    setDiaryTitle("");
    setDiaryEn("");
    setDiaryHi("");
  }

  function beginEditDiary(d: DiaryEntry) {
    setEditingDiaryId(d.id);
    setDiaryTitle(d.title);
    setDiaryEn(d.bodyEn);
    setDiaryHi(d.bodyHi);
  }

  function publishDiary() {
    const payload = {
      academicYearCode: ay,
      classId,
      sectionId,
      teacherStaffId,
      teacherName,
      date,
      title: diaryTitle,
      bodyEn: diaryEn,
      bodyHi: diaryHi,
    };
    const wasEdit = !!editingDiaryId;
    const r = editingDiaryId
      ? updateDiaryEntry({ ...payload, id: editingDiaryId })
      : createDiaryEntry(payload);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    resetDiaryForm();
    refresh();
    if (wasEdit) {
      flash("Diary updated");
    } else {
      setNotifyTarget({ kind: "diary", diary: r.entry });
      flash("Diary posted — notify parents below");
    }
    setTab("today");
  }

  function messageForContact(contact: HomeworkParentContact): string {
    if (!masters) return "";
    const cls = classLabel(masters, classId, sectionId);
    if (notifyTarget?.kind === "homework" && notifyTarget.post) {
      const p = notifyTarget.post;
      return composeWhatsAppHomeworkNotify({
        childName: contact.childNames.join(", "),
        classLabel: cls,
        subjectLabel: subjectLabel(masters, p.subjectId),
        date: p.date,
        title: p.title,
        bodyPreview: p.bodyHi || p.bodyEn,
        kind: "homework",
        teacherName: p.teacherName,
        schoolName: TENANT.nameDisplay || TENANT.shortName,
      });
    }
    if (notifyTarget?.kind === "diary" && notifyTarget.diary) {
      const d = notifyTarget.diary;
      return composeWhatsAppHomeworkNotify({
        childName: contact.childNames.join(", "),
        classLabel: cls,
        date: d.date,
        title: d.title,
        bodyPreview: d.bodyHi || d.bodyEn,
        kind: "diary",
        teacherName: d.teacherName,
        schoolName: TENANT.nameDisplay || TENANT.shortName,
      });
    }
    return "";
  }

  function openWhatsAppForContact(contact: HomeworkParentContact) {
    const msg = messageForContact(contact);
    if (!msg) return;
    window.open(homeworkWhatsAppUrl(contact.mobile, msg), "_blank");
  }

  function notifyAllParents() {
    if (parentContacts.length === 0) {
      setError("No household WhatsApp numbers for this section");
      return;
    }
    const ok = window.confirm(
      `Open WhatsApp for ${parentContacts.length} parent(s)? Browsers may block multiple tabs — allow pop-ups.`,
    );
    if (!ok) return;
    for (const c of parentContacts) {
      openWhatsAppForContact(c);
    }
    if (notifyTarget?.kind === "homework" && notifyTarget.post) {
      markHomeworkWhatsAppNotified(
        notifyTarget.post.id,
        parentContacts.length,
      );
      refresh();
    }
    flash(`Opened WhatsApp for ${parentContacts.length} parent(s)`);
  }

  async function onAttachFile(file: File | null) {
    if (!file) return;
    const r = await readImageAsDataUrl(file);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setAttachUrl(r.url);
    setAttachLabel(file.name);
    flash("Attachment ready");
  }

  if (!state || !masters || !sis) {
    return (
      <div className="px-4 py-8 text-sm text-[var(--muted)]">
        Loading homework…
      </div>
    );
  }

  return (
    <ErpWorkspaceShell
      title="Homework & Class diary"
      subtitle="Daily posts by class–subject · diary for whole class · parent seen & submissions (§19a)"
      icon={<BookOpen className="size-6" aria-hidden />}
      error={error}
      notice={notice}
      actions={
        <>
          <label className="flex items-center gap-2 text-xs text-[var(--muted)]">
            <input
              type="checkbox"
              checked={state.settings.examModeFreeze}
              onChange={(e) => {
                setHomeworkExamFreeze(e.target.checked);
                refresh();
                flash(
                  e.target.checked
                    ? "Exam freeze on — no new HW"
                    : "Exam freeze off",
                );
              }}
            />
            Exam freeze
          </label>
          <Link href="/reports?module=homework" className={btnOutline}>
            Reports Center
          </Link>
        </>
      }
      toolbar={
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-[var(--muted)]">
            Date
            <input
              type="date"
              className={`${field} mt-1 block`}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label className="text-xs text-[var(--muted)]">
            Class
            <select
              className={`${field} mt-1 block min-w-[8rem]`}
              value={classId}
              onChange={(e) => {
                setClassId(e.target.value);
                setSectionId("");
              }}
            >
              {classOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-[var(--muted)]">
            Section
            <select
              className={`${field} mt-1 block min-w-[6rem]`}
              value={sectionId}
              onChange={(e) => setSectionId(e.target.value)}
            >
              {sectionOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          {defaultsNote ? (
            <p className="self-end pb-2 text-xs text-[#0f766e]">{defaultsNote}</p>
          ) : null}
        </div>
      }
    >
      {notifyTarget ? (
        <div className="mb-4 rounded-xl border border-[rgba(21,128,61,0.25)] bg-[rgba(21,128,61,0.06)] px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-[var(--brand-deep)]">
                Notify parents on WhatsApp
              </p>
              <p className="text-xs text-[var(--muted)]">
                {parentContacts.length} household
                {parentContacts.length === 1 ? "" : "s"} with WhatsApp on this
                section ·{" "}
                {notifyTarget.kind === "homework"
                  ? notifyTarget.post?.title
                  : notifyTarget.diary?.title}
              </p>
            </div>
            <button
              type="button"
              className="text-xs text-[var(--muted)] underline"
              onClick={() => setNotifyTarget(null)}
            >
              Dismiss
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={btn} onClick={notifyAllParents}>
              Open WhatsApp ({parentContacts.length})
            </button>
            {parentContacts[0] ? (
              <button
                type="button"
                className={btnOutline}
                onClick={() => openWhatsAppForContact(parentContacts[0])}
              >
                Open first only
              </button>
            ) : null}
            {parentContacts[0] ? (
              <button
                type="button"
                className={btnOutline}
                onClick={() => {
                  void navigator.clipboard.writeText(
                    messageForContact(parentContacts[0]),
                  );
                  flash("Message copied");
                }}
              >
                Copy message
              </button>
            ) : null}
          </div>
          {parentContacts.length > 0 ? (
            <ul className="mt-2 max-h-28 overflow-y-auto text-xs text-[var(--muted)]">
              {parentContacts.slice(0, 8).map((c) => (
                <li key={c.householdId || c.mobile}>
                  {c.guardianName} · {c.mobile} · {c.childNames.join(", ")}
                </li>
              ))}
              {parentContacts.length > 8 ? (
                <li>+{parentContacts.length - 8} more</li>
              ) : null}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-[var(--danger)]">
              No WhatsApp numbers on households for this section — set them in
              SIS.
            </p>
          )}
        </div>
      ) : null}

      <ModuleTabs
        items={TABS}
        value={tab}
        onChange={(id) => setTab(id as HwTab)}
      />

      {tab === "dashboard" ? (
        <ModuleDashboardHost
          moduleId="homework"
          onNavigateTab={(t) => setTab(t as HwTab)}
        />
      ) : null}

      {tab === "today" ? (
        <section className="mt-4 space-y-4">
          <h2 className="text-sm font-semibold text-[var(--brand-deep)]">
            Homework · {date}
          </h2>
          {todayPosts.length === 0 ? (
            <p className="rounded-xl border border-dashed border-[var(--border)] px-4 py-6 text-sm text-[var(--muted)]">
              No homework for this class/date.{" "}
              <button
                type="button"
                className="underline"
                onClick={() => setTab("compose")}
              >
                Compose
              </button>
            </p>
          ) : (
            <ul className="space-y-2">
              {todayPosts.map((p) => {
                const roster = rosterForSection(sis, p.sectionId, ay);
                const stats = seenPctForPost(state, p, roster);
                return (
                  <li
                    key={p.id}
                    className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-[var(--brand-deep)]">
                          {p.title}
                          {p.status === "withdrawn" ? (
                            <span className="ml-2 text-xs font-normal text-[var(--danger)]">
                              (withdrawn)
                            </span>
                          ) : null}
                        </p>
                        <p className="text-xs text-[var(--muted)]">
                          {subjectLabel(masters, p.subjectId)} ·{" "}
                          {classLabel(masters, p.classId, p.sectionId)} ·{" "}
                          {p.teacherName}
                          {p.dueAt ? ` · due ${p.dueAt}` : ""}
                          {p.requiresSubmit ? " · submit required" : ""}
                          {p.source === "google_classroom"
                            ? " · Classroom"
                            : ""}
                        </p>
                      </div>
                      <p className="text-xs font-medium text-[var(--brand-deep)]">
                        Seen {stats.seen}/{stats.total} ({stats.pct}%)
                        {p.whatsappNotifiedCount > 0
                          ? ` · WA ${p.whatsappNotifiedCount}`
                          : ""}
                      </p>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--brand-deep)]">
                      {p.bodyEn || p.bodyHi}
                    </p>
                    {p.bodyHi && p.bodyEn ? (
                      <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--muted)]">
                        {p.bodyHi}
                      </p>
                    ) : null}
                    {p.attachments[0]?.url ? (
                      p.attachments[0].url.startsWith("data:image") ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={p.attachments[0].url}
                          alt={p.attachments[0].label || "Attachment"}
                          className="mt-2 max-h-40 rounded-lg border border-[var(--border)]"
                        />
                      ) : (
                        <a
                          href={p.attachments[0].url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-2 inline-block text-xs font-medium text-[#1565c0] underline"
                        >
                          {p.attachments[0].label || "Attachment"}
                        </a>
                      )
                    ) : null}
                    {p.status === "published" ? (
                      <div className="mt-2 flex flex-wrap gap-3">
                        {!readOnly ? (
                          <button
                            type="button"
                            className="text-xs text-[var(--brand-deep)] underline"
                            onClick={() => beginEditPost(p)}
                          >
                            Edit
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="text-xs text-[#0f766e] underline"
                          onClick={() =>
                            setNotifyTarget({ kind: "homework", post: p })
                          }
                        >
                          Notify WhatsApp
                        </button>
                        {!readOnly ? (
                          <button
                            type="button"
                            className="text-xs text-[var(--danger)] underline"
                            onClick={() => {
                              withdrawHomeworkPost(p.id);
                              refresh();
                              flash("Post withdrawn");
                            }}
                          >
                            Withdraw
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}

          <h2 className="pt-2 text-sm font-semibold text-[var(--brand-deep)]">
            Class diary · {date}
          </h2>
          {todayDiary.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">No diary entries.</p>
          ) : (
            <ul className="space-y-2">
              {todayDiary.map((d) => (
                <li
                  key={d.id}
                  className="rounded-xl border border-[rgba(197,160,40,0.25)] bg-[#fffbeb] px-4 py-3"
                >
                  <p className="text-sm font-semibold text-[var(--brand-deep)]">
                    {d.title}
                  </p>
                  <p className="text-xs text-[var(--muted)]">{d.teacherName}</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm">
                    {d.bodyEn || d.bodyHi}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-3">
                    {!readOnly ? (
                      <>
                        <button
                          type="button"
                          className="text-xs text-[var(--brand-deep)] underline"
                          onClick={() => {
                            beginEditDiary(d);
                            setTab("diary");
                          }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="text-xs text-[var(--danger)] underline"
                          onClick={() => {
                            if (!window.confirm("Delete this diary entry?")) return;
                            const r = deleteDiaryEntry(d.id);
                            if (!r.ok) setError(r.error);
                            else {
                              refresh();
                              flash("Diary deleted");
                            }
                          }}
                        >
                          Delete
                        </button>
                      </>
                    ) : null}
                    <button
                      type="button"
                      className="text-xs text-[#0f766e] underline"
                      onClick={() =>
                        setNotifyTarget({ kind: "diary", diary: d })
                      }
                    >
                      Notify WhatsApp
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {tab === "classroom" && masters ? (
        <ClassroomSyncPanel
          masters={masters}
          academicYearCode={ay}
          teacherStaffId={teacherStaffId}
          teacherName={teacherName}
          onImported={(posts) => {
            refresh();
            if (posts.length) {
              flash(`Imported ${posts.length} from Google Classroom`);
            }
          }}
        />
      ) : null}

      {tab === "compose" ? (
        <section className="mt-4 max-w-xl space-y-3">
          <h2 className="text-sm font-semibold text-[var(--brand-deep)]">
            {editingPostId ? "Edit homework" : "Compose homework"}
          </h2>
          <label className="block text-xs text-[var(--muted)]">
            Subject
            <select
              className={`${field} mt-1 w-full`}
              value={subjectId}
              onChange={(e) => setSubjectId(e.target.value)}
            >
              {subjectOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nameEn}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-[var(--muted)]">
            Title
            <input
              className={`${field} mt-1 w-full`}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Fractions worksheet"
            />
          </label>
          <label className="block text-xs text-[var(--muted)]">
            English
            <textarea
              className={`${field} mt-1 w-full`}
              rows={3}
              value={bodyEn}
              onChange={(e) => setBodyEn(e.target.value)}
            />
          </label>
          <label className="block text-xs text-[var(--muted)]">
            Hindi (optional)
            <textarea
              className={`${field} mt-1 w-full`}
              rows={2}
              value={bodyHi}
              onChange={(e) => setBodyHi(e.target.value)}
            />
          </label>
          <div className="flex flex-wrap gap-3">
            <label className="text-xs text-[var(--muted)]">
              Due
              <input
                type="date"
                className={`${field} mt-1 block`}
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
              />
            </label>
            <label className="flex items-center gap-2 self-end pb-2 text-xs text-[var(--muted)]">
              <input
                type="checkbox"
                checked={requiresSubmit}
                onChange={(e) => setRequiresSubmit(e.target.checked)}
              />
              Require photo/note submit
            </label>
          </div>
          <label className="block text-xs text-[var(--muted)]">
            Attachment — photo/PDF or paste URL
            <input
              type="file"
              accept="image/*,application/pdf"
              className="mt-1 block w-full text-xs"
              onChange={(e) => {
                void onAttachFile(e.target.files?.[0] ?? null);
              }}
            />
            <input
              className={`${field} mt-1 w-full`}
              value={attachUrl.startsWith("data:") ? "" : attachUrl}
              onChange={(e) => {
                setAttachUrl(e.target.value);
                setAttachLabel("");
              }}
              placeholder={
                attachUrl.startsWith("data:")
                  ? `Attached: ${attachLabel || "file"} (clear URL to replace)`
                  : "https://… worksheet link"
              }
              disabled={attachUrl.startsWith("data:")}
            />
            {attachUrl.startsWith("data:image") ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={attachUrl}
                alt="Preview"
                className="mt-2 max-h-32 rounded-lg border"
              />
            ) : null}
            {attachUrl.startsWith("data:") ? (
              <button
                type="button"
                className="mt-1 text-xs underline"
                onClick={() => {
                  setAttachUrl("");
                  setAttachLabel("");
                }}
              >
                Remove file
              </button>
            ) : null}
          </label>
          <label className="block text-xs text-[var(--muted)]">
            AI Tutor chapter hint (optional)
            <input
              className={`${field} mt-1 w-full`}
              value={aiHint}
              onChange={(e) => setAiHint(e.target.value)}
              placeholder="e.g. MATH-FRAC-01"
            />
          </label>
          <button type="button" className={btn} onClick={publishHw} disabled={readOnly}>
            {editingPostId ? "Save changes" : "Publish homework"}
          </button>
          {editingPostId ? (
            <button type="button" className={btnOutline} onClick={resetComposeForm}>
              Cancel
            </button>
          ) : null}
        </section>
      ) : null}

      {tab === "diary" ? (
        <section className="mt-4 max-w-xl space-y-3">
          <h2 className="text-sm font-semibold text-[var(--brand-deep)]">
            {editingDiaryId ? "Edit diary entry" : "New diary entry"}
          </h2>
          <p className="text-sm text-[var(--muted)]">
            Class-level note (no subject) — assembly, holiday reminder, etc.
          </p>
          <label className="block text-xs text-[var(--muted)]">
            Title
            <input
              className={`${field} mt-1 w-full`}
              value={diaryTitle}
              onChange={(e) => setDiaryTitle(e.target.value)}
            />
          </label>
          <label className="block text-xs text-[var(--muted)]">
            English
            <textarea
              className={`${field} mt-1 w-full`}
              rows={3}
              value={diaryEn}
              onChange={(e) => setDiaryEn(e.target.value)}
            />
          </label>
          <label className="block text-xs text-[var(--muted)]">
            Hindi (optional)
            <textarea
              className={`${field} mt-1 w-full`}
              rows={2}
              value={diaryHi}
              onChange={(e) => setDiaryHi(e.target.value)}
            />
          </label>
          <button type="button" className={btn} onClick={publishDiary} disabled={readOnly}>
            {editingDiaryId ? "Save changes" : "Post diary"}
          </button>
          {editingDiaryId ? (
            <button type="button" className={btnOutline} onClick={resetDiaryForm}>
              Cancel
            </button>
          ) : null}
          {todayDiary.length > 0 ? (
            <div className="mt-6 space-y-2 border-t border-[var(--border)] pt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                Entries for {date}
              </h3>
              <ul className="space-y-2">
                {todayDiary.map((d) => (
                  <li
                    key={d.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] px-3 py-2"
                  >
                    <span className="text-sm font-medium text-[var(--brand-deep)]">
                      {d.title}
                    </span>
                    <DeskListActions
                      readOnly={readOnly}
                      onEdit={() => beginEditDiary(d)}
                      onDelete={() => {
                        const r = deleteDiaryEntry(d.id);
                        if (!r.ok) setError(r.error);
                        else {
                          if (editingDiaryId === d.id) resetDiaryForm();
                          refresh();
                          flash("Diary deleted");
                        }
                      }}
                      deleteConfirm={`Delete diary "${d.title}"?`}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {tab === "submissions" ? (
        <section className="mt-4 space-y-3">
          <p className="text-sm text-[var(--muted)]">
            Pending teacher acknowledgement. Acknowledge when reviewed.
          </p>
          {pendingSubs.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">No pending submissions.</p>
          ) : (
            <ul className="space-y-2">
              {pendingSubs.map(({ submission: s, post, student }) => (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-medium text-[var(--brand-deep)]">
                      {student?.fullName} · {post?.title}
                    </p>
                    <p className="text-xs text-[var(--muted)]">
                      {s.submittedAt.slice(0, 16).replace("T", " ")}
                      {s.note ? ` · ${s.note}` : ""}
                    </p>
                    {s.photoUrl ? (
                      s.photoUrl.startsWith("data:image") ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={s.photoUrl}
                          alt="Submission"
                          className="mt-1 max-h-24 rounded border"
                        />
                      ) : (
                        <a
                          href={s.photoUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-[#1565c0] underline"
                        >
                          Photo / file
                        </a>
                      )
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className={btn}
                    onClick={() => {
                      acknowledgeSubmission(s.id, teacherName);
                      refresh();
                      flash("Acknowledged");
                    }}
                  >
                    Ack
                  </button>
                </li>
              ))}
            </ul>
          )}

          {sectionId ? (
            <div className="pt-4">
              <h3 className="mb-2 text-sm font-semibold text-[var(--brand-deep)]">
                Roster snapshot · requires-submit posts today
              </h3>
              <RosterSubmitTable
                state={state}
                sis={sis}
                ay={ay}
                sectionId={sectionId}
                date={date}
              />
            </div>
          ) : null}
        </section>
      ) : null}

      {tab === "reports" ? (
        <section className="mt-4 space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-[var(--muted)]">
              From
              <input
                type="date"
                className={`${field} mt-1 block`}
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />
            </label>
            <label className="text-xs text-[var(--muted)]">
              To
              <input
                type="date"
                className={`${field} mt-1 block`}
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
              />
            </label>
            <label className="text-xs text-[var(--muted)]">
              Format
              <select
                className={`${field} mt-1 block`}
                value={format}
                onChange={(e) =>
                  setFormat(e.target.value as HomeworkReportFormat)
                }
              >
                <option value="excel">Excel</option>
                <option value="pdf">PDF</option>
              </select>
            </label>
          </div>
          <ul className="space-y-1.5">
            {HOMEWORK_REPORTS.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2"
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
                    const res = runHomeworkReport(r.id as HomeworkReportId, {
                      academicYearCode: ay,
                      fromDate,
                      toDate,
                      format,
                      homework: state,
                      masters,
                      sis,
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
    </ErpWorkspaceShell>
  );
}

function RosterSubmitTable({
  state,
  sis,
  ay,
  sectionId,
  date,
}: {
  state: HomeworkState;
  sis: SisState;
  ay: string;
  sectionId: string;
  date: string;
}) {
  const posts = listPostsForDay(state, {
    academicYearCode: ay,
    date,
    sectionId,
  }).filter((p) => p.requiresSubmit);
  const roster = rosterForSection(sis, sectionId, ay);
  if (!posts.length) {
    return (
      <p className="text-xs text-[var(--muted)]">
        No submit-required posts for this section today.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
      <table className="w-full text-left text-sm">
        <thead className="bg-[var(--surface-sunken)] text-xs text-[var(--muted)]">
          <tr>
            <th className="px-3 py-2">Student</th>
            {posts.map((p) => (
              <th key={p.id} className="px-3 py-2">
                {p.title.slice(0, 20)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {roster.map((stu) => (
            <tr key={stu.id} className="border-t border-[var(--border)]">
              <td className="px-3 py-2 font-medium">{stu.fullName}</td>
              {posts.map((p) => {
                const sub = submissionForStudent(state, p.id, stu.id);
                const seen = isSeen(state, "post", p.id, stu.id);
                return (
                  <td key={p.id} className="px-3 py-2 text-xs">
                    {sub ? (
                      <span className="text-[#0f7a4c]">
                        Submitted
                        {sub.teacherAckAt ? " · ack" : ""}
                      </span>
                    ) : seen ? (
                      <span className="text-[var(--muted)]">Seen</span>
                    ) : (
                      <span className="text-[var(--danger)]">Pending</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
