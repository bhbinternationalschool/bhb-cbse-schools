"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  classLabel,
  importClassroomHomeworkPosts,
  listImportedClassroomCourseWorkIds,
  subjectLabel,
  type HomeworkPost,
} from "@/lib/homework";
import {
  disconnectClassroom,
  fetchClassroomCourses,
  fetchClassroomStatus,
  pullClassroomHomework,
  saveClassroomMapping,
  type ClassroomCourseRow,
  type ClassroomStatus,
} from "@/lib/homeworkClassroomClient";
import type { MastersState } from "@/lib/masters";
import { btn, btnOutline, field } from "@/components/ui/erp-ui";

type Props = {
  masters: MastersState;
  academicYearCode: string;
  teacherStaffId: string;
  teacherName: string;
  onImported: (posts: HomeworkPost[]) => void;
};

export function ClassroomSyncPanel({
  masters,
  academicYearCode,
  teacherStaffId,
  teacherName,
  onImported,
}: Props) {
  const [status, setStatus] = useState<ClassroomStatus | null>(null);
  const [courses, setCourses] = useState<ClassroomCourseRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sinceDays, setSinceDays] = useState(30);

  const classOptions = masters.classes.filter((c) => c.isActive !== false);
  const sectionOptions = useMemo(() => {
    if (!courses.length) return masters.sections;
    return masters.sections;
  }, [masters.sections, courses.length]);
  const subjectOptions = masters.subjects.filter((s) => s.isActive !== false);

  const refresh = useCallback(async () => {
    const s = await fetchClassroomStatus();
    setStatus(s);
    if (s.connected) {
      const c = await fetchClassroomCourses();
      if (c.ok && c.courses) setCourses(c.courses);
      else if (c.error) setError(c.error);
    } else {
      setCourses([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("connected") === "1") {
      setNotice("Google Classroom connected.");
      params.delete("connected");
      const q = params.toString();
      window.history.replaceState(
        {},
        "",
        `${window.location.pathname}${q ? `?${q}` : ""}`,
      );
    }
    const err = params.get("error");
    if (err) {
      setError(decodeURIComponent(err));
      params.delete("error");
      const q = params.toString();
      window.history.replaceState(
        {},
        "",
        `${window.location.pathname}${q ? `?${q}` : ""}`,
      );
    }
  }, [refresh]);

  async function onSaveMapping(course: ClassroomCourseRow, patch: {
    classId: string;
    sectionId: string;
    subjectId: string;
  }) {
    setBusy(true);
    setError(null);
    const r = await saveClassroomMapping({
      courseId: course.id,
      courseName: course.name,
      ...patch,
      enabled: !!(patch.classId && patch.sectionId && patch.subjectId),
    });
    setBusy(false);
    if (!r.ok) {
      setError(r.error || "Could not save mapping");
      return;
    }
    setNotice(`Mapped ${course.name}`);
    await refresh();
  }

  async function onSync() {
    setBusy(true);
    setError(null);
    try {
      const existing = listImportedClassroomCourseWorkIds();
      const pull = await pullClassroomHomework({ sinceDays, existingCourseWorkIds: existing });
      if (!pull.ok || !pull.drafts) {
        setError(pull.error || "Sync failed");
        return;
      }
      if (!pull.drafts.length) {
        setNotice(
          `No new assignments in last ${sinceDays} days (${pull.scanned ?? 0} scanned, ${pull.skippedExisting ?? 0} already in ERP)`,
        );
        await refresh();
        return;
      }
      const result = importClassroomHomeworkPosts(
        pull.drafts.map((d) => ({
          academicYearCode,
          teacherStaffId,
          teacherName,
          googleCourseWorkId: d.googleCourseWorkId,
          googleCourseId: d.googleCourseId,
          classId: d.classId,
          sectionId: d.sectionId,
          subjectId: d.subjectId,
          title: d.title,
          bodyEn: d.bodyEn,
          date: d.date,
          dueAt: d.dueAt,
          requiresSubmit: d.requiresSubmit,
          attachments: d.attachments.map((a, i) => ({
            id: `att_gc_${i}`,
            label: a.label,
            url: a.url,
          })),
        })),
      );
      onImported(result.imported);
      setNotice(
        `Imported ${result.imported.length} assignment(s) · skipped ${result.skipped}`,
      );
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function onDisconnect() {
    setBusy(true);
    await disconnectClassroom();
    setBusy(false);
    setNotice("Disconnected Google Classroom");
    await refresh();
  }

  if (!status) {
    return (
      <p className="text-sm text-[var(--muted)]">Loading Classroom status…</p>
    );
  }

  return (
    <section className="mt-4 space-y-4">
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="text-sm font-semibold text-[var(--brand-deep)]">
          Google Classroom → ERP (pull only)
        </h2>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Connect your teacher Google account, map each Classroom course to a
          class–section–subject, then sync. Parents see imported work in the ERP
          parent portal and class WhatsApp — no need to post twice.
        </p>

        {!status.oauthConfigured ? (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Server needs{" "}
            <code className="text-[10px]">GOOGLE_OAUTH_CLIENT_ID</code> and{" "}
            <code className="text-[10px]">GOOGLE_OAUTH_CLIENT_SECRET</code>{" "}
            (enable Classroom API in Google Cloud). Redirect URI:{" "}
            <code className="text-[10px]">{status.redirectUri}</code>
          </p>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {status.connected ? (
            <>
              <span className="rounded-full bg-[#ecfdf5] px-2.5 py-1 text-xs font-medium text-[#047857]">
                Connected · {status.email}
              </span>
              <button
                type="button"
                className={btnOutline}
                disabled={busy}
                onClick={() => void onDisconnect()}
              >
                Disconnect
              </button>
            </>
          ) : (
            <a
              href="/api/integrations/google/classroom/connect"
              className={`${btn} inline-block no-underline`}
            >
              Connect Google Classroom
            </a>
          )}
        </div>

        {status.lastSyncAt ? (
          <p className="mt-2 text-[10px] text-[var(--muted)]">
            Last sync: {new Date(status.lastSyncAt).toLocaleString("en-IN")}
          </p>
        ) : null}
      </div>

      {status.connected ? (
        <>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
              Course mapping
            </h3>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Map each Classroom course once (school-wide). Only mapped courses
              are imported.
            </p>
            {courses.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--muted)]">
                No active courses on this Google account.
              </p>
            ) : (
              <ul className="mt-3 space-y-3">
                {courses.map((course) => (
                  <CourseMappingRow
                    key={course.id}
                    course={course}
                    classOptions={classOptions}
                    sectionOptions={sectionOptions}
                    subjectOptions={subjectOptions}
                    masters={masters}
                    disabled={busy}
                    onSave={onSaveMapping}
                  />
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
              Sync assignments
            </h3>
            <div className="mt-2 flex flex-wrap items-end gap-3">
              <label className="text-xs text-[var(--muted)]">
                Look back (days)
                <input
                  type="number"
                  min={7}
                  max={90}
                  className={`${field} mt-1 block w-24`}
                  value={sinceDays}
                  onChange={(e) =>
                    setSinceDays(Math.max(7, Number(e.target.value) || 30))
                  }
                />
              </label>
              <button
                type="button"
                className={btn}
                disabled={busy || status.mappingsCount === 0}
                onClick={() => void onSync()}
              >
                {busy ? "Syncing…" : "Sync now"}
              </button>
            </div>
            {status.mappingsCount === 0 ? (
              <p className="mt-2 text-xs text-amber-800">
                Save at least one course mapping before syncing.
              </p>
            ) : null}
          </div>
        </>
      ) : null}

      {notice ? (
        <p className="text-sm text-[#047857]">{notice}</p>
      ) : null}
      {error ? (
        <p className="text-sm text-[var(--danger)]">{error}</p>
      ) : null}
    </section>
  );
}

function CourseMappingRow({
  course,
  classOptions,
  sectionOptions,
  subjectOptions,
  masters,
  disabled,
  onSave,
}: {
  course: ClassroomCourseRow;
  classOptions: MastersState["classes"];
  sectionOptions: MastersState["sections"];
  subjectOptions: MastersState["subjects"];
  masters: MastersState;
  disabled: boolean;
  onSave: (
    course: ClassroomCourseRow,
    patch: { classId: string; sectionId: string; subjectId: string },
  ) => void | Promise<void>;
}) {
  const [classId, setClassId] = useState(course.mapping?.classId || "");
  const [sectionId, setSectionId] = useState(course.mapping?.sectionId || "");
  const [subjectId, setSubjectId] = useState(course.mapping?.subjectId || "");

  const sectionsForClass = sectionOptions.filter(
    (s) => !classId || s.classId === classId,
  );

  const mappedLabel =
    course.mapping?.enabled && course.mapping.classId
      ? `${classLabel(masters, course.mapping.classId, course.mapping.sectionId)} · ${subjectLabel(masters, course.mapping.subjectId)}`
      : null;

  return (
    <li className="rounded-lg border border-[var(--border)] p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-[var(--brand-deep)]">
            {course.name}
            {course.section ? (
              <span className="font-normal text-[var(--muted)]">
                {" "}
                · {course.section}
              </span>
            ) : null}
          </p>
          {mappedLabel ? (
            <p className="text-[10px] text-[#047857]">Mapped: {mappedLabel}</p>
          ) : (
            <p className="text-[10px] text-[var(--muted)]">Not mapped</p>
          )}
        </div>
        {course.alternateLink ? (
          <a
            href={course.alternateLink}
            target="_blank"
            rel="noreferrer"
            className="text-[10px] text-[var(--brand-deep)] underline"
          >
            Open in Classroom
          </a>
        ) : null}
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-4">
        <select
          className={field}
          value={classId}
          disabled={disabled}
          onChange={(e) => {
            setClassId(e.target.value);
            setSectionId("");
          }}
        >
          <option value="">Class</option>
          {classOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          className={field}
          value={sectionId}
          disabled={disabled}
          onChange={(e) => setSectionId(e.target.value)}
        >
          <option value="">Section</option>
          {sectionsForClass.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select
          className={field}
          value={subjectId}
          disabled={disabled}
          onChange={(e) => setSubjectId(e.target.value)}
        >
          <option value="">Subject</option>
          {subjectOptions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nameEn}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={btnOutline}
          disabled={disabled || !classId || !sectionId || !subjectId}
          onClick={() =>
            void onSave(course, { classId, sectionId, subjectId })
          }
        >
          Save map
        </button>
      </div>
    </li>
  );
}
