"use client";

import { useEffect, useMemo, useState } from "react";
import { resolveParentHousehold } from "@/lib/parentPortal";
import { loadSis, type Household, type SisStudent } from "@/lib/sis";
import { btn, field } from "@/components/ui/erp-ui";
import {
  complaintCategoryLabel,
  complaintStatusLabel,
  createComplaintTicket,
  listTicketsForHousehold,
  loadComplaints,
  COMPLAINT_CATEGORIES,
  type ComplaintCategory,
  type ComplaintState,
  type ComplaintTicket,
} from "@/lib/complaints";

export function ParentComplaintsPortal({
  guardianDisplayName,
}: {
  guardianDisplayName: string;
}) {
  const [household, setHousehold] = useState<Household | null>(null);
  const [children, setChildren] = useState<SisStudent[]>([]);
  const [complaints, setComplaints] = useState<ComplaintState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [aboutChildId, setAboutChildId] = useState<string>("");
  const [category, setCategory] = useState<ComplaintCategory>("other");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");

  function flash(msg: string) {
    setNotice(msg);
    setError(null);
    window.setTimeout(() => setNotice(null), 2800);
  }

  function reload() {
    const sis = loadSis();
    setComplaints(loadComplaints());
    const hh = resolveParentHousehold(sis, {
      guardianName: guardianDisplayName,
      mobile: "9876543210",
    });
    setHousehold(hh);
    if (!hh) {
      setChildren([]);
      return;
    }
    setChildren(sis.students.filter((s) => s.householdId === hh.id && s.status === "active"));
  }

  useEffect(() => {
    reload();
    void (async () => {
      const [{ ensureSisHydrated }, { withHydrationSlot }] = await Promise.all([
        import("@/lib/sisPersistence"),
        import("@/lib/deskHydrateGuard"),
      ]);
      await withHydrationSlot(() => ensureSisHydrated());
      reload();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guardianDisplayName]);

  const tickets = useMemo((): ComplaintTicket[] => {
    if (!complaints || !household) return [];
    return listTicketsForHousehold(complaints, household.id);
  }, [complaints, household]);

  function submit() {
    if (!household) return;
    const r = createComplaintTicket({
      householdId: household.id,
      studentId: aboutChildId || null,
      raisedByName: household.guardianName,
      raisedByMobile: household.mobile,
      category,
      subject,
      description,
    });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setSubject("");
    setDescription("");
    setComplaints(loadComplaints());
    flash("Complaint submitted — school will follow up.");
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
      {error ? (
        <p className="mb-3 rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="mb-3 rounded-lg bg-[var(--success-soft)] px-3 py-2 text-sm text-[var(--success)]">
          {notice}
        </p>
      ) : null}

      <div className="space-y-4">
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-[var(--brand-deep)]">
            Raise a complaint
          </h2>
          {children.length > 0 ? (
            <label className="block text-xs text-[var(--muted)]">
              About (optional)
              <select
                className={`${field} mt-1 w-full`}
                value={aboutChildId}
                onChange={(e) => setAboutChildId(e.target.value)}
              >
                <option value="">General / not child-specific</option>
                {children.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.fullName}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="block text-xs text-[var(--muted)]">
            Category
            <select
              className={`${field} mt-1 w-full`}
              value={category}
              onChange={(e) => setCategory(e.target.value as ComplaintCategory)}
            >
              {COMPLAINT_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
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
          <button type="button" className={btn} onClick={submit}>
            Submit complaint
          </button>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold text-[var(--brand-deep)]">
            Your complaints
          </h2>
          {tickets.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">No complaints raised yet.</p>
          ) : (
            <ul className="space-y-2">
              {tickets.map((t) => (
                <li
                  key={t.id}
                  className="rounded-xl border border-[rgba(32,48,80,0.1)] bg-white px-3 py-3"
                >
                  <p className="text-sm font-medium text-[var(--brand-deep)]">
                    {t.subject}
                  </p>
                  <p className="text-xs text-[var(--muted)]">
                    {complaintCategoryLabel(t.category)} · {t.date} · {complaintStatusLabel(t.status)}
                  </p>
                  <p className="mt-1 text-sm">{t.description}</p>
                  {t.status === "resolved" && t.resolutionNote ? (
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
    </div>
  );
}
