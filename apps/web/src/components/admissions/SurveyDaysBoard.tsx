"use client";

// ratchet-allow: grids_without_row_menu — a day report and a phone list; the
// only per-row action (Pair phone) is a button in its row.

/**
 * The office's view of the field survey (director, 5 Oct 2026), from the
 * server: every surveyor's day on a date — where and when they started,
 * their breaks, where they ended, hours worked — and the families they
 * recorded, each with the GPS fix of the doorstep, as a route on the map.
 * Plus each surveyor's registered phone and the one-time code that pairs one.
 */

import { useCallback, useEffect, useState } from "react";
import { ErpTable, ErpTableBody, ErpTableHead } from "@/components/ui/erp-roster";
import { formatWorked, surveyRouteLink, surveyWorkedMs, type SurveyDay, type SurveyFix } from "@/lib/surveyDay";

type TeamRow = {
  memberId: string;
  memberKey: string;
  name: string;
  kind: "staff" | "external";
  startMode: "school" | "field";
  assigned: boolean;
  phone: string | null;
};
type Capture = { surveyDayId: string; enquiryNo: string; childName: string; geo: SurveyFix; capturedAt: string };
type Data = { date: string; team: TeamRow[]; beats: { id: string; name: string }[]; days: SurveyDay[]; captures: Capture[] };

const istToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const hhmm = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "—";
const mapLink = (f: SurveyFix | null) => (f ? `https://www.google.com/maps?q=${f.lat},${f.lng}` : "");

export function SurveyDaysBoard({ canEdit }: { canEdit: boolean }) {
  const [date, setDate] = useState(istToday);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pairing, setPairing] = useState<{ name: string; code: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(`/api/v1/admissions/survey-days?date=${date}`, { cache: "no-store" }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as { ok?: boolean; data?: Data; error?: { message?: string } } | null;
    if (!res?.ok || !body?.ok || !body.data) {
      setError(body?.error?.message || "Could not load the survey days");
      return;
    }
    setData(body.data);
  }, [date]);

  useEffect(() => {
    void load();
  }, [load]);

  async function pair(memberId: string) {
    setBusy(true);
    const res = await fetch("/api/v1/admissions/survey-days", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "pair_start", memberId }),
    }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as {
      ok?: boolean;
      data?: { code: string; expiresAt: string; name: string };
      error?: { message?: string };
    } | null;
    setBusy(false);
    if (!res?.ok || !body?.ok || !body.data) {
      setError(body?.error?.message || "Could not open a pairing code");
      return;
    }
    setPairing(body.data);
  }

  const nameOf = (key: string) => data?.team.find((t) => t.memberKey === key)?.name || key;
  const beatOf = (id: string) => data?.beats.find((b) => b.id === id)?.name || "—";

  return (
    <section className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-[var(--brand-deep)]">Survey days</h3>
          <p className="text-xs text-[var(--muted)]">
            Every step is signed by the surveyor&apos;s own phone and stamped with its live location. Surveyors open{" "}
            <b>/survey-day</b> on their phone.
          </p>
        </div>
        <label className="text-xs font-semibold text-[var(--muted)]">
          Date
          <input type="date" className="field mt-1 !py-1.5" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>
      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
      {pairing ? (
        <div className="rounded-xl border border-[var(--success)] bg-[var(--success-soft)] px-4 py-3">
          <p className="text-sm text-[var(--success)]">
            Code for <b>{pairing.name}</b> — they open <b>/survey-day</b> on their own phone and type:
          </p>
          <p className="my-1 font-mono text-3xl font-bold tracking-[0.3em] text-[var(--brand-deep)]">{pairing.code}</p>
          <p className="text-xs text-[var(--muted)]">
            Works once, until {hhmm(pairing.expiresAt)}. Opening another code cancels this one.{" "}
            <button type="button" className="underline" onClick={() => setPairing(null)}>
              Close
            </button>
          </p>
        </div>
      ) : null}

      {!data ? (
        <p className="text-sm text-[var(--muted)]">Loading…</p>
      ) : (
        <>
          <ErpTable minWidth="min-w-[760px]">
            <ErpTableHead>
              <tr>
                <th className="px-2 py-2">Surveyor</th>
                <th className="px-2 py-2">Beat</th>
                <th className="px-2 py-2">Start</th>
                <th className="px-2 py-2">Breaks</th>
                <th className="px-2 py-2">End</th>
                <th className="px-2 py-2">Worked</th>
                <th className="px-2 py-2">Families</th>
              </tr>
            </ErpTableHead>
            <ErpTableBody>
              {data.days.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-2 py-6 text-center text-sm text-[var(--muted)]">
                    No survey day started on {data.date}.
                  </td>
                </tr>
              ) : (
                data.days.map((d) => {
                  const caps = data.captures.filter((c) => c.surveyDayId === d.id);
                  const route = surveyRouteLink([
                    d.startGeo,
                    ...caps.map((c) => c.geo),
                    ...(d.endGeo ? [d.endGeo] : []),
                  ]);
                  return (
                    <tr key={d.id}>
                      <td className="px-2 py-2 text-[12px]">
                        <b className="text-[var(--brand-deep)]">{d.memberName || nameOf(d.memberKey)}</b>
                        <div className="text-[10px] text-[var(--muted)]">
                          {d.startMode === "school" ? "Started at school (gate QR)" : "Started in field"}
                        </div>
                      </td>
                      <td className="px-2 py-2 text-[12px]">{beatOf(d.beatId)}</td>
                      <td className="px-2 py-2 text-[12px]">
                        {hhmm(d.startedAt)}{" "}
                        <a className="text-[10px] underline" href={mapLink(d.startGeo)} target="_blank" rel="noreferrer">
                          map ±{d.startGeo.accuracyM} m
                        </a>
                      </td>
                      <td className="px-2 py-2 text-[11px]">
                        {d.breaks.length === 0
                          ? "—"
                          : d.breaks.map((b, i) => (
                              <div key={i}>
                                {hhmm(b.startAt)}–{hhmm(b.endAt)}
                              </div>
                            ))}
                      </td>
                      <td className="px-2 py-2 text-[12px]">
                        {d.endedAt ? (
                          <>
                            {hhmm(d.endedAt)}{" "}
                            <a className="text-[10px] underline" href={mapLink(d.endGeo)} target="_blank" rel="noreferrer">
                              map
                            </a>
                          </>
                        ) : (
                          <span className="font-semibold text-[var(--warning)]">
                            {d.status === "on_break" ? "On break" : "Still out"}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-[12px] tabular-nums">{formatWorked(surveyWorkedMs(d, Date.now()))}</td>
                      <td className="px-2 py-2 text-[12px]">
                        <b className="tabular-nums">{caps.length}</b>{" "}
                        {route ? (
                          <a className="text-[10px] underline" href={route} target="_blank" rel="noreferrer">
                            route on map
                          </a>
                        ) : null}
                        {caps.length ? (
                          <div className="text-[10px] text-[var(--muted)]">
                            {caps
                              .slice(0, 3)
                              .map((c) => c.childName)
                              .join(", ")}
                            {caps.length > 3 ? ` +${caps.length - 3}` : ""}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })
              )}
            </ErpTableBody>
          </ErpTable>

          <div>
            <h4 className="mb-1 text-xs font-bold uppercase tracking-wide text-[var(--muted)]">Survey phones</h4>
            <ErpTable minWidth="min-w-[520px]">
              <ErpTableHead>
                <tr>
                  <th className="px-2 py-2">Surveyor</th>
                  <th className="px-2 py-2">Starts</th>
                  <th className="px-2 py-2">Registered phone</th>
                  <th className="px-2 py-2" />
                </tr>
              </ErpTableHead>
              <ErpTableBody>
                {data.team.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-2 py-4 text-center text-sm text-[var(--muted)]">
                      No survey team yet — add people in the team list above.
                    </td>
                  </tr>
                ) : (
                  data.team.map((t) => (
                    <tr key={t.memberId} className={t.assigned ? "" : "opacity-60"}>
                      <td className="px-2 py-2 text-[12px]">
                        {t.name}
                        <span className="text-[10px] text-[var(--muted)]">
                          {" "}
                          · {t.kind === "staff" ? "staff" : "outside"}
                          {t.assigned ? "" : " · not assigned"}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-[12px]">{t.startMode === "school" ? "At school" : "In field"}</td>
                      <td className="px-2 py-2 text-[12px]">
                        {t.phone ? t.phone : <span className="text-[var(--warning)]">None yet</span>}
                      </td>
                      <td className="px-2 py-2 text-right">
                        {canEdit ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void pair(t.memberId)}
                            className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs font-semibold text-[var(--brand-deep)] disabled:opacity-40"
                          >
                            {t.phone ? "Pair a new phone" : "Pair phone"}
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))
                )}
              </ErpTableBody>
            </ErpTable>
            <p className="mt-1 text-[11px] text-[var(--muted)]">
              School staff can also register by punching IN once at the gate from their own phone — the survey uses the same
              phone. Pairing a new phone stops the old one.
            </p>
          </div>
        </>
      )}
    </section>
  );
}
