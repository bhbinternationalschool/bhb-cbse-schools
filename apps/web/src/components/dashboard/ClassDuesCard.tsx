"use client";

import { useEffect, useState } from "react";
import { IndianRupee, MessageCircle, Phone } from "lucide-react";

/**
 * Fee dues of the class teacher's own class, on the teacher home.
 *
 * Read-only and server-scoped (GET /api/v1/staff/fees/defaulters answers a
 * class teacher with their class-teacher sections only). The director asked
 * that each class teacher see who in their class owes fees, 2026-09-29.
 */

type Child = {
  studentId: string;
  fullName: string;
  classLabel: string;
  openLabel: string;
  overdueDays: number;
  promisedOn: string;
};
type Household = {
  householdId: string;
  guardianName: string;
  mobile: string;
  openLabel: string;
  overdueDays: number;
  children: Child[];
};
type Dues = {
  asOf: string;
  totalOpenLabel: string;
  householdCount: number;
  households: Household[];
};

function digits10(mobile: string): string {
  const d = (mobile || "").replace(/\D/g, "");
  return d.length > 10 ? d.slice(-10) : d;
}

export function ClassDuesCard() {
  const [dues, setDues] = useState<Dues | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/v1/staff/fees/defaulters", { cache: "no-store" });
        const body = (await res.json().catch(() => null)) as {
          ok?: boolean;
          data?: Dues;
          error?: { message?: string };
        } | null;
        if (!alive) return;
        if (!res.ok || !body?.ok || !body.data) {
          // Not a class teacher (403) → no card. Anything else is an error,
          // shown as one: an unknown is not "nobody owes".
          if (res.status !== 403) setError(body?.error?.message || "Could not load fee dues");
          return;
        }
        setDues(body.data);
      } catch {
        if (alive) setError("Could not load fee dues");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (error) {
    return (
      <p className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-xs text-[var(--muted)]">
        Fee dues: {error}
      </p>
    );
  }
  if (!dues) return null;

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 text-left"
        aria-expanded={open}
      >
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--warning-soft)] text-[var(--warning)]">
          <IndianRupee className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-[var(--brand-deep)]">
            Fee dues in your class
          </span>
          <span className="block text-xs text-[var(--muted)]">
            {dues.householdCount === 0
              ? `Nothing due as of ${dues.asOf}`
              : `${dues.totalOpenLabel} · ${dues.householdCount} ${dues.householdCount === 1 ? "family" : "families"} · as of ${dues.asOf}`}
          </span>
        </span>
        {dues.householdCount > 0 ? (
          <span className="text-xs font-semibold text-[var(--brand-deep)]">
            {open ? "Hide" : "Show"}
          </span>
        ) : null}
      </button>

      {open && dues.householdCount > 0 ? (
        <ul className="mt-3 max-h-[26rem] divide-y divide-[var(--border)] overflow-y-auto">
          {dues.households.map((h) => {
            const m = digits10(h.mobile);
            return (
              <li key={h.householdId || h.children[0]?.studentId} className="py-2.5">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    {h.children.map((c) => (
                      <p key={c.studentId} className="text-sm font-semibold text-[var(--brand-deep)]">
                        {c.fullName}{" "}
                        <span className="text-[11px] font-medium text-[var(--muted)]">
                          {c.classLabel} · {c.openLabel}
                          {c.overdueDays > 0 ? ` · ${c.overdueDays} days overdue` : ""}
                          {c.promisedOn ? ` · promised ${c.promisedOn}` : ""}
                        </span>
                      </p>
                    ))}
                    <p className="text-[11px] text-[var(--muted)]">
                      {h.guardianName}
                      {h.children.length > 1 ? ` · family total ${h.openLabel}` : ""}
                    </p>
                  </div>
                  {m.length === 10 ? (
                    <div className="flex shrink-0 gap-1.5">
                      <a
                        href={`tel:+91${m}`}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--brand-deep)]"
                        aria-label={`Call ${h.guardianName}`}
                      >
                        <Phone className="h-4 w-4" />
                      </a>
                      <a
                        href={`https://wa.me/91${m}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border)] text-[#16a34a]"
                        aria-label={`WhatsApp ${h.guardianName}`}
                      >
                        <MessageCircle className="h-4 w-4" />
                      </a>
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
