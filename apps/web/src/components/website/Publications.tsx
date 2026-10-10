"use client";

/**
 * "Show on website" — Website Phase 4.
 *
 * The Comms, Gallery and Events desks are full of things written for
 * parents, staff or one class. None of it belongs on the open internet
 * merely because it exists. This screen is where someone decides, one item
 * at a time, and `site_publications` is that decision written down: who
 * ticked it, when it went up, and when it came off.
 *
 * Taking something off is immediate and final. A notice withdrawn because
 * it was wrong must not reappear because it was also scheduled.
 */

import { Globe2, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ErpTableShell } from "@/components/ui/erp-roster";
import { readAll } from "@/lib/data/client/query";
import { writeRecords } from "@/lib/data/client/mutate";
import { getSessionActor } from "@/lib/sessionActor";
import {
  PUBLICATION_KINDS,
  isPublicationLive,
  newSiteId,
  publicationToRow,
  rowToPublication,
  type PublicationKind,
  type SitePublication,
} from "@/lib/website";

type Candidate = {
  kind: PublicationKind;
  id: string;
  title: string;
  detail: string;
  at: string;
};

type Filter = PublicationKind | "all" | "live";

export function Publications({
  onError,
  onNotice,
}: {
  onError: (msg: string | null) => void;
  onNotice: (msg: string | null) => void;
}) {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [pubs, setPubs] = useState<SitePublication[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  const load = useCallback(async () => {
    setLoading(true);
    const [candRes, pubRes] = await Promise.all([
      fetch("/api/website/publishable", { credentials: "same-origin" })
        .then(
          (r) =>
            r.json() as Promise<{
              ok?: boolean;
              items?: Candidate[];
              error?: string;
            }>,
        )
        .catch((): { ok?: boolean; items?: Candidate[]; error?: string } => ({
          ok: false,
          error: "Could not reach the server",
        })),
      readAll<Record<string, unknown>>("site.publications", { maxPages: 5 }),
    ]);

    if (!candRes.ok) {
      onError(candRes.error || "Could not load what there is to publish.");
      setCandidates([]);
    } else {
      setCandidates(candRes.items ?? []);
    }
    if (pubRes.ok) setPubs(pubRes.rows.map(rowToPublication));
    setLoading(false);
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  /** The publication row for a candidate, if one was ever made. */
  const pubFor = useMemo(() => {
    const map = new Map<string, SitePublication>();
    for (const p of pubs) map.set(`${p.sourceKind}:${p.sourceId}`, p);
    return map;
  }, [pubs]);

  const liveCount = useMemo(
    () => pubs.filter((p) => isPublicationLive(p)).length,
    [pubs],
  );

  const shown = useMemo(() => {
    if (filter === "all") return candidates;
    if (filter === "live") {
      return candidates.filter((c) => {
        const pub = pubFor.get(`${c.kind}:${c.id}`);
        return pub ? isPublicationLive(pub) : false;
      });
    }
    return candidates.filter((c) => c.kind === filter);
  }, [candidates, filter, pubFor]);

  async function dropCache() {
    try {
      const res = await fetch("/api/website/revalidate", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: true }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async function toggle(candidate: Candidate, on: boolean) {
    const key = `${candidate.kind}:${candidate.id}`;
    const existing = pubFor.get(key);
    setBusy(key);
    onError(null);

    const now = new Date().toISOString();
    const actor = getSessionActor();

    const res = await writeRecords("site.publications", [
      {
        op: "upsert",
        id: existing?.id ?? newSiteId("pub"),
        base: existing?.updatedAt ?? null,
        row: publicationToRow({
          sourceKind: candidate.kind,
          sourceId: candidate.id,
          status: on ? "published" : "archived",
          publishedAt: on ? now : (existing?.publishedAt ?? null),
          // Set going off, cleared coming back on — otherwise an item put
          // back up would stay hidden by its own withdrawal.
          unpublishedAt: on ? null : now,
          createdBy: existing?.createdBy || actor?.fullName || "",
        }),
      },
    ]);

    if (!res.ok) {
      setBusy(null);
      onError(
        res.kind === "auth"
          ? "Your role cannot publish to the website."
          : `That did not change: ${res.message}`,
      );
      return;
    }

    const dropped = await dropCache();
    setBusy(null);
    onNotice(
      on
        ? dropped
          ? `“${candidate.title}” is now on the website.`
          : `“${candidate.title}” is published, but the public copy may take up to five minutes to catch up.`
        : `“${candidate.title}” has been taken off the website.`,
    );
    await load();
  }

  const filters: { id: Filter; label: string }[] = [
    { id: "all", label: "Everything" },
    { id: "live", label: `On the website (${liveCount})` },
    ...PUBLICATION_KINDS.map((k) => ({ id: k.id as Filter, label: k.plural })),
  ];

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-[var(--shadow-1)]">
        <h2 className="flex items-center gap-1.5 text-sm font-bold text-[var(--brand-deep)]">
          <Globe2 className="h-4 w-4" />
          What the public can see
        </h2>
        <p className="mt-1 text-[11px] leading-relaxed text-[var(--muted)]">
          Notices, news, albums and events stay inside the school until you tick
          them on here. Once on, they appear wherever a page uses a news,
          calendar or gallery block — you do not have to edit the page.
        </p>
      </section>

      <div className="flex flex-wrap gap-2">
        {filters.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
              filter === f.id
                ? "bg-[var(--brand-deep)] text-white"
                : "border border-[var(--border)] text-[var(--muted)]"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <ErpTableShell>
        {loading ? (
          <p className="p-6 text-sm text-[var(--muted)]">Loading…</p>
        ) : shown.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm font-semibold text-[var(--brand-deep)]">
              {candidates.length === 0
                ? "Nothing to publish yet"
                : "Nothing here with that filter"}
            </p>
            <p className="mx-auto mt-1 max-w-md text-xs text-[var(--muted)]">
              {candidates.length === 0
                ? "Write a notice, add a news item, make a photo album or put an event in the calendar, and it will appear here ready to be shown."
                : "Change the filter to see the rest."}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {shown.map((item) => {
              const key = `${item.kind}:${item.id}`;
              const pub = pubFor.get(key);
              const on = pub ? isPublicationLive(pub) : false;
              const kindLabel =
                PUBLICATION_KINDS.find((k) => k.id === item.kind)?.label ??
                item.kind;
              return (
                <li key={key} className="flex flex-wrap items-start gap-3 p-3">
                  <div className="min-w-[16rem] flex-1">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">
                      {kindLabel}
                    </p>
                    <p className="mt-0.5 text-sm font-semibold text-[var(--brand-deep)]">
                      {item.title}
                    </p>
                    {item.detail ? (
                      <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--muted)]">
                        {item.detail}
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    disabled={busy === key}
                    onClick={() => void toggle(item, !on)}
                    className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-bold disabled:opacity-50 ${
                      on
                        ? "border border-[var(--border)] text-[var(--muted)]"
                        : "bg-[var(--brand-deep)] text-white"
                    }`}
                  >
                    {busy === key ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : null}
                    {on ? "Take off the website" : "Show on website"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </ErpTableShell>
    </div>
  );
}
