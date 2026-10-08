"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReachReport } from "@/lib/commsReach";
import { flattenTemplateParam } from "@/lib/classNoticeWa";
import { TENANT } from "@/lib/types";
import { ErpTable, ErpTableBody, ErpTableHead, ErpTableShell } from "@/components/ui/erp-roster";
import { RowActionMenu } from "@/components/ui/erp-grid";

/** The parent app on Google Play (school.bhbinternational.parent, live since Oct 2026). */
export const PARENT_APP_URL = "https://play.google.com/store/apps/details?id=school.bhbinternational.parent";

/** The notice to every family: Hindi first (parents' default), then English. Template params take no newlines. */
export const MOVE_NOTICE_TITLE = "Class updates now from the school / कक्षा सूचनाएँ अब स्कूल से";
export const MOVE_NOTICE_BODY = flattenTemplateParam(
  [
    "प्रिय अभिभावक, अब से गृहकार्य, कक्षा डायरी और विद्यालय की सूचनाएँ इसी आधिकारिक स्कूल व्हाट्सऐप नंबर से और BHB International School ऐप में आएँगी।",
    `कृपया यह नंबर 'BHB School' नाम से सेव करें और ऐप डाउनलोड करें: ${PARENT_APP_URL}`,
    "कुछ सप्ताह बाद कक्षा के व्हाट्सऐप ग्रुप में केवल विद्यालय ही संदेश भेजेगा।",
    "| Dear parent, from now on homework, the class diary and school notices will come from this official school WhatsApp number and in the BHB International School app.",
    `Please save this number as 'BHB School' and download the app: ${PARENT_APP_URL}`,
    "In a few weeks the class WhatsApp groups will become announcement-only.",
  ].join(" "),
);

type DryRun = { recipientCount: number; sample?: string[]; skippedNotOnWhatsApp?: number; skippedNoNumber?: number; skippedOptOut?: number; skippedNoTemplate?: number };

/**
 * Comms → Class WA → moving off the personal class WhatsApp groups
 * (director, 8 Oct 2026): who the school can reach without them, the families
 * to call before a group closes, and one notice to every family from the
 * school number. The notice is the school's approved "School notice"
 * template; a dry run shows the count first and the office presses Send.
 */
export function ClassGroupMoveCard() {
  const [report, setReport] = useState<(ReachReport & { ok: boolean; error?: string; studentIds?: string[] }) | null>(null);
  const [err, setErr] = useState("");
  const [openClass, setOpenClass] = useState<string | null>(null);
  const [dry, setDry] = useState<DryRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/comms/reach", { cache: "no-store" });
      const body = (await res.json()) as ReachReport & { ok: boolean; error?: string; studentIds?: string[] };
      if (!res.ok || !body.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setReport(body);
      setErr("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  // The families this card counts — this session's children — not the
  // "parents" audience, which also reaches stale earlier-year rows.
  const audience = useMemo(() => ({ kind: "students" as const, studentIds: report?.studentIds ?? [] }), [report]);
  const variables = useMemo(
    () => ({ schoolName: TENANT.name, noticeTitle: MOVE_NOTICE_TITLE.slice(0, 60), noticeBody: MOVE_NOTICE_BODY }),
    [],
  );

  async function send(dryRun: boolean) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/wa/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audience, templateFamilyKey: "comms_notice", variables, dryRun, confirmCount: dryRun ? undefined : dry?.recipientCount }),
      });
      const body = (await res.json()) as DryRun & { error?: string; sent?: number; failed?: number };
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      if (!dryRun && !body.sent && body.error) throw new Error(body.error);
      if (dryRun) setDry(body);
      else {
        setDry(null);
        setMsg({ ok: true, text: `Sent to ${body.sent ?? body.recipientCount} families${body.failed ? ` · ${body.failed} failed` : ""}.` });
      }
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Not sent" });
    } finally {
      setBusy(false);
    }
  }

  const unreachableFor = (key: string) => (report?.unreachable ?? []).filter((f) => f.classKeys.includes(key));
  const t = report?.totals;
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4" aria-label="Moving off class WhatsApp groups">
      <h3 className="text-sm font-semibold text-[var(--brand-deep)]">Moving off personal class WhatsApp groups</h3>
      <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-[11px] text-[var(--muted)]">
        <li>
          Teachers post homework and notices in the ERP (Homework, or Class WA here). Each family gets it privately from the school number and
          in the app. For now they can also paste it into the old group — every post has <strong>Copy for class group</strong>.
        </li>
        <li>Send the notice below once, so families save the school number and install the app.</li>
        <li>Call the families nobody can reach (list below). Then set each old group to “Only admins can send messages” and retire it.</li>
      </ol>

      {err ? <p className="mt-2 text-xs text-[var(--danger)]">{err}</p> : null}
      {t ? (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { n: t.families, label: "Families", tone: "text-[var(--brand-deep)]" },
              { n: t.app, label: "Have the parent app (free)", tone: "text-[var(--success)]" },
              { n: t.whatsappOnly, label: "WhatsApp from school only", tone: "text-[var(--brand-deep)]" },
              { n: t.unreachable, label: "Cannot be reached", tone: t.unreachable ? "text-[var(--danger)]" : "text-[var(--success)]" },
            ].map((x) => (
              <div key={x.label} className="rounded-lg border border-[var(--border)] px-3 py-2">
                <p className={`text-lg font-bold ${x.tone}`}>{x.n}</p>
                <p className="text-[11px] text-[var(--muted)]">{x.label}</p>
              </div>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-[var(--muted)]">
            WhatsApp from the school number costs a little per message (Meta&apos;s pricing); the app is free — the more families on the app, the
            cheaper daily homework is. A number Meta has not checked yet counts as reachable.
          </p>
          <ErpTableShell className="mt-3 overflow-x-auto" exportAs="class_reach" exportTitle="Reach per class">
            <ErpTable className="text-xs" minWidth="min-w-[480px]">
              <ErpTableHead>
                <tr>
                  <th className="px-3 py-2">Class</th>
                  <th className="px-3 py-2 text-right">Families</th>
                  <th className="px-3 py-2 text-right">App</th>
                  <th className="px-3 py-2 text-right">WhatsApp only</th>
                  <th className="px-3 py-2 text-right">Not reachable</th>
                  <th className="w-10 px-2 py-2" aria-label="Actions" />
                </tr>
              </ErpTableHead>
              <ErpTableBody>
                {report!.classes.map((c) => (
                  <tr key={c.key}>
                    <td className="px-3 py-1.5 font-semibold text-[var(--brand-deep)]">{c.label}</td>
                    <td className="px-3 py-1.5 text-right">{c.families}</td>
                    <td className="px-3 py-1.5 text-right">{c.app}</td>
                    <td className="px-3 py-1.5 text-right">{c.whatsappOnly}</td>
                    <td className="px-3 py-1.5 text-right">
                      {c.unreachable ? (
                        <button type="button" className="font-semibold text-[var(--danger)] underline" onClick={() => setOpenClass(openClass === c.key ? null : c.key)}>
                          {c.unreachable} — who?
                        </button>
                      ) : (
                        "0"
                      )}
                    </td>
                    <td className="px-2 py-1 text-right">
                      <RowActionMenu
                        row={c}
                        label="Class actions"
                        actions={[
                          {
                            id: "who",
                            label: openClass === c.key ? "Hide families to call" : "Show families to call",
                            hidden: (x) => !x.unreachable,
                            onSelect: (x) => setOpenClass(openClass === x.key ? null : x.key),
                          },
                        ]}
                      />
                    </td>
                  </tr>
                ))}
              </ErpTableBody>
            </ErpTable>
          </ErpTableShell>
          {openClass ? (
            <ul className="mt-2 space-y-1 rounded-lg bg-[var(--surface-sunken)] p-2 text-xs">
              {unreachableFor(openClass).map((f) => (
                <li key={f.householdId}>
                  <strong>{f.children.join(", ")}</strong>
                  {f.guardianName ? ` · ${f.guardianName}` : ""} ·{" "}
                  {f.numbers.length ? `numbers in the ERP: ${f.numbers.join(", ")} (not on WhatsApp — call)` : "no phone number in the ERP — ask at pickup"}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : !err ? (
        <p className="mt-2 text-xs text-[var(--muted)]">Loading…</p>
      ) : null}

      <div className="mt-4 rounded-lg border border-[var(--border)] p-3">
        <p className="text-xs font-semibold text-[var(--brand-deep)]">Notice to every family (from the school number)</p>
        <p className="mt-1 text-[11px] font-semibold">{MOVE_NOTICE_TITLE}</p>
        <p className="mt-1 text-[11px] text-[var(--muted)]">{MOVE_NOTICE_BODY}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--brand-deep)] disabled:opacity-50" disabled={busy || !report?.studentIds?.length} onClick={() => void send(true)}>
            {busy && !dry ? "Checking…" : "Check who gets it"}
          </button>
          {dry ? (
            <button
              type="button"
              className="btn-accent rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
              disabled={busy || !dry.recipientCount}
              onClick={() => {
                if (window.confirm(`Send this notice to ${dry.recipientCount} families on WhatsApp now?`)) void send(false);
              }}
            >
              {busy ? "Sending…" : `Send to ${dry.recipientCount} families`}
            </button>
          ) : null}
        </div>
        {dry ? (
          <p className="mt-1 text-[11px] text-[var(--muted)]">
            {dry.recipientCount} families will get it
            {dry.skippedNotOnWhatsApp ? ` · ${dry.skippedNotOnWhatsApp} skipped (number not on WhatsApp)` : ""}
            {dry.skippedNoNumber ? ` · ${dry.skippedNoNumber} without a number` : ""}
            {dry.skippedOptOut ? ` · ${dry.skippedOptOut} opted out` : ""}
            {dry.skippedNoTemplate ? ` · ${dry.skippedNoTemplate} need a template in their language` : ""}.
          </p>
        ) : null}
        {msg ? <p className={`mt-1 text-xs ${msg.ok ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>{msg.text}</p> : null}
      </div>
    </section>
  );
}
