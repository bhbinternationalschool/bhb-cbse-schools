"use client";

import { useEffect, useMemo, useState } from "react";
import { DEFAULT_AY, loadMasters, type MastersState } from "@/lib/masters";
import { resolveParentHousehold } from "@/lib/parentPortal";
import { loadSis, type Household, type SisStudent } from "@/lib/sis";
import {
  isSeen,
  listFeedForStudent,
  loadHomework,
  markHomeworkSeen,
  readImageAsDataUrl,
  seedHomeworkIfEmpty,
  subjectLabel,
  submitHomework,
  submissionForStudent,
  type HomeworkState,
} from "@/lib/homework";
import { speakText } from "@/lib/voiceClient";
import { HomeworkTutorChat } from "@/components/parent/HomeworkTutorChat";
import { StudentNameLabel } from "@/components/students/StudentAvatar";
import { btn, btnOutline, field } from "@/components/ui/erp-ui";

export function ParentHomeworkPortal({
  guardianDisplayName,
}: {
  guardianDisplayName: string;
}) {
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [household, setHousehold] = useState<Household | null>(null);
  const [children, setChildren] = useState<SisStudent[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hw, setHw] = useState<HomeworkState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitNote, setSubmitNote] = useState("");
  const [submitUrl, setSubmitUrl] = useState("");
  const [listeningId, setListeningId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  function flash(msg: string) {
    setNotice(msg);
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
      setHw(seedHomeworkIfEmpty(DEFAULT_AY));
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
    setActiveId(aid);
    const childAy =
      kids.find((k) => k.id === aid)?.academicYearCode || DEFAULT_AY;
    setHw(seedHomeworkIfEmpty(childAy));
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guardianDisplayName]);

  const child = useMemo(
    () => children.find((c) => c.id === activeId) ?? null,
    [children, activeId],
  );

  const feed = useMemo(() => {
    if (!hw || !child) return { posts: [], diary: [] };
    return listFeedForStudent(hw, child);
  }, [hw, child]);

  function speak(text: string, id: string) {
    setListeningId(id);
    void speakText(text, { lang: "auto", preferGoogle: true }).finally(() =>
      setListeningId(null),
    );
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
        </p>
      ) : null}

      {!child ? (
        <p className="text-sm text-[var(--muted)]">No children on household.</p>
      ) : (
        <div className="space-y-3">
          {feed.diary.map((d) => {
            const seen = isSeen(hw!, "diary", d.id, child.id);
            const text = d.bodyHi || d.bodyEn;
            return (
              <article
                key={d.id}
                className="rounded-xl border border-[rgba(197,160,40,0.3)] bg-[#fffbeb] px-3 py-3"
              >
                <p className="text-[10px] font-bold uppercase tracking-wide text-[#8a6d12]">
                  Class diary · {d.date}
                </p>
                <p className="mt-1 text-sm font-semibold text-[var(--brand-deep)]">
                  {d.title}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm">{text}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="text-xs font-semibold text-[#1565c0] underline"
                    onClick={() => speak(text, d.id)}
                  >
                    {listeningId === d.id ? "Listening…" : "Listen"}
                  </button>
                  {!seen ? (
                    <button
                      type="button"
                      className="text-xs font-semibold text-[var(--brand-deep)] underline"
                      onClick={() => {
                        markHomeworkSeen({
                          kind: "diary",
                          refId: d.id,
                          studentId: child.id,
                          householdId: household.id,
                        });
                        setHw(loadHomework());
                        flash("Marked seen");
                      }}
                    >
                      Mark seen
                    </button>
                  ) : (
                    <span className="text-xs text-[var(--muted)]">Seen</span>
                  )}
                </div>
              </article>
            );
          })}

          {feed.posts.map((p) => {
            const seen = isSeen(hw!, "post", p.id, child.id);
            const sub = submissionForStudent(hw!, p.id, child.id);
            const text = p.bodyHi || p.bodyEn;
            const subj = masters
              ? subjectLabel(masters, p.subjectId)
              : p.subjectId;
            return (
              <article
                key={p.id}
                className="rounded-xl border border-[rgba(32,48,80,0.1)] bg-white px-3 py-3 shadow-sm"
              >
                <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">
                  {subj} · {p.date}
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
                {p.attachments[0]?.url ? (
                  <a
                    href={p.attachments[0].url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-block text-xs text-[#1565c0] underline"
                  >
                    Attachment
                  </a>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="text-xs font-semibold text-[#1565c0] underline"
                    onClick={() => speak(text, p.id)}
                  >
                    {listeningId === p.id ? "Listening…" : "Listen"}
                  </button>
                  {!seen ? (
                    <button
                      type="button"
                      className="text-xs font-semibold text-[var(--brand-deep)] underline"
                      onClick={() => {
                        markHomeworkSeen({
                          kind: "post",
                          refId: p.id,
                          studentId: child.id,
                          householdId: household.id,
                        });
                        setHw(loadHomework());
                        flash("Marked seen");
                      }}
                    >
                      Mark seen
                    </button>
                  ) : (
                    <span className="text-xs text-[var(--muted)]">Seen</span>
                  )}
                </div>
                <HomeworkTutorChat
                  context={{
                    childName: child.fullName,
                    className:
                      masters?.classes.find((c) => c.id === child.classId)
                        ?.name || "",
                    subjectLabel: subj,
                    homeworkTitle: p.title,
                    homeworkBody: text,
                  }}
                  onError={flash}
                />
                {p.requiresSubmit ? (
                  <div className="mt-3 space-y-2 rounded-lg bg-[rgba(32,48,80,0.04)] p-2">
                    {sub ? (
                      <div className="space-y-1">
                        <p className="text-xs text-[var(--success)]">
                          Submitted {sub.submittedAt.slice(0, 10)}
                          {sub.teacherAckAt ? " · teacher acknowledged" : ""}
                        </p>
                        {sub.photoUrl?.startsWith("data:image") ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={sub.photoUrl}
                            alt="Your submission"
                            className="max-h-28 rounded border"
                          />
                        ) : null}
                      </div>
                    ) : (
                      <>
                        <input
                          className={`${field} w-full`}
                          placeholder="Note (optional)"
                          value={submitNote}
                          onChange={(e) => setSubmitNote(e.target.value)}
                        />
                        <label className="block text-[11px] text-[var(--muted)]">
                          Photo of homework
                          <input
                            type="file"
                            accept="image/*"
                            capture="environment"
                            className="mt-1 block w-full text-xs"
                            disabled={uploading}
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              setUploading(true);
                              void readImageAsDataUrl(file).then((r) => {
                                setUploading(false);
                                if (!r.ok) {
                                  flash(r.error);
                                  return;
                                }
                                setSubmitUrl(r.url);
                                flash("Photo attached");
                              });
                            }}
                          />
                        </label>
                        {submitUrl.startsWith("data:image") ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={submitUrl}
                            alt="Preview"
                            className="max-h-28 rounded border"
                          />
                        ) : (
                          <input
                            className={`${field} w-full`}
                            placeholder="Or paste photo URL"
                            value={submitUrl}
                            onChange={(e) => setSubmitUrl(e.target.value)}
                          />
                        )}
                        <button
                          type="button"
                          className="rounded-lg bg-[var(--brand-deep)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                          disabled={uploading}
                          onClick={() => {
                            const r = submitHomework({
                              postId: p.id,
                              studentId: child.id,
                              note: submitNote,
                              photoUrl: submitUrl,
                            });
                            if (!r.ok) {
                              flash(r.error);
                              return;
                            }
                            markHomeworkSeen({
                              kind: "post",
                              refId: p.id,
                              studentId: child.id,
                              householdId: household.id,
                            });
                            setSubmitNote("");
                            setSubmitUrl("");
                            setHw(loadHomework());
                            flash("Submitted");
                          }}
                        >
                          Submit homework
                        </button>
                      </>
                    )}
                  </div>
                ) : null}
              </article>
            );
          })}

          {feed.posts.length === 0 && feed.diary.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--muted)]">
              No homework yet for this child.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
