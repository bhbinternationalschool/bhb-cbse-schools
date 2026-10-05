"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { QrPunchCard } from "@/components/staff/QrPunchCard";
import { TENANT } from "@/lib/types";

type Today = { status: string; inTime: string | null; outTime: string | null } | null;

export function PunchPage() {
  const params = useSearchParams();
  const code = (params.get("c") || "").replace(/\D/g, "").slice(0, 6);
  // The printed gate QR (backup when the gate phone is off).
  const place = (params.get("p") || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
  const [me, setMe] = useState<{ staffId: string; staffName: string; today: Today } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/staff/attendance/punch", { cache: "no-store" });
      if (res.status === 401) {
        const next = `/punch${code ? `?c=${code}` : place ? `?p=${place}` : ""}`;
        window.location.href = `/login?next=${encodeURIComponent(next)}`;
        return;
      }
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean;
        data?: { staffId: string; staffName: string; today: Today };
        error?: { message?: string };
      } | null;
      if (!res.ok || !body?.ok || !body.data) {
        setError(body?.error?.message || "Could not load your punch — try again.");
        return;
      }
      setMe(body.data);
    } catch {
      setError("No internet — punch once your phone is back online.");
    }
  }, [code, place]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-md flex-col gap-4 bg-[var(--background)] p-4">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{TENANT.shortName}</p>
        <h1 className="text-xl font-bold text-[var(--brand-deep)]">Punch attendance</h1>
      </header>
      {error ? (
        <p className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">{error}</p>
      ) : !me ? (
        <p className="text-sm text-[var(--muted)]">Loading…</p>
      ) : (
        <section className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
          <p className="text-sm text-[var(--brand-deep)]">
            <span className="font-semibold">{me.staffName}</span>
            <span className="block text-xs text-[var(--muted)]">
              Today: {me.today?.inTime ? `IN ${me.today.inTime}` : "not punched in"}
              {me.today?.outTime ? ` · OUT ${me.today.outTime}` : ""}
            </span>
          </p>
          <QrPunchCard
            staffId={me.staffId}
            inTime={me.today?.inTime}
            outTime={me.today?.outTime}
            initialCode={code}
            initialPlace={place}
            onPunched={() => void load()}
          />
        </section>
      )}
      <a href="/home" className="text-center text-sm font-semibold text-[var(--primary)]">
        Open the ERP
      </a>
    </main>
  );
}
