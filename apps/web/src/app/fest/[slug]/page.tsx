"use client";

/**
 * Public transparency page for an inter-school event: rules published before
 * registration, the frozen participant list, the full locked scoreboard with
 * any post-lock revisions, and accounts straight from the event's records.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { TENANT } from "@/lib/types";

type View = {
  event: {
    id: string;
    name: string;
    slug: string;
    eventDate: string;
    venue: string;
    description: string;
    registrationClosesOn: string;
    entryFeePaise: number;
    status: string;
    categories: {
      id: string;
      name: string;
      classBand: string;
      prize1Paise: number;
      prize2Paise: number;
      prize3Paise: number;
      prizeNotes: string;
      resultsLockedAt: string;
    }[];
  };
  participants: { studentName: string; schoolName: string; classLabel: string; categoryId: string }[];
  results: Record<string, { lockedAt: string; rows: { studentName: string; schoolName: string; classLabel: string; score: number | null; rank: number | null; prizePaise: number }[] }>;
  revisions: { categoryId: string; reason: string; revisedAt: string }[];
  accounts: { paidCount: number; feesCollectedPaise: number; prizesPaidPaise: number; otherCostsPaise: number; schoolContributionPaise: number };
};

function inr(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN")}`;
}

export default function FestPublicPage() {
  const params = useParams<{ slug: string }>();
  const [registered, setRegistered] = useState<string | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"rules" | "participants" | "results" | "accounts">("rules");

  useEffect(() => {
    setRegistered(new URLSearchParams(window.location.search).get("registered"));
  }, []);

  useEffect(() => {
    if (!params.slug) return;
    void fetch(`/api/events/interschool/public?slug=${encodeURIComponent(params.slug)}`)
      .then(async (res) => {
        const json = (await res.json()) as { view?: View; error?: string };
        if (!res.ok || !json.view) throw new Error(json.error || "Event not found");
        setView(json.view);
        if (Object.keys(json.view.results).length > 0) setTab("results");
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load"));
  }, [params.slug]);

  const catName = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of view?.event.categories ?? []) {
      m.set(c.id, [c.name, c.classBand].filter(Boolean).join(" · "));
    }
    return m;
  }, [view]);

  if (error) {
    return (
      <main className="mx-auto max-w-lg px-4 py-16 text-center text-sm text-[var(--muted)]">
        {error}
      </main>
    );
  }
  if (!view) {
    return (
      <main className="mx-auto max-w-lg px-4 py-16 text-center text-sm text-[var(--muted)]">
        Loading event…
      </main>
    );
  }
  const e = view.event;
  const registrationOpen = e.status === "open";

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <header className="text-center">
        <p className="text-[11px] font-extrabold tracking-[0.22em] text-[var(--brand-gold)]">
          {TENANT.nameDisplay.toUpperCase()}
        </p>
        <h1 className="mt-1 text-2xl font-extrabold text-[var(--brand-deep)]">{e.name}</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {e.eventDate || "Date to be announced"}
          {e.venue ? ` · ${e.venue}` : ""} · {view.participants.length} participants · public record
        </p>
        {registered ? (
          <p className="mx-auto mt-3 max-w-md rounded-lg bg-[var(--success-soft)] px-3 py-2 text-sm font-semibold text-[var(--success)]">
            Registration received — you&apos;ll be on the participant list once the school approves it.
          </p>
        ) : null}
        {registrationOpen ? (
          <Link
            href={`/fest/${e.slug}/register`}
            className="mt-4 inline-block rounded-xl bg-[var(--brand-deep)] px-6 py-3 text-sm font-extrabold text-white"
          >
            Register a student{e.entryFeePaise > 0 ? ` · entry ${inr(e.entryFeePaise)}` : " · free"}
          </Link>
        ) : null}
      </header>

      <nav className="mt-6 flex flex-wrap justify-center gap-2">
        {(
          [
            ["rules", "Rules & judging"],
            ["participants", `Participants (${view.participants.length})`],
            ["results", "Results"],
            ["accounts", "Accounts"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`rounded-lg px-4 py-2 text-xs font-semibold ${
              tab === id
                ? "bg-[var(--brand-deep)] text-white"
                : "border border-[var(--border)] bg-[var(--card)] text-[var(--brand-deep)]"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      <section className="mt-5">
        {tab === "rules" ? (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
            <div className="grid gap-3 sm:grid-cols-2">
              {e.categories.map((c) => (
                <div key={c.id} className="rounded-lg border border-[var(--border)] p-3">
                  <div className="text-sm font-bold text-[var(--brand-deep)]">
                    {c.name}
                    {c.classBand ? <span className="text-[var(--muted)]"> · {c.classBand}</span> : null}
                  </div>
                  <div className="mt-1 text-xs text-[var(--muted)]">
                    1st {inr(c.prize1Paise)}{c.prizeNotes ? ` ${c.prizeNotes}` : ""} · 2nd {inr(c.prize2Paise)} · 3rd {inr(c.prize3Paise)}
                  </div>
                </div>
              ))}
            </div>
            {e.description ? (
              <p className="mt-4 whitespace-pre-line text-sm text-[var(--brand-deep)]">{e.description}</p>
            ) : null}
            <p className="mt-4 text-[11px] text-[var(--muted)]">
              These rules, prizes and judges were published before registration opened
              {e.registrationClosesOn ? ` · registration closes ${e.registrationClosesOn}` : ""}.
            </p>
          </div>
        ) : null}

        {tab === "participants" ? (
          <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--card)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase text-[var(--muted)]">
                  <th className="px-4 py-2.5">Student</th>
                  <th className="px-4 py-2.5">School</th>
                  <th className="px-4 py-2.5">Competition</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {view.participants.map((p, i) => (
                  <tr key={i}>
                    <td className="px-4 py-2 font-semibold text-[var(--brand-deep)]">
                      {p.studentName}
                      {p.classLabel ? <span className="font-normal text-[var(--muted)]"> · {p.classLabel}</span> : null}
                    </td>
                    <td className="px-4 py-2 text-[var(--brand-deep)]">{p.schoolName}</td>
                    <td className="px-4 py-2 text-[var(--muted)]">{catName.get(p.categoryId) ?? ""}</td>
                  </tr>
                ))}
                {view.participants.length === 0 ? (
                  <tr><td colSpan={3} className="px-4 py-8 text-center text-xs text-[var(--muted)]">Approved participants appear here.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : null}

        {tab === "results" ? (
          <div className="space-y-4">
            {e.categories.map((c) => {
              const r = view.results[c.id];
              const revs = view.revisions.filter((x) => x.categoryId === c.id);
              return (
                <div key={c.id} className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-bold text-[var(--brand-deep)]">
                      {c.name}{c.classBand ? ` · ${c.classBand}` : ""}
                    </div>
                    {r ? (
                      <span className="rounded bg-[var(--success-soft)] px-2 py-0.5 text-[10px] font-bold uppercase text-[var(--success)]">
                        Locked &amp; published {r.lockedAt.slice(0, 10)}
                      </span>
                    ) : (
                      <span className="rounded bg-[rgba(32,48,80,0.08)] px-2 py-0.5 text-[10px] font-bold uppercase text-[var(--muted)]">
                        Awaited
                      </span>
                    )}
                  </div>
                  {r ? (
                    <table className="mt-2 w-full text-sm">
                      <tbody className="divide-y divide-[var(--border)]">
                        {r.rows.map((row, i) => (
                          <tr key={i} className={row.rank != null && row.rank <= 3 ? "font-semibold" : ""}>
                            <td className="w-12 px-2 py-1.5">
                              {row.rank != null ? (
                                <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-extrabold text-white ${row.rank === 1 ? "bg-[var(--brand-gold)]" : row.rank === 2 ? "bg-[#5c6478]" : row.rank === 3 ? "bg-[#92400e]" : "bg-[rgba(32,48,80,0.3)]"}`}>
                                  {row.rank}
                                </span>
                              ) : (
                                <span className="text-xs text-[var(--muted)]">—</span>
                              )}
                            </td>
                            <td className="px-2 py-1.5 text-[var(--brand-deep)]">
                              {row.studentName}
                              {row.classLabel ? <span className="text-xs font-normal text-[var(--muted)]"> · {row.classLabel}</span> : null}
                            </td>
                            <td className="px-2 py-1.5 text-[var(--brand-deep)]">{row.schoolName}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums">{row.score ?? ""}</td>
                            <td className="px-2 py-1.5 text-right text-xs">
                              {row.prizePaise > 0 ? inr(row.prizePaise) : ""}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="mt-2 text-xs text-[var(--muted)]">
                      The full scoreboard — every entrant&apos;s score — appears here the moment results are locked.
                    </p>
                  )}
                  {revs.map((rev, i) => (
                    <p key={i} className="mt-2 rounded-lg bg-[var(--warning-soft)] px-3 py-2 text-xs text-[var(--warning)]">
                      <span className="font-bold">Revised {rev.revisedAt.slice(0, 10)}:</span> {rev.reason}
                    </p>
                  ))}
                </div>
              );
            })}
          </div>
        ) : null}

        {tab === "accounts" ? (
          <div className="rounded-xl bg-[var(--brand-deep)] p-5 text-white">
            <div className="flex items-baseline justify-between">
              <p className="text-xs font-extrabold uppercase tracking-widest text-[#f0d878]">
                Event accounts — from the school&apos;s records
              </p>
              <p className="text-[10px] text-white/70">updates live, not typed separately</p>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg bg-white/10 p-3 text-center">
                <div className="text-lg font-extrabold">{inr(view.accounts.feesCollectedPaise)}</div>
                <div className="mt-0.5 text-[10px] text-white/75">
                  Entry fees ({view.accounts.paidCount} paid{e.entryFeePaise > 0 ? ` × ${inr(e.entryFeePaise)}` : ""})
                </div>
              </div>
              <div className="rounded-lg bg-white/10 p-3 text-center">
                <div className="text-lg font-extrabold">{inr(view.accounts.prizesPaidPaise)}</div>
                <div className="mt-0.5 text-[10px] text-white/75">Prizes handed over</div>
              </div>
              <div className="rounded-lg bg-white/10 p-3 text-center">
                <div className="text-lg font-extrabold">{inr(view.accounts.otherCostsPaise)}</div>
                <div className="mt-0.5 text-[10px] text-white/75">Trophies &amp; printing</div>
              </div>
              <div className="rounded-lg border border-[#c5a028]/60 bg-[#c5a028]/25 p-3 text-center">
                <div className="text-lg font-extrabold text-[#f0d878]">{inr(view.accounts.schoolContributionPaise)}</div>
                <div className="mt-0.5 text-[10px] text-white/85">Contributed by {TENANT.shortName}</div>
              </div>
            </div>
          </div>
        ) : null}
      </section>

      <footer className="mt-8 text-center text-[10px] text-[var(--muted)]">
        Certificates from this event carry a QR that opens their verification page here. ·{" "}
        <span className="font-semibold">{TENANT.nameDisplay}</span>
      </footer>
    </main>
  );
}
