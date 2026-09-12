"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { waPanelErrorText } from "@/lib/waPanelAccess";
import {
  MastersEmptyRow,
  MastersTableCard,
} from "@/components/masters/MastersLayout";
import {
  DEFAULT_WA_RATES,
  projectedMonthlyPaise,
  monthLabel,
  rateRupees,
  ratesAreDefaults,
  repriceWaUsage,
  repriceWaUsageByAudience,
  repriceWaUsageByMonth,
  repriceWaUsageByStudent,
  projectedSessionPaise,
  rupees,
  waUsageYearTotals,
  type WaCostRates,
  type WaUsageAudienceSection,
  type WaUsageByStudent,
  type WaUsageMonth,
  type WaUsageSummary,
  type WaUsageYearWindow,
} from "@/lib/waUsageCost";
import { autoBtnOutline, autoBtnPrimary, autoInp } from "./automationUi";
import { ErpSortTh, useTableSort } from "@/components/ui/erp-table-sort";

const WINDOWS = [
  { id: "7", label: "7 days", days: 7 },
  { id: "30", label: "30 days", days: 30 },
  { id: "90", label: "90 days", days: 90 },
  { id: "365", label: "Last 12 months", days: 365 },
] as const;

type Report = {
  sinceIso: string;
  windowDays: number;
  rates: WaCostRates;
  summary: WaUsageSummary;
  metaOutboundMessages: number;
  uncategorised: number;
  catalogueOk: boolean;
  truncated: boolean;
  byStudent: WaUsageByStudent;
  byAudience: WaUsageAudienceSection[];
  staffNumbersKnown: number;
  byMonth: WaUsageMonth[];
  year: WaUsageYearWindow;
  rosterOk: boolean;
  attributedByNumber: number;
};

/** The rate fields the office edits, in rupees per message. */
const RATE_FIELDS = [
  { key: "marketing" as const, label: "Marketing template", hint: "Offers, invites, anything promotional" },
  { key: "utility" as const, label: "Utility template", hint: "Fee reminders, receipts, notices" },
  { key: "authentication" as const, label: "Authentication template", hint: "OTP / login codes" },
  { key: "service" as const, label: "Free-form reply", hint: "Replies inside the 24-hour window — free today" },
];

function Stat({
  label,
  value,
  hint,
  tone = "plain",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "plain" | "money" | "warn";
}) {
  const ring =
    tone === "money"
      ? "border-emerald-200 bg-emerald-50"
      : tone === "warn"
        ? "border-amber-200 bg-amber-50"
        : "border-[var(--border)] bg-[var(--surface-sunken)]";
  return (
    <div className={`rounded-xl border px-3 py-2 ${ring}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
        {label}
      </div>
      <div className="mt-0.5 text-lg font-semibold text-[var(--brand-deep)]">
        {value}
      </div>
      {hint ? (
        <div className="mt-0.5 text-[10px] text-[var(--muted)]">{hint}</div>
      ) : null}
    </div>
  );
}

export function AutomationUsageCost({ readOnly }: { readOnly: boolean }) {
  const [days, setDays] = useState<string>("30");
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<WaCostRates>({ ...DEFAULT_WA_RATES });
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [childQ, setChildQ] = useState("");
  const [showAllChildren, setShowAllChildren] = useState(false);

  const sinceIso = useMemo(() => {
    const d = WINDOWS.find((w) => w.id === days)?.days ?? 30;
    return new Date(Date.now() - d * 86_400_000).toISOString();
  }, [days]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/wa/usage?since=${encodeURIComponent(sinceIso)}`,
      );
      const json = (await res.json()) as { ok?: boolean; error?: string } & Report;
      if (!res.ok || !json.ok) {
        // Never fall back to zeros: "could not read" must not reach the
        // director as "WhatsApp cost nothing".
        setError(waPanelErrorText(res.status, json.error, "Could not read the message log"));
        return;
      }
      setReport(json);
      setDraft(json.rates);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the message log");
    } finally {
      setLoading(false);
    }
  }, [sinceIso]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * While the office is typing a rate, the tables re-price live off the
   * numbers on screen — so you can see what a rate change does before you
   * commit it.
   */
  const summary = useMemo(() => {
    if (!report) return null;
    return editing ? repriceWaUsage(report.summary, draft) : report.summary;
  }, [report, editing, draft]);

  const audiences = useMemo(() => {
    if (!report) return [];
    return editing
      ? repriceWaUsageByAudience(report.byAudience, draft)
      : report.byAudience;
  }, [report, editing, draft]);

  const months = useMemo(() => {
    if (!report) return [];
    return editing
      ? repriceWaUsageByMonth(report.byMonth, draft)
      : report.byMonth;
  }, [report, editing, draft]);

  const year = useMemo(() => waUsageYearTotals(months), [months]);

  const sessionPace = useMemo(
    () => (report ? projectedSessionPaise(year, report.year) : null),
    [year, report],
  );

  const maxMonth = useMemo(
    () => Math.max(1, ...months.map((m) => m.costPaise)),
    [months],
  );

  const byStudent = useMemo(() => {
    if (!report) return null;
    return editing
      ? repriceWaUsageByStudent(report.byStudent, draft)
      : report.byStudent;
  }, [report, editing, draft]);

  /** The office looks for one child by name or admission number. */
  const children = useMemo(() => {
    if (!byStudent) return [];
    const needle = childQ.trim().toLowerCase();
    if (!needle) return byStudent.students;
    return byStudent.students.filter(
      (s) =>
        s.name.toLowerCase().includes(needle) ||
        s.admissionNo.toLowerCase().includes(needle) ||
        s.className.toLowerCase().includes(needle),
    );
  }, [byStudent, childQ]);

  // Sorting for the four tables below. Every column sorts by the NUMBER
  // behind the cell, not the rendered string, so "₹2,500" orders as 250000
  // and not alphabetically. Each starts on cost, highest first, which is the
  // order the server already sends — so the first view is unchanged and a
  // click is what reorders it.
  const bucketSort = useTableSort(
    summary?.buckets ?? [],
    {
      type: (b) => b.label,
      sent: (b) => b.sent,
      delivered: (b) => b.delivered,
      failed: (b) => b.failed,
      rate: (b) => b.ratePaise,
      cost: (b) => b.costPaise,
    },
    "cost",
    "desc",
  );
  const templateSort = useTableSort(
    summary?.templates ?? [],
    {
      template: (t) => t.templateName,
      sent: (t) => t.sent,
      delivered: (t) => t.delivered,
      failed: (t) => t.failed,
      cost: (t) => t.costPaise,
    },
    "cost",
    "desc",
  );
  const classSort = useTableSort(
    byStudent?.classes ?? [],
    {
      className: (c) => c.className,
      students: (c) => c.students,
      messages: (c) => c.messages,
      delivered: (c) => c.delivered,
      perChild: (c) => c.perStudentPaise,
      cost: (c) => c.costPaise,
    },
    "cost",
    "desc",
  );
  const childSort = useTableSort(
    children,
    {
      child: (s) => s.name,
      className: (s) => s.className,
      messages: (s) => s.messages,
      delivered: (s) => s.delivered,
      cost: (s) => s.costPaise,
    },
    "cost",
    "desc",
  );

  const save = useCallback(async () => {
    setSaving(true);
    setNotice(null);
    try {
      const res = await fetch(
        `/api/wa/usage?since=${encodeURIComponent(sinceIso)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rates: draft }),
        },
      );
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        report?: Report;
      };
      if (!res.ok || !json.ok) {
        setNotice(json.error || "Could not save the rates");
        return;
      }
      if (json.report) setReport(json.report);
      setEditing(false);
      setNotice("Rates saved.");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Could not save the rates");
    } finally {
      setSaving(false);
    }
  }, [draft, sinceIso]);

  const maxDay = useMemo(
    () => Math.max(1, ...(summary?.days.map((d) => d.costPaise) ?? [1])),
    [summary],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-[var(--brand-deep)]">
            Usage &amp; cost
          </div>
          <p className="mt-0.5 max-w-2xl text-[11px] text-[var(--muted)]">
            Counted from what the school actually sent, priced at{" "}
            <strong>your own rates</strong>. Meta charges per template message{" "}
            <em>delivered</em> — a template that failed costs nothing, and
            replies inside the 24-hour window are free.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {WINDOWS.map((w) => (
            <button
              key={w.id}
              type="button"
              className={`rounded-lg px-3 py-1.5 text-[11px] font-semibold ${
                days === w.id
                  ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                  : "bg-[var(--surface-sunken)] text-[var(--brand-deep)]"
              }`}
              onClick={() => setDays(w.id)}
            >
              {w.label}
            </button>
          ))}
          <button type="button" className={autoBtnOutline} onClick={() => void load()}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-800">
          {error}
        </div>
      ) : null}

      {notice ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] px-3 py-2 text-[12px] text-[var(--brand-deep)]">
          {notice}
        </div>
      ) : null}

      {report && summary ? (
        <>
          {ratesAreDefaults(report.rates) ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
              <strong>These are starting figures, not your bill.</strong> Nobody
              has entered the school&apos;s own rates yet, so the cost below uses
              published list prices. Open <em>Rate card</em> and copy the
              per-message rates from your Meta or BSP invoice.
            </div>
          ) : (
            <div className="text-[11px] text-[var(--muted)]">
              Rates set by {report.rates.updatedBy || "someone"} on{" "}
              {new Date(report.rates.updatedAt).toLocaleDateString()}
              {report.rates.note ? ` — ${report.rates.note}` : ""}.
            </div>
          )}

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label={`Estimated cost · ${report.windowDays} days`}
              value={rupees(summary.totalPaise)}
              hint="Delivered templates + study-help AI"
              tone="money"
            />
            <Stat
              label="At this rate, a month"
              value={rupees(
                projectedMonthlyPaise(summary.totalPaise, report.windowDays),
              )}
              hint="Straight-line projection"
            />
            <Stat
              label="Templates delivered"
              value={String(summary.templateDelivered)}
              hint={`${summary.templateSent} sent · ${summary.templateFailed} failed`}
            />
            <Stat
              label="Messages the number sent"
              value={String(report.metaOutboundMessages)}
              hint="Including free bot replies"
            />
          </div>

          {summary.pendingCostPaise > 0 ? (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] px-3 py-2 text-[11px] text-[var(--muted)]">
              {summary.templatePending} template
              {summary.templatePending === 1 ? "" : "s"} handed to Meta with no
              delivery report yet. If they all land, add{" "}
              <strong>{rupees(summary.pendingCostPaise)}</strong>. They are not
              in the figure above.
            </div>
          ) : null}

          {!report.catalogueOk ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
              The template list could not be read, so every template is priced
              at the marketing rate — the dearest one. The real figure is lower.
            </div>
          ) : report.uncategorised > 0 ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
              {report.uncategorised} send
              {report.uncategorised === 1 ? " uses a template" : "s use templates"}{" "}
              the ERP does not have on file, priced at the marketing rate to
              avoid understating the bill. Sync templates from Meta to price
              them properly.
            </div>
          ) : null}

          {report.truncated ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
              This window has more messages than one read can hold — the figures
              cover the most recent 5,000. Choose a shorter window for an exact
              number.
            </div>
          ) : null}

          {months.length > 0 ? (
            <MastersTableCard
              title={`Session ${report.year.label}, month by month — ${rupees(
                year.costPaise,
              )}`}
            >
              <div className="px-3 py-2 text-[11px] text-[var(--muted)]">
                {monthLabel(report.year.fromMonth)} to{" "}
                {monthLabel(report.year.endMonth)}, whatever window is chosen
                above. <strong>{rupees(year.averagePaise)}</strong> a month so
                far
                {year.dearest && year.dearest.costPaise > 0
                  ? `, dearest ${year.dearest.label} at ${rupees(
                      year.dearest.costPaise,
                    )}`
                  : ""}
                . {year.delivered} delivered
                {year.failed > 0 ? `, ${year.failed} failed` : ""}.
                {sessionPace !== null && report.year.monthsRemaining > 0 ? (
                  <>
                    {" "}
                    At this pace the whole session to{" "}
                    {monthLabel(report.year.endMonth)} comes to{" "}
                    <strong>{rupees(sessionPace)}</strong> —{" "}
                    {report.year.monthsRemaining} month
                    {report.year.monthsRemaining === 1 ? "" : "s"} still to go.
                  </>
                ) : null}
                {!report.year.configured
                  ? " No session is defined in Masters, so April to March is assumed."
                  : ""}
                {year.completeMonths < months.length
                  ? " Months marked ~ were only partly read, so they are a floor and are left out of the average."
                  : ""}
              </div>
              <ul className="divide-y divide-[var(--border)]">
                {months
                  .slice()
                  .reverse()
                  .map((m) => (
                    <li
                      key={m.month}
                      className="flex items-center gap-3 px-3 py-1.5 text-[11px]"
                    >
                      <span className="w-20 shrink-0 text-[var(--muted)]">
                        {m.label}
                        {m.partial ? " ~" : ""}
                      </span>
                      <span className="h-2 flex-1 overflow-hidden rounded bg-[var(--surface-sunken)]">
                        <span
                          className="block h-full rounded bg-[var(--brand-deep)]"
                          style={{
                            width: `${Math.round((m.costPaise / maxMonth) * 100)}%`,
                          }}
                        />
                      </span>
                      <span className="w-24 shrink-0 text-right font-semibold text-[var(--brand-deep)]">
                        {rupees(m.costPaise)}
                      </span>
                      <span className="w-32 shrink-0 text-right text-[var(--muted)]">
                        {m.sent === 0
                          ? "nothing sent"
                          : `${m.delivered} landed${
                              m.failed ? ` · ${m.failed} failed` : ""
                            }`}
                      </span>
                    </li>
                  ))}
              </ul>
            </MastersTableCard>
          ) : null}

          <MastersTableCard title="By message type">
            {summary.buckets.length === 0 ? (
              <MastersEmptyRow label="Nothing was sent in this window." />
            ) : (
              <table className="w-full text-[12px]">
                <thead className="sticky top-0 bg-[var(--surface-sunken)] text-[10px] uppercase text-[var(--muted)]">
                  <tr>
                    <ErpSortTh sort={bucketSort} field="type">Type</ErpSortTh>
                    <ErpSortTh sort={bucketSort} field="sent" align="right">Sent</ErpSortTh>
                    <ErpSortTh sort={bucketSort} field="delivered" align="right">Delivered</ErpSortTh>
                    <ErpSortTh sort={bucketSort} field="failed" align="right">Failed</ErpSortTh>
                    <ErpSortTh sort={bucketSort} field="rate" align="right">Rate</ErpSortTh>
                    <ErpSortTh sort={bucketSort} field="cost" align="right">Cost</ErpSortTh>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {bucketSort.rows.map((b) => (
                    <tr key={b.category}>
                      <td className="px-3 py-2 font-medium text-[var(--brand-deep)]">
                        {b.label}
                      </td>
                      <td className="px-3 py-2 text-right">{b.sent}</td>
                      <td className="px-3 py-2 text-right">{b.delivered}</td>
                      <td className="px-3 py-2 text-right text-rose-700">
                        {b.failed || ""}
                      </td>
                      <td className="px-3 py-2 text-right text-[var(--muted)]">
                        ₹{rateRupees(b.ratePaise)}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold">
                        {rupees(b.costPaise)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </MastersTableCard>

          {audiences.length > 0 ? (
            <div className="space-y-3">
              {audiences.map((a) => (
                <MastersTableCard
                  key={a.audience}
                  title={`${a.label} — ${rupees(a.summary.messageCostPaise)}`}
                >
                  <div className="px-3 py-2 text-[11px] text-[var(--muted)]">
                    {a.hint}. {a.summary.templateSent} template message
                    {a.summary.templateSent === 1 ? "" : "s"}
                    {a.summary.serviceSent > 0
                      ? `, ${a.summary.serviceSent} free-form repl${
                          a.summary.serviceSent === 1 ? "y" : "ies"
                        }`
                      : ""}
                    .
                  </div>
                  <AudienceBucketTable buckets={a.summary.buckets} />
                  {a.summary.templates.length > 0 ? (
                    <div className="px-3 py-2 text-[10px] text-[var(--muted)]">
                      Dearest here:{" "}
                      {a.summary.templates
                        .slice(0, 3)
                        .map((t) => `${t.templateName} (${rupees(t.costPaise)})`)
                        .join(" · ")}
                    </div>
                  ) : null}
                </MastersTableCard>
              ))}
              <p className="text-[10px] leading-relaxed text-[var(--muted)]">
                Split by whose number was written to — a staff number on file
                against an active staff member, a number belonging to a family
                on the roster, or neither. An explicit family on the log row
                wins, so a staff member who is also a parent here counts as a
                parent only when the message was sent to them as one.
                {report.staffNumbersKnown === 0
                  ? " No active staff numbers are on file, so nothing can land in a staff section yet."
                  : ` ${report.staffNumbersKnown} staff numbers on file.`}
              </p>
            </div>
          ) : null}

          <MastersTableCard title="Where the money went — by template">
            {summary.templates.length === 0 ? (
              <MastersEmptyRow label="No template messages in this window." />
            ) : (
              <table className="w-full text-[12px]">
                <thead className="sticky top-0 bg-[var(--surface-sunken)] text-[10px] uppercase text-[var(--muted)]">
                  <tr>
                    <ErpSortTh sort={templateSort} field="template">Template</ErpSortTh>
                    <ErpSortTh sort={templateSort} field="sent" align="right">Sent</ErpSortTh>
                    <ErpSortTh sort={templateSort} field="delivered" align="right">Delivered</ErpSortTh>
                    <ErpSortTh sort={templateSort} field="failed" align="right">Failed</ErpSortTh>
                    <ErpSortTh sort={templateSort} field="cost" align="right">Cost</ErpSortTh>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {/* Sorted first, THEN cut to 25 — cutting first would sort
                      only the top of the list and quietly hide the rest. */}
                  {templateSort.rows.slice(0, 25).map((t) => (
                    <tr key={t.templateName}>
                      <td className="px-3 py-2">
                        <span className="font-medium text-[var(--brand-deep)]">
                          {t.templateName}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">{t.sent}</td>
                      <td className="px-3 py-2 text-right">{t.delivered}</td>
                      <td className="px-3 py-2 text-right text-rose-700">
                        {t.failed || ""}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold">
                        {rupees(t.costPaise)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </MastersTableCard>

          {byStudent && !report.rosterOk ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
              The student roster could not be read, so nothing could be split
              by class. The totals above are unaffected.
            </div>
          ) : null}

          {byStudent && report.rosterOk ? (
            <>
              <MastersTableCard title="By class">
                {byStudent.classes.length === 0 ? (
                  <MastersEmptyRow label="Nothing in this window could be linked to a class." />
                ) : (
                  <table className="w-full text-[12px]">
                    <thead className="sticky top-0 bg-[var(--surface-sunken)] text-[10px] uppercase text-[var(--muted)]">
                      <tr>
                        <ErpSortTh sort={classSort} field="className">Class</ErpSortTh>
                        <ErpSortTh sort={classSort} field="students" align="right">Children written to</ErpSortTh>
                        <ErpSortTh sort={classSort} field="messages" align="right">Messages</ErpSortTh>
                        <ErpSortTh sort={classSort} field="delivered" align="right">Delivered</ErpSortTh>
                        <ErpSortTh sort={classSort} field="perChild" align="right">Per child</ErpSortTh>
                        <ErpSortTh sort={classSort} field="cost" align="right">Cost</ErpSortTh>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]">
                      {classSort.rows.map((c) => (
                        <tr key={c.classId || "none"}>
                          <td className="px-3 py-2 font-medium text-[var(--brand-deep)]">
                            {c.className}
                          </td>
                          <td className="px-3 py-2 text-right">{c.students}</td>
                          <td className="px-3 py-2 text-right">{c.messages}</td>
                          <td className="px-3 py-2 text-right">{c.delivered}</td>
                          <td className="px-3 py-2 text-right text-[var(--muted)]">
                            {rupees(c.perStudentPaise)}
                          </td>
                          <td className="px-3 py-2 text-right font-semibold">
                            {rupees(c.costPaise)}
                          </td>
                        </tr>
                      ))}
                      {byStudent.unattributed.messages > 0 ? (
                        <tr className="bg-[var(--surface-sunken)]">
                          <td className="px-3 py-2 text-[var(--muted)]">
                            Not linked to a child
                          </td>
                          <td className="px-3 py-2 text-right">—</td>
                          <td className="px-3 py-2 text-right">
                            {byStudent.unattributed.messages}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {byStudent.unattributed.delivered}
                          </td>
                          <td className="px-3 py-2 text-right">—</td>
                          <td className="px-3 py-2 text-right font-semibold">
                            {rupees(byStudent.unattributed.costPaise)}
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                )}
              </MastersTableCard>

              <p className="text-[10px] leading-relaxed text-[var(--muted)]">
                A message about a family with three children is{" "}
                <strong>one</strong> charge, split three ways — so these
                columns add up to the same total as the tables above rather
                than counting a reminder once per sibling.
                {report.attributedByNumber > 0
                  ? ` ${report.attributedByNumber} send${
                      report.attributedByNumber === 1 ? "" : "s"
                    } had no family on the log row and were matched by phone number instead; a number more than one family uses is left under "Not linked to a child" rather than guessed.`
                  : ""}
              </p>

              <MastersTableCard title="By child">
                <div className="px-3 py-2">
                  <input
                    className={autoInp}
                    placeholder="Find a child — name, admission number or class…"
                    value={childQ}
                    onChange={(e) => setChildQ(e.target.value)}
                  />
                </div>
                {children.length === 0 ? (
                  <MastersEmptyRow
                    label={
                      childQ.trim()
                        ? "No child matches that."
                        : "Nothing in this window could be linked to a child."
                    }
                  />
                ) : (
                  <table className="w-full text-[12px]">
                    <thead className="sticky top-0 bg-[var(--surface-sunken)] text-[10px] uppercase text-[var(--muted)]">
                      <tr>
                        <ErpSortTh sort={childSort} field="child">Child</ErpSortTh>
                        <ErpSortTh sort={childSort} field="className">Class</ErpSortTh>
                        <ErpSortTh sort={childSort} field="messages" align="right">Messages</ErpSortTh>
                        <ErpSortTh sort={childSort} field="delivered" align="right">Delivered</ErpSortTh>
                        <ErpSortTh sort={childSort} field="cost" align="right">Their share</ErpSortTh>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]">
                      {(showAllChildren ? childSort.rows : childSort.rows.slice(0, 50)).map(
                        (s) => (
                          <tr key={s.studentId}>
                            <td className="px-3 py-2">
                              <span className="font-medium text-[var(--brand-deep)]">
                                {s.name}
                              </span>
                              {s.admissionNo ? (
                                <span className="ml-1 text-[10px] text-[var(--muted)]">
                                  {s.admissionNo}
                                </span>
                              ) : null}
                            </td>
                            <td className="px-3 py-2 text-[var(--muted)]">
                              {s.className || "—"}
                            </td>
                            <td className="px-3 py-2 text-right">{s.messages}</td>
                            <td className="px-3 py-2 text-right">{s.delivered}</td>
                            <td className="px-3 py-2 text-right font-semibold">
                              {rupees(s.costPaise)}
                            </td>
                          </tr>
                        ),
                      )}
                    </tbody>
                  </table>
                )}
                {!showAllChildren && children.length > 50 ? (
                  <div className="px-3 py-2">
                    <button
                      type="button"
                      className={autoBtnOutline}
                      onClick={() => setShowAllChildren(true)}
                    >
                      Show all {children.length} children
                    </button>
                  </div>
                ) : null}
              </MastersTableCard>
            </>
          ) : null}

          {summary.days.length > 0 ? (
            <MastersTableCard title="Day by day">
              <ul className="divide-y divide-[var(--border)]">
                {summary.days
                  .slice()
                  .reverse()
                  .slice(0, 31)
                  .map((d) => (
                    <li
                      key={d.day}
                      className="flex items-center gap-3 px-3 py-1.5 text-[11px]"
                    >
                      <span className="w-20 shrink-0 text-[var(--muted)]">
                        {d.day}
                      </span>
                      <span className="h-2 flex-1 overflow-hidden rounded bg-[var(--surface-sunken)]">
                        <span
                          className="block h-full rounded bg-[var(--brand-deep)]"
                          style={{
                            width: `${Math.round((d.costPaise / maxDay) * 100)}%`,
                          }}
                        />
                      </span>
                      <span className="w-24 shrink-0 text-right font-semibold text-[var(--brand-deep)]">
                        {rupees(d.costPaise)}
                      </span>
                      <span className="w-28 shrink-0 text-right text-[var(--muted)]">
                        {d.delivered} landed
                        {d.failed ? ` · ${d.failed} failed` : ""}
                      </span>
                    </li>
                  ))}
              </ul>
            </MastersTableCard>
          ) : null}

          {summary.ai.calls > 0 ? (
            <MastersTableCard title="Study help — AI behind the answers">
              <div className="px-3 py-2 text-[11px] text-[var(--muted)]">
                {summary.ai.calls} answers ·{" "}
                {(summary.ai.promptTokens + summary.ai.completionTokens).toLocaleString(
                  "en-IN",
                )}{" "}
                tokens · <strong>{rupees(summary.ai.costPaise)}</strong>. Counted
                across the app and WhatsApp together — the tutor does not record
                which one asked.
              </div>
              <table className="w-full text-[12px]">
                <thead className="bg-[var(--surface-sunken)] text-[10px] uppercase text-[var(--muted)]">
                  <tr>
                    <th className="px-3 py-2 text-left">Model</th>
                    <th className="px-3 py-2 text-right">Answers</th>
                    <th className="px-3 py-2 text-right">Tokens in</th>
                    <th className="px-3 py-2 text-right">Tokens out</th>
                    <th className="px-3 py-2 text-right">Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {summary.ai.byModel.map((m) => (
                    <tr key={m.model}>
                      <td className="px-3 py-2 font-medium text-[var(--brand-deep)]">
                        {m.model}
                      </td>
                      <td className="px-3 py-2 text-right">{m.calls}</td>
                      <td className="px-3 py-2 text-right">
                        {m.promptTokens.toLocaleString("en-IN")}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {m.completionTokens.toLocaleString("en-IN")}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold">
                        {rupees(m.costPaise)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </MastersTableCard>
          ) : null}

          <MastersTableCard title="Rate card">
            <div className="space-y-3 px-3 py-3">
              <p className="text-[11px] text-[var(--muted)]">
                Rates are per message, in rupees, from your own Meta or BSP
                invoice. Four decimals are kept — a utility message at ₹0.1146
                is not ₹0.11.
              </p>
              {editing ? (
                <>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {RATE_FIELDS.map((f) => (
                      <label
                        key={f.key}
                        className="block text-[11px] font-semibold text-[var(--muted)]"
                      >
                        {f.label} (₹)
                        <input
                          className={`${autoInp} mt-1`}
                          type="number"
                          min={0}
                          step="0.0001"
                          value={(draft[f.key] / 100).toString()}
                          onChange={(e) =>
                            setDraft((d) => ({
                              ...d,
                              [f.key]: Math.max(0, Number(e.target.value) * 100),
                            }))
                          }
                        />
                        <span className="mt-0.5 block font-normal">{f.hint}</span>
                      </label>
                    ))}
                    <label className="block text-[11px] font-semibold text-[var(--muted)]">
                      Study-help AI in (₹ per 1,000 tokens)
                      <input
                        className={`${autoInp} mt-1`}
                        type="number"
                        min={0}
                        step="0.0001"
                        value={(draft.aiInputPerKTok / 100).toString()}
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            aiInputPerKTok: Math.max(0, Number(e.target.value) * 100),
                          }))
                        }
                      />
                    </label>
                    <label className="block text-[11px] font-semibold text-[var(--muted)]">
                      Study-help AI out (₹ per 1,000 tokens)
                      <input
                        className={`${autoInp} mt-1`}
                        type="number"
                        min={0}
                        step="0.0001"
                        value={(draft.aiOutputPerKTok / 100).toString()}
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            aiOutputPerKTok: Math.max(0, Number(e.target.value) * 100),
                          }))
                        }
                      />
                    </label>
                  </div>
                  <label className="block text-[11px] font-semibold text-[var(--muted)]">
                    Where these came from
                    <input
                      className={`${autoInp} mt-1`}
                      placeholder="e.g. Meta rate card, 1 Sep 2026"
                      value={draft.note}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, note: e.target.value.slice(0, 200) }))
                      }
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={autoBtnPrimary}
                      disabled={saving}
                      onClick={() => void save()}
                    >
                      {saving ? "Saving…" : "Save rates"}
                    </button>
                    <button
                      type="button"
                      className={autoBtnOutline}
                      onClick={() => {
                        setDraft(report.rates);
                        setEditing(false);
                      }}
                    >
                      Cancel
                    </button>
                    <span className="self-center text-[10px] text-[var(--muted)]">
                      The tables above are already showing these rates.
                    </span>
                  </div>
                </>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  {RATE_FIELDS.map((f) => (
                    <span key={f.key} className="text-[11px] text-[var(--muted)]">
                      {f.label}:{" "}
                      <strong className="text-[var(--brand-deep)]">
                        ₹{rateRupees(report.rates[f.key])}
                      </strong>
                    </span>
                  ))}
                  <button
                    type="button"
                    className={autoBtnOutline}
                    disabled={readOnly}
                    onClick={() => setEditing(true)}
                  >
                    {readOnly ? "View only" : "Edit rates"}
                  </button>
                </div>
              )}
            </div>
          </MastersTableCard>

          <p className="text-[10px] leading-relaxed text-[var(--muted)]">
            How this is counted: every outbound WhatsApp message the ERP logged
            in the window, joined to Meta&apos;s delivery report. Only delivered
            template messages are charged, at the category rate above. A
            template the ERP does not recognise is priced at the marketing rate
            so the estimate is never flattering. This is an estimate at your
            configured rates, not an invoice — Meta&apos;s own bill is the
            authority.
          </p>
        </>
      ) : !error && !loading ? (
        <MastersEmptyRow label="No usage yet." />
      ) : null}
    </div>
  );
}

/**
 * One audience's cost table. Its own component because a table inside a
 * `.map()` cannot hold a hook, and sorting needs one per table — the three
 * audiences sort independently, which is what somebody comparing them wants.
 */
function AudienceBucketTable({
  buckets,
}: {
  buckets: WaUsageSummary["buckets"];
}) {
  const sort = useTableSort(
    buckets,
    {
      type: (b) => b.label,
      sent: (b) => b.sent,
      delivered: (b) => b.delivered,
      failed: (b) => b.failed,
      rate: (b) => b.ratePaise,
      cost: (b) => b.costPaise,
    },
    "cost",
    "desc",
  );
  return (
    <table className="w-full text-[12px]">
      <thead className="bg-[var(--surface-sunken)] text-[10px] uppercase text-[var(--muted)]">
        <tr>
          <ErpSortTh sort={sort} field="type">Type</ErpSortTh>
          <ErpSortTh sort={sort} field="sent" align="right">Sent</ErpSortTh>
          <ErpSortTh sort={sort} field="delivered" align="right">Delivered</ErpSortTh>
          <ErpSortTh sort={sort} field="failed" align="right">Failed</ErpSortTh>
          <ErpSortTh sort={sort} field="rate" align="right">Rate</ErpSortTh>
          <ErpSortTh sort={sort} field="cost" align="right">Cost</ErpSortTh>
        </tr>
      </thead>
      <tbody className="divide-y divide-[var(--border)]">
        {sort.rows.map((b) => (
          <tr key={b.category}>
            <td className="px-3 py-2 font-medium text-[var(--brand-deep)]">{b.label}</td>
            <td className="px-3 py-2 text-right">{b.sent}</td>
            <td className="px-3 py-2 text-right">{b.delivered}</td>
            <td className="px-3 py-2 text-right text-rose-700">{b.failed || ""}</td>
            <td className="px-3 py-2 text-right text-[var(--muted)]">₹{rateRupees(b.ratePaise)}</td>
            <td className="px-3 py-2 text-right font-semibold">{rupees(b.costPaise)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
