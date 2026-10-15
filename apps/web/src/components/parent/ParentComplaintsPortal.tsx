"use client";

import { useState } from "react";
import { btn, field } from "@/components/ui/erp-ui";
import {
  Flash,
  ParentReadState,
  WithChildren,
  parentPost,
  useFlash,
  useParentRead,
  useParentRefresh,
  type ParentChild,
} from "@/components/parent/parentData";

/** GET /api/v1/complaints/list — the family's tickets (the app's Complaints screen). */
type ComplaintList = {
  tickets: {
    id: string;
    studentId: string | null;
    studentName: string;
    category: string;
    categoryLabel: string;
    subject: string;
    description: string;
    date: string;
    status: string;
    statusLabel: string;
    resolutionNote: string;
  }[];
  categories: { value: string; label: string }[];
};

const KEY = ["complaints"] as const;

/** Complaints of the parent's own household, read and raised on the server. */
export function ParentComplaintsPortal() {
  return (
    <WithChildren>{(list) => <ComplaintsForFamily list={list} />}</WithChildren>
  );
}

function ComplaintsForFamily({ list }: { list: ParentChild[] }) {
  const query = useParentRead<ComplaintList>(
    KEY,
    "/api/v1/complaints/list",
    (v) => Array.isArray(v.tickets) && Array.isArray(v.categories),
    "Complaints",
  );
  const refresh = useParentRefresh();
  const flash = useFlash();
  const [aboutChildId, setAboutChildId] = useState("");
  const [category, setCategory] = useState("");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <div className="px-4 pb-8 pt-3">
      <ParentReadState query={query} what="your complaints">
        {(c) => {
          const cat = category || c.categories[0]?.value || "other";
          async function submit() {
            setBusy(true);
            const r = await parentPost("/api/v1/complaints/create", {
              studentId: aboutChildId || undefined,
              category: cat,
              subject,
              description,
            });
            setBusy(false);
            if (!r.ok) return flash.fail(r.error);
            setSubject("");
            setDescription("");
            await refresh(KEY);
            flash.ok("Complaint submitted — school will follow up.");
          }
          return (
            <div className="space-y-4" data-testid="parent-complaints">
              <Flash notice={flash.notice} error={flash.error} />
              <section className="space-y-3">
                <h2 className="text-sm font-semibold text-[var(--brand-deep)]">
                  Raise a complaint
                </h2>
                <label className="block text-xs text-[var(--muted)]">
                  About (optional)
                  <select
                    className={`${field} mt-1 w-full`}
                    value={aboutChildId}
                    onChange={(e) => setAboutChildId(e.target.value)}
                  >
                    <option value="">General / not child-specific</option>
                    {list.map((ch) => (
                      <option key={ch.id} value={ch.id}>
                        {ch.fullName}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs text-[var(--muted)]">
                  Category
                  <select
                    className={`${field} mt-1 w-full`}
                    value={cat}
                    onChange={(e) => setCategory(e.target.value)}
                  >
                    {c.categories.map((x) => (
                      <option key={x.value} value={x.value}>
                        {x.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs text-[var(--muted)]">
                  Subject
                  <input
                    className={`${field} mt-1 w-full`}
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                  />
                </label>
                <label className="block text-xs text-[var(--muted)]">
                  Details
                  <textarea
                    className={`${field} mt-1 w-full`}
                    rows={3}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className={btn}
                  disabled={busy}
                  onClick={() => void submit()}
                >
                  {busy ? "Sending…" : "Submit complaint"}
                </button>
              </section>
              <section>
                <h2 className="mb-2 text-sm font-semibold text-[var(--brand-deep)]">
                  Your complaints
                </h2>
                {c.tickets.length === 0 ? (
                  <p className="text-sm text-[var(--muted)]">
                    No complaints raised yet.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {c.tickets.map((t) => (
                      <li
                        key={t.id}
                        data-complaint-id={t.id}
                        className="rounded-xl border border-[rgba(32,48,80,0.1)] bg-[var(--card)] px-3 py-3"
                      >
                        <p className="text-sm font-medium text-[var(--brand-deep)]">
                          {t.subject}
                        </p>
                        <p className="text-xs text-[var(--muted)]">
                          {t.categoryLabel} · {t.date} · {t.statusLabel}
                          {t.studentName ? ` · ${t.studentName}` : ""}
                        </p>
                        <p className="mt-1 text-sm">{t.description}</p>
                        {t.resolutionNote ? (
                          <p className="mt-1 text-xs text-[var(--success)]">
                            Resolution: {t.resolutionNote}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          );
        }}
      </ParentReadState>
    </div>
  );
}
