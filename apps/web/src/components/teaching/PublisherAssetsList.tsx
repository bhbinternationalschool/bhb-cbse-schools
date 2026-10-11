"use client";

import { useEffect, useState } from "react";
import { isRevisionAsset, isWorksheetAsset, type ChapterAssets } from "@/lib/pinnacleAssets";

/**
 * The publisher's ready-made assets for chapters a teacher is working on —
 * animations, mind maps, games, worksheets on Pinnacle Smart Teach (director,
 * 12 Oct 2026). Titles only, with a link that opens the book's Assets page in
 * Smart Teach (the teacher's own login). Renders nothing when the robot has
 * not indexed this book or the chapters have no assets — an absent list is
 * never shown as "none".
 *
 * `only`: "worksheet" for homework (printable work), "revision" for exam
 * papers (mind maps, timelines, animations, videos), else everything.
 */
export function PublisherAssetsList({
  className,
  subjectName,
  codes,
  only,
  heading,
}: {
  className: string;
  subjectName: string;
  codes: string[];
  only?: "worksheet" | "revision";
  heading?: string;
}) {
  const [rows, setRows] = useState<(ChapterAssets & { position: number })[]>([]);
  const key = codes.join(",");

  useEffect(() => {
    if (!className || !subjectName || !key) {
      setRows([]);
      return;
    }
    let live = true;
    const qs = new URLSearchParams({ className, subject: subjectName, codes: key });
    fetch(`/api/v1/teaching/publisher-assets?${qs}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { data?: { chapters?: (ChapterAssets & { position: number })[] } } | null) => {
        if (live) setRows(j?.data?.chapters ?? []);
      })
      .catch(() => live && setRows([]));
    return () => {
      live = false;
    };
  }, [className, subjectName, key]);

  const shown = rows
    .map((r) => ({
      ...r,
      assets: r.assets.filter((a) => (only === "worksheet" ? isWorksheetAsset(a) : only === "revision" ? isRevisionAsset(a) : true)),
    }))
    .filter((r) => r.assets.length);
  if (!shown.length) return null;

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs" aria-label="Publisher assets">
      <p className="mb-1 font-semibold text-[var(--brand-deep)]">{heading || "From the publisher (Smart Teach)"}</p>
      <ul className="space-y-1.5">
        {shown.map((r) => (
          <li key={r.position}>
            <span className="text-[var(--muted)]">
              Ch {r.position} · {r.chapter}
            </span>
            <span className="ml-1">
              {r.assets.map((a, i) => (
                <span key={`${a.type}|${a.title}`}>
                  {i ? " · " : " — "}
                  <span className="font-medium">{a.type}</span>
                  {a.title && a.title !== a.type ? `: ${a.title}` : ""}
                </span>
              ))}
            </span>{" "}
            <a
              href={r.url}
              target="_blank"
              rel="noopener noreferrer"
              className="whitespace-nowrap text-[var(--brand)] underline-offset-2 hover:underline"
            >
              Open in Smart Teach ↗
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
