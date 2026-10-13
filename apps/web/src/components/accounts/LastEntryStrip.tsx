"use client";

/**
 * "Entered up to" — a one-line reminder above a voucher form of how far the
 * keying has got: the latest date on a live hand-keyed voucher of this type,
 * and, when different, the one typed last (a back-dated bill, usually).
 *
 * The director asked for it on 13 Oct 2026, with the office re-keying the
 * session's expenses from 1 April after the clean-up reversed the old ones.
 * Reversed vouchers and reversals never count — see lib/ledger/lastEntries.ts.
 */

import { useEffect, useState } from "react";
import { CalendarCheck } from "lucide-react";
import {
  formatKeyedAtIst,
  type LastEntriesByKind,
  type LastEntrySummary,
} from "@/lib/ledger/lastEntries";

const KIND_NOUN: Record<string, string> = {
  payment: "payments",
  receipt: "receipts",
  contra: "contras",
  journal: "journals",
  any: "vouchers",
};

/**
 * One read per refresh, however many forms are mounted (they stay mounted,
 * hidden). Shared only for a few seconds: coming back to the tab later must
 * read the book again, not show what it said an hour ago.
 */
let inflight: { key: number; at: number; p: Promise<LastEntriesByKind | null> } | null = null;

function loadLastEntries(key: number): Promise<LastEntriesByKind | null> {
  if (inflight && inflight.key === key && Date.now() - inflight.at < 5000) return inflight.p;
  const p = fetch("/api/ledger", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "last-entries" }),
  })
    .then((r) => r.json() as Promise<{ ok?: boolean; kinds?: LastEntriesByKind }>)
    .then((r) => (r.ok && r.kinds ? r.kinds : null))
    .catch(() => null);
  inflight = { key, at: Date.now(), p };
  return p;
}

/** "2026-04-12" → "12 Apr 2026". */
export function formatEntryDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (!iso || Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function keyedLine(e: { keyedAt: string; createdBy?: string }): string {
  const when = formatKeyedAtIst(e.keyedAt);
  return `keyed ${when}${e.createdBy ? ` by ${e.createdBy}` : ""}`;
}

/**
 * The presentational half, shared with the staff-advance register, which
 * reads its own desk rather than the book.
 */
export function EnteredUpToLine<T extends { date: string; keyedAt: string; createdBy?: string }>({
  noun,
  latest,
  lastKeyed,
  describe,
}: {
  noun: string;
  latest: T | null;
  lastKeyed: T | null;
  /** What identifies an entry: a voucher number, a name and amount. */
  describe: (e: T) => string;
}) {
  const same =
    !!latest &&
    !!lastKeyed &&
    latest.date === lastKeyed.date &&
    latest.keyedAt === lastKeyed.keyedAt;
  return (
    <div
      className="flex items-start gap-2 rounded-xl border border-[var(--border)] bg-[var(--info-soft)] px-3 py-2 text-[11px] text-[var(--muted)]"
      role="status"
    >
      <CalendarCheck className="mt-0.5 size-3.5 shrink-0 text-[var(--brand-deep)]" aria-hidden />
      {!latest ? (
        <p>No {noun} entered yet — nothing to continue from.</p>
      ) : (
        <div className="space-y-0.5">
          <p>
            <span className="font-bold text-[var(--brand-deep)]">
              {noun.charAt(0).toUpperCase() + noun.slice(1)} entered up to {formatEntryDate(latest.date)}
            </span>{" "}
            · {describe(latest)} · {keyedLine(latest)}
          </p>
          {lastKeyed && !same ? (
            <p>
              Last typed: {describe(lastKeyed)} dated {formatEntryDate(lastKeyed.date)} ·{" "}
              {keyedLine(lastKeyed)}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function LastEntryStrip({
  kind,
  refreshKey = 0,
}: {
  /** A voucher type (payment, receipt, contra, journal) or "any". */
  kind: string;
  /** Bump after a post so the strip reads the book again. */
  refreshKey?: number;
}) {
  const [kinds, setKinds] = useState<LastEntriesByKind | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    void loadLastEntries(refreshKey).then((k) => {
      if (!live) return;
      setKinds(k);
      setFailed(!k);
    });
    return () => {
      live = false;
    };
  }, [refreshKey]);

  // Unknown is not "nothing entered": say the strip could not be read.
  if (failed) {
    return (
      <p className="text-[11px] text-[var(--muted)]">
        Could not read how far entries have got — the form still works.
      </p>
    );
  }
  if (!kinds) return null;
  const entry = kinds[kind] ?? { latestDate: null, lastKeyed: null };
  return (
    <EnteredUpToLine
      noun={KIND_NOUN[kind] ?? `${kind} vouchers`}
      latest={entry.latestDate}
      lastKeyed={entry.lastKeyed}
      describe={(e: LastEntrySummary) => e.voucherNo}
    />
  );
}
