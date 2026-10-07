"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  ErpSchoolFacts,
  ProfileDiff,
  ProfileSectionDef,
  SchoolProfileStore,
} from "@/lib/udiseSchoolProfile";

const ENDPOINT = "/api/v1/udise/robot/school-profile";

type Payload = {
  ok: boolean;
  error?: string;
  academicYear: string;
  sections: ProfileSectionDef[];
  store: SchoolProfileStore;
  facts: ErpSchoolFacts;
  compare1A: { academicYear: string; rows: ProfileDiff[]; respondent: string[] };
};

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

const STATUS_TEXT: Record<ProfileDiff["status"], string> = {
  same: "Same",
  differs: "Differs",
  "erp-unknown": "ERP has no record",
  "portal-unknown": "Blank on portal",
};

/**
 * Students → UDISE+ → what the robot read off the UDISE+ School Profile
 * module, section by section, and how Section 1A compares with Masters →
 * School profile. Read-only: a difference is fixed where it belongs (Masters,
 * or on the portal / through the Block for 1A), never applied from here.
 */
export function UdiseSchoolProfileCard() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [year, setYear] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const res = await fetch(ENDPOINT, { cache: "no-store" });
        const body = (await res.json()) as Payload;
        if (!live) return;
        if (!res.ok || !body.ok) throw new Error(body.error || `HTTP ${res.status}`);
        setData(body);
        const years = Object.keys(body.store).sort().reverse();
        setYear(body.store[body.academicYear] ? body.academicYear : years[0] || body.academicYear);
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : "Could not load the school profile.");
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const years = useMemo(() => (data ? Object.keys(data.store).sort().reverse() : []), [data]);
  const captured = data?.store[year] ?? {};
  const diffs = data?.compare1A.rows.filter((r) => r.status === "differs") ?? [];

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4" aria-label="UDISE+ school profile">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--brand-deep)]">School profile (UDISE+)</h3>
        {years.length > 1 ? (
          <label className="text-xs text-[var(--muted)]">
            Year{" "}
            <select
              className="rounded border border-[var(--border)] bg-[var(--card)] px-1.5 py-0.5 text-xs"
              value={year}
              onChange={(e) => setYear(e.target.value)}
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="text-xs text-[var(--muted)]">{year || "—"}</p>
        )}
      </div>
      <p className="mt-1 text-[11px] text-[var(--muted)]">
        What the portal&apos;s School Profile module showed when someone pressed <strong>Send this section to ERP</strong>{" "}
        (or <strong>Send all sections</strong>) in the BHB Office Robot on profile.udiseplus.gov.in. A copy only — nothing
        here changes the ERP or the portal. Each year is kept, so next year&apos;s empty boxes can be offered this
        year&apos;s answers.
      </p>

      {error ? <p className="mt-2 text-xs text-[var(--danger,#a3261a)]">{error}</p> : null}
      {!data && !error ? <p className="mt-2 text-xs text-[var(--muted)]">Loading…</p> : null}

      {data ? (
        <>
          <ul className="mt-3 space-y-1.5">
            {data.sections.map((s) => {
              const c = captured[s.key];
              const n = c ? Object.keys(c.fields).length : 0;
              const expanded = open === s.key;
              return (
                <li key={s.key} className="rounded-md border border-[var(--border)]">
                  <button
                    type="button"
                    className="flex w-full flex-wrap items-center justify-between gap-2 px-2.5 py-1.5 text-left text-xs disabled:cursor-default"
                    onClick={() => setOpen(expanded ? null : s.key)}
                    aria-expanded={expanded}
                    disabled={!c}
                  >
                    <span className="font-medium text-[var(--brand-deep)]">
                      {s.tab} · {s.title}
                    </span>
                    <span className="text-[11px] text-[var(--muted)]">
                      {c
                        ? `${n} field${n === 1 ? "" : "s"} · ${when(c.capturedAt)} by ${c.capturedBy}${c.formStatus ? ` · portal: ${c.formStatus}` : ""}`
                        : "not sent yet"}
                    </span>
                  </button>
                  {expanded && c ? (
                    <div className="max-h-80 overflow-auto border-t border-[var(--border)] px-2.5 py-2">
                      {n ? (
                        <table className="w-full text-left text-xs">
                          <thead>
                            <tr className="text-[11px] text-[var(--muted)]">
                              <th className="py-0.5 pr-2 font-medium">Question</th>
                              <th className="py-0.5 font-medium">Portal answer</th>
                            </tr>
                          </thead>
                          <tbody>
                            {Object.entries(c.fields).map(([control, f]) => (
                              <tr key={control} className="border-t border-[var(--border)] align-top">
                                <td className="py-0.5 pr-2">
                                  {f.label || control}
                                  {f.locked ? <span className="text-[var(--muted)]"> · locked</span> : null}
                                </td>
                                <td className="py-0.5">
                                  {f.type === "checkbox"
                                    ? f.value === "true"
                                      ? "✓ ticked"
                                      : "not ticked"
                                    : f.text || f.value || <span className="text-[var(--muted)]">(blank)</span>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <p className="whitespace-pre-wrap text-[11px] text-[var(--muted)]">
                          No boxes on this section — the portal showed text only:
                          {"\n"}
                          {c.text.slice(0, 3000)}
                        </p>
                      )}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>

          <div className="mt-3 rounded-lg border border-[var(--border)] p-3">
            <p className="text-xs font-semibold text-[var(--brand-deep)]">
              Section 1A vs ERP (Masters → School profile)
              {data.compare1A.academicYear ? ` · portal ${data.compare1A.academicYear}` : ""}
            </p>
            {!data.compare1A.academicYear ? (
              <p className="mt-1 text-[11px] text-[var(--muted)]">
                Open “1.1 to 1.30” on the portal and press Send this section to ERP to compare.
              </p>
            ) : (
              <>
                {data.compare1A.respondent.length ? (
                  <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-xs text-[var(--danger,#a3261a)]">
                    {data.compare1A.respondent.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                    <li className="text-[var(--muted)]">
                      1A is maintained by the Block / School Directory Management portal — ask the BRC to put the
                      school&apos;s own contact as respondent.
                    </li>
                  </ul>
                ) : null}
                <p className="mt-1.5 text-[11px] text-[var(--muted)]">
                  {diffs.length
                    ? `${diffs.length} item(s) differ. Fix the ERP in Masters → School profile, or the portal through the Block — whichever is wrong.`
                    : "No differences on the items both sides know."}
                </p>
                {data.compare1A.rows.length ? (
                  <table className="mt-1 w-full text-left text-xs">
                    <thead>
                      <tr className="text-[11px] text-[var(--muted)]">
                        <th className="py-0.5 pr-2 font-medium">Item</th>
                        <th className="py-0.5 pr-2 font-medium">UDISE+ 1A</th>
                        <th className="py-0.5 pr-2 font-medium">ERP</th>
                        <th className="py-0.5 font-medium" />
                      </tr>
                    </thead>
                    <tbody>
                      {data.compare1A.rows.map((r) => (
                        <tr key={r.item} className="border-t border-[var(--border)] align-top">
                          <td className="py-0.5 pr-2">{r.item}</td>
                          <td className="py-0.5 pr-2">{r.portal || "—"}</td>
                          <td className="py-0.5 pr-2">{r.erp || "—"}</td>
                          <td
                            className={`py-0.5 text-[11px] ${
                              r.status === "differs"
                                ? "font-semibold text-[var(--danger,#a3261a)]"
                                : r.status === "same"
                                  ? "text-[var(--success)]"
                                  : "text-[var(--muted)]"
                            }`}
                          >
                            {STATUS_TEXT[r.status]}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="mt-1 text-[11px] text-[var(--muted)]">
                    The robot found no 1A boxes it could match to the ERP&apos;s items.
                  </p>
                )}
              </>
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}
