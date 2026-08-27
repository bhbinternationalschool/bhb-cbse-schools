"use client";

/** Public registration — any school's student can be entered by a guardian. */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { TENANT } from "@/lib/types";

type EventInfo = {
  name: string;
  slug: string;
  eventDate: string;
  status: string;
  entryFeePaise: number;
  registrationClosesOn: string;
  categories: { id: string; name: string; classBand: string }[];
};

function inr(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN")}`;
}

export default function FestRegisterPage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const [event, setEvent] = useState<EventInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const [studentName, setStudentName] = useState("");
  const [schoolName, setSchoolName] = useState("");
  const [classLabel, setClassLabel] = useState("");
  const [mobile, setMobile] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [consent, setConsent] = useState(true);

  useEffect(() => {
    if (!params.slug) return;
    void fetch(`/api/events/interschool/public?slug=${encodeURIComponent(params.slug)}`)
      .then(async (res) => {
        const json = (await res.json()) as { view?: { event: EventInfo }; error?: string };
        if (!res.ok || !json.view) throw new Error(json.error || "Event not found");
        setEvent(json.view.event);
        setCategoryId(json.view.event.categories[0]?.id ?? "");
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load"));
  }, [params.slug]);

  async function onSubmit() {
    if (busy || !event) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/events/interschool/public", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: event.slug,
          studentName,
          schoolName,
          classLabel,
          guardianMobile: mobile,
          categoryId,
          consent,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        checkoutUrl?: string | null;
        error?: string;
      };
      if (!res.ok || !json.ok) throw new Error(json.error || "Could not register");
      if (json.checkoutUrl) {
        window.location.href = json.checkoutUrl;
        return;
      }
      setDone(true);
      window.setTimeout(
        () => router.push(`/fest/${event.slug}?registered=1`),
        1800,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not register");
    } finally {
      setBusy(false);
    }
  }

  if (error && !event) {
    return (
      <main className="mx-auto max-w-lg px-4 py-16 text-center text-sm text-[var(--muted)]">
        {error}
      </main>
    );
  }
  if (!event) {
    return (
      <main className="mx-auto max-w-lg px-4 py-16 text-center text-sm text-[var(--muted)]">
        Loading…
      </main>
    );
  }

  const fee = event.entryFeePaise;

  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <header className="text-center">
        <p className="text-[11px] font-extrabold tracking-[0.22em] text-[var(--brand-gold)]">
          {TENANT.nameDisplay.toUpperCase()}
        </p>
        <h1 className="mt-1 text-xl font-extrabold text-[var(--brand-deep)]">{event.name}</h1>
        <p className="mt-1 text-xs text-[var(--muted)]">
          {event.eventDate || ""} · open to students of ALL schools · certificate for every participant
        </p>
      </header>

      {done ? (
        <div className="mt-8 rounded-xl bg-[var(--success-soft)] px-4 py-6 text-center">
          <p className="text-sm font-bold text-[var(--success)]">Registration received</p>
          <p className="mt-1 text-xs text-[var(--brand-deep)]">
            You&apos;ll appear on the public participant list once the school approves the entry.
          </p>
        </div>
      ) : (
        <div className="mt-6 space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-sm">
          {event.status !== "open" ? (
            <p className="rounded-lg bg-[var(--warning-soft)] px-3 py-2 text-xs font-semibold text-[var(--warning)]">
              Registration is closed for this event.
            </p>
          ) : null}

          <label className="block text-xs text-[var(--muted)]">
            Student name
            <input className="field mt-1 w-full" value={studentName} onChange={(e) => setStudentName(e.target.value)} autoComplete="off" />
          </label>
          <label className="block text-xs text-[var(--muted)]">
            School name
            <input className="field mt-1 w-full" value={schoolName} onChange={(e) => setSchoolName(e.target.value)} placeholder="Your school's name" autoComplete="off" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs text-[var(--muted)]">
              Class
              <input className="field mt-1 w-full" value={classLabel} onChange={(e) => setClassLabel(e.target.value)} placeholder="e.g. VII" autoComplete="off" />
            </label>
            <label className="block text-xs text-[var(--muted)]">
              Guardian mobile
              <input className="field mt-1 w-full" inputMode="numeric" value={mobile} onChange={(e) => setMobile(e.target.value.replace(/\D/g, "").slice(0, 10))} autoComplete="off" />
            </label>
          </div>

          <div className="text-xs text-[var(--muted)]">
            Competition
            <div className="mt-1 flex flex-wrap gap-1.5">
              {event.categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCategoryId(c.id)}
                  className={`rounded-lg px-3 py-2 text-xs font-semibold ${
                    categoryId === c.id
                      ? "bg-[var(--brand-deep)] text-white"
                      : "border border-[var(--border)] text-[var(--brand-deep)]"
                  }`}
                >
                  {c.name}
                  {c.classBand ? ` · ${c.classBand}` : ""}
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-start gap-2 text-[11px] text-[var(--muted)]">
            <input type="checkbox" className="mt-0.5" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>
              The student&apos;s name, school and class may appear on this event&apos;s public
              participant list and scoreboard.
            </span>
          </label>

          {fee > 0 ? (
            <div className="flex items-center justify-between rounded-lg border border-[var(--brand-gold)]/40 bg-[var(--accent)] px-3 py-2">
              <span className="text-xs font-bold text-[var(--brand-deep)]">Entry fee</span>
              <span className="text-sm font-extrabold text-[var(--brand-deep)]">{inr(fee)}</span>
            </div>
          ) : null}

          {error ? (
            <p className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-xs font-semibold text-[var(--danger)]">
              {error}
            </p>
          ) : null}

          <button
            type="button"
            className="w-full rounded-xl bg-[#22c55e] px-4 py-3.5 text-sm font-extrabold uppercase tracking-wide text-white shadow-lg disabled:opacity-60"
            disabled={busy || event.status !== "open"}
            onClick={() => void onSubmit()}
          >
            {busy ? "Please wait…" : fee > 0 ? `Register & pay ${inr(fee)}` : "Register"}
          </button>
          {fee > 0 ? (
            <p className="text-center text-[10px] text-[var(--muted)]">
              Secure payment via UPI / card / netbanking (Cashfree).
            </p>
          ) : null}
        </div>
      )}

      <p className="mt-6 text-center text-[11px] text-[var(--muted)]">
        <Link href={`/fest/${event.slug}`} className="font-semibold underline">
          Rules, participants, results &amp; accounts — public page
        </Link>
      </p>
    </main>
  );
}
