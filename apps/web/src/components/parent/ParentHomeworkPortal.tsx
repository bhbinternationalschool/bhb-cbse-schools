"use client";

import { useState } from "react";
import { speakText } from "@/lib/voiceClient";
import { HomeworkTutorChat } from "@/components/parent/HomeworkTutorChat";
import {
  ChildPicker,
  Flash,
  ParentReadState,
  WithChildren,
  useActiveChild,
  useFlash,
  useParentRead,
  type ParentChild,
} from "@/components/parent/parentData";

/** GET /api/v1/homework/feed?studentId= — the app's Homework screen. */
type HomeworkFeed = {
  posts: {
    id: string;
    date: string;
    title: string;
    bodyEn: string;
    bodyHi: string;
    subjectName: string;
    teacherName: string;
    dueAt: string | null;
    requiresSubmit: boolean;
    attachmentCount: number;
    /** Each file, opened through /api/v1/homework/attachment (older servers omit it). */
    attachments?: { id: string; label: string; url: string }[];
  }[];
  diary: {
    id: string;
    date: string;
    title: string;
    bodyEn: string;
    bodyHi: string;
    teacherName: string;
  }[];
};

/**
 * Homework and the class diary for the parent's own child, read on the server
 * (a child of another family is refused there). The old "Mark seen" and
 * "Submit homework" buttons wrote to this browser only — the office never
 * received them — so they are not offered here.
 */
export function ParentHomeworkPortal() {
  return (
    <WithChildren>{(list) => <HomeworkForFamily list={list} />}</WithChildren>
  );
}

function HomeworkForFamily({ list }: { list: ParentChild[] }) {
  const { child, setActiveId } = useActiveChild(list);
  return (
    <div className="px-4 pb-8 pt-3">
      <ChildPicker list={list} child={child} onPick={setActiveId} />
      {child ? <HomeworkFor child={child} key={child.id} /> : null}
    </div>
  );
}

function HomeworkFor({ child }: { child: ParentChild }) {
  const feed = useParentRead<HomeworkFeed>(
    ["homework", child.id],
    `/api/v1/homework/feed?studentId=${encodeURIComponent(child.id)}`,
    (v) => Array.isArray(v.posts) && Array.isArray(v.diary),
    "Homework",
  );
  const flash = useFlash();
  const [listeningId, setListeningId] = useState<string | null>(null);

  function speak(text: string, id: string) {
    setListeningId(id);
    void speakText(text, { lang: "auto", preferGoogle: true }).finally(() =>
      setListeningId(null),
    );
  }

  return (
    <ParentReadState query={feed} what="homework">
      {(f) => (
        <div className="space-y-3" data-testid="parent-homework">
          <Flash notice={flash.notice} error={flash.error} />
          {f.diary.map((d) => {
            const text = d.bodyHi || d.bodyEn;
            return (
              <article
                key={d.id}
                className="rounded-xl border border-[rgba(197,160,40,0.3)] bg-[var(--card)] px-3 py-3"
              >
                <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--tone-amber)]">
                  Class diary · {d.date}
                </p>
                <p className="mt-1 text-sm font-semibold text-[var(--brand-deep)]">
                  {d.title}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm">{text}</p>
                <button
                  type="button"
                  className="mt-2 text-xs font-semibold text-[var(--brand-mid)] underline"
                  onClick={() => speak(text, d.id)}
                >
                  {listeningId === d.id ? "Listening…" : "Listen"}
                </button>
              </article>
            );
          })}
          {f.posts.map((p) => {
            const text = p.bodyHi || p.bodyEn;
            return (
              <article
                key={p.id}
                data-homework-id={p.id}
                className="rounded-xl border border-[rgba(32,48,80,0.1)] bg-[var(--card)] px-3 py-3 shadow-sm"
              >
                <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">
                  {p.subjectName || "Homework"} · {p.date}
                  {p.dueAt ? ` · due ${p.dueAt}` : ""}
                </p>
                <p className="mt-1 text-sm font-semibold text-[var(--brand-deep)]">
                  {p.title}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm">{text}</p>
                {p.bodyEn && p.bodyHi ? (
                  <p className="mt-1 whitespace-pre-wrap text-xs text-[var(--muted)]">
                    {p.bodyEn}
                  </p>
                ) : null}
                <p className="mt-1 text-[11px] text-[var(--muted)]">
                  {[
                    p.teacherName,
                    p.attachmentCount > 0 && !p.attachments?.length
                      ? `${p.attachmentCount} attachment${p.attachmentCount > 1 ? "s" : ""} — open in the BHB Parent app`
                      : "",
                    p.requiresSubmit ? "to be submitted" : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {/* Every file, opened through /api/v1/homework/attachment —
                    the stored /api/file reference is staff-only. */}
                {(p.attachments ?? []).map((a) => (
                  <a
                    key={a.id}
                    href={a.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mr-3 mt-1 inline-block text-xs text-[var(--brand-mid)] underline"
                  >
                    {a.label || "Attachment"}
                  </a>
                ))}
                <button
                  type="button"
                  className="mt-2 text-xs font-semibold text-[var(--brand-mid)] underline"
                  onClick={() => speak(text, p.id)}
                >
                  {listeningId === p.id ? "Listening…" : "Listen"}
                </button>
                <HomeworkTutorChat
                  studentId={child.id}
                  context={{
                    childName: child.fullName,
                    className: child.classLabel,
                    subjectLabel: p.subjectName,
                    homeworkTitle: p.title,
                    homeworkBody: text,
                  }}
                  onError={flash.fail}
                />
              </article>
            );
          })}
          {f.posts.length === 0 && f.diary.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--muted)]">
              No homework yet for this child.
            </p>
          ) : null}
        </div>
      )}
    </ParentReadState>
  );
}
