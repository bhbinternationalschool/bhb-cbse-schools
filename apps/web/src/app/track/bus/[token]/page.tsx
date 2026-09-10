"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";

/**
 * "Where is my child's bus?" — the page the WhatsApp button opens.
 *
 * Deliberately plain: one card, big text, no login, no map tiles. Most of
 * these opens are a parent standing at a gate on a 3G phone, and a Google
 * Maps deep link is both lighter and more useful than an embedded map they
 * cannot get directions out of.
 *
 * Three rules the design turns on:
 *
 *  - It refreshes every 20 seconds, and shows the age of the fix every time.
 *    A position with no age on it is a claim; with an age it is evidence.
 *  - When the server says no, the page says WHY, in a sentence — never a
 *    spinner that never resolves, and never the previous position left on
 *    screen. A parent driving to where the bus was twenty minutes ago is the
 *    failure this whole feature is written against.
 *  - It stops polling once the answer is final (a dead link), because a
 *    phone left open on a bad link should not keep waking the radio.
 */

type Feed =
  | {
      ok: true;
      busLabel: string;
      stopName: string;
      lat: number;
      lng: number;
      speedKmh: number | null;
      motion: "moving" | "idling" | "parked" | "unknown";
      ageLabel: string;
      mapsUrl: string;
    }
  | { ok: false; reason: string; message: string; busLabel: string };

const REFRESH_MS = 20_000;

const MOTION_TEXT: Record<string, string> = {
  moving: "Moving",
  idling: "Stopped, engine on",
  parked: "Parked",
  unknown: "Position known",
};

/** A dead link never becomes alive, so polling it is pure battery. */
const FINAL_REASONS = new Set(["bad-link", "expired"]);

export default function BusTrackPage() {
  const params = useParams<{ token: string }>();
  const token = typeof params?.token === "string" ? params.token : "";
  const [feed, setFeed] = useState<Feed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState<string>("");

  const load = useCallback(async () => {
    if (!token) {
      setFeed({
        ok: false,
        reason: "bad-link",
        message: "This link is not valid. Please open the link from the school's WhatsApp message.",
        busLabel: "",
      });
      return;
    }
    try {
      const res = await fetch(`/api/transport/track?t=${encodeURIComponent(token)}`, {
        cache: "no-store",
      });
      const json = (await res.json()) as Feed;
      setFeed(json);
      setError(null);
      setCheckedAt(new Date().toLocaleTimeString());
    } catch {
      // The network dropped. Say so — do not leave the last position looking
      // current, and do not claim the bus has stopped reporting.
      setError("Could not reach the school just now. Retrying…");
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const stopped = feed && !feed.ok && FINAL_REASONS.has(feed.reason);

  useEffect(() => {
    if (stopped) return;
    const id = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(id);
  }, [load, stopped]);

  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <h1 className="text-lg font-semibold text-[#203050]">School bus</h1>
      <p className="mt-1 text-[12px] text-[#5a6b85]">
        BHB International School · transport
      </p>

      {feed === null ? (
        <div className="mt-6 rounded-2xl border border-[rgba(32,48,80,0.15)] bg-white p-5 text-sm text-[#5a6b85]">
          Checking where the bus is…
        </div>
      ) : feed.ok ? (
        <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-800">
            Bus {feed.busLabel || "—"}
          </div>
          <div className="mt-1 text-2xl font-semibold text-[#203050]">
            {MOTION_TEXT[feed.motion] || "Position known"}
            {feed.speedKmh !== null && feed.motion === "moving"
              ? ` · ${Math.round(feed.speedKmh)} km/h`
              : ""}
          </div>
          <div className="mt-1 text-[12px] text-[#5a6b85]">
            Last reported <strong>{feed.ageLabel}</strong>
            {feed.stopName ? ` · your stop: ${feed.stopName}` : ""}
          </div>
          <a
            href={feed.mapsUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-4 block rounded-xl bg-[#203050] px-4 py-3 text-center text-sm font-semibold text-white"
          >
            Open in Google Maps
          </a>
          <p className="mt-3 text-[11px] leading-relaxed text-[#5a6b85]">
            This is the bus&apos;s own tracker, not your child&apos;s phone. The
            position updates every few seconds while the bus is on its run.
          </p>
        </div>
      ) : (
        <div className="mt-6 rounded-2xl border border-[rgba(32,48,80,0.15)] bg-white p-5">
          {feed.busLabel ? (
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[#5a6b85]">
              Bus {feed.busLabel}
            </div>
          ) : null}
          <p className="mt-1 text-sm leading-relaxed text-[#203050]">{feed.message}</p>
        </div>
      )}

      {error ? (
        <p className="mt-3 text-[12px] text-rose-700">{error}</p>
      ) : checkedAt && !stopped ? (
        <p className="mt-3 text-[11px] text-[#5a6b85]">
          Checked at {checkedAt} · refreshes on its own
        </p>
      ) : null}

      <p className="mt-6 text-[11px] leading-relaxed text-[#5a6b85]">
        Need the transport desk? Reply to the school&apos;s WhatsApp message and
        the office will call you back.
      </p>
    </main>
  );
}
