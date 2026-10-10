"use client";

/** Certificate verification — the QR on every certificate opens this page. */

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { TENANT } from "@/lib/types";

type Cert = {
  eventName: string;
  eventDate: string;
  studentName: string;
  schoolName: string;
  categoryName: string;
  kind: string;
  rank: number | null;
  issuedAt: string;
};

export default function FestVerifyPage() {
  const params = useParams<{ id: string }>();
  const [cert, setCert] = useState<Cert | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!params.id) return;
    void fetch(`/api/events/interschool/public?verify=${encodeURIComponent(params.id)}`)
      .then(async (res) => {
        const json = (await res.json()) as { certificate?: Cert; error?: string };
        if (!res.ok || !json.certificate) {
          throw new Error(json.error || "No such certificate");
        }
        setCert(json.certificate);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not verify"));
  }, [params.id]);

  return (
    <main className="mx-auto max-w-md px-4 py-14 text-center">
      <p className="text-[11px] font-extrabold tracking-[0.22em] text-[var(--brand-gold)]">
        {TENANT.nameDisplay.toUpperCase()}
      </p>
      <h1 className="mt-1 text-lg font-extrabold text-[var(--brand-deep)]">
        Certificate verification
      </h1>

      {error ? (
        <div className="mt-6 rounded-xl bg-[var(--danger-soft)] px-4 py-6">
          <p className="text-sm font-bold text-[var(--danger)]">✕ {error}</p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            This certificate id is not on {TENANT.shortName}&apos;s record.
          </p>
        </div>
      ) : !cert ? (
        <p className="mt-6 text-sm text-[var(--muted)]">Checking…</p>
      ) : (
        <div className="mt-6 rounded-xl border border-[var(--success)]/40 bg-[var(--success-soft)] px-4 py-6">
          <p className="text-sm font-extrabold text-[var(--success)]">✓ GENUINE</p>
          <p className="mt-3 text-base font-extrabold text-[var(--brand-deep)]">{cert.studentName}</p>
          <p className="text-xs text-[var(--muted)]">of {cert.schoolName}</p>
          <p className="mt-2 text-sm text-[var(--brand-deep)]">
            {cert.kind === "winner" && cert.rank ? (
              <>
                <span className="font-extrabold text-[var(--warning)]">
                  {cert.rank === 1 ? "FIRST" : cert.rank === 2 ? "SECOND" : "THIRD"} PLACE
                </span>{" "}
                — {cert.categoryName}
              </>
            ) : (
              <>Participation — {cert.categoryName}</>
            )}
          </p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {cert.eventName}
            {cert.eventDate ? ` · ${cert.eventDate}` : ""} · issued {cert.issuedAt.slice(0, 10)}
          </p>
        </div>
      )}
    </main>
  );
}
