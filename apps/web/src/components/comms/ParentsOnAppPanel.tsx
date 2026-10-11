"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { btnOutline, field } from "@/components/ui/erp-ui";
import { ErpTable, ErpTableBody, ErpTableHead, ErpTableShell } from "@/components/ui/erp-roster";
import { BulkActionBar, ErpControlBar, ExportMenu, RowActionMenu, RowCheckbox, useRowSelection } from "@/components/ui/erp-grid";
import { APP_INVITE_BODY, APP_INVITE_TITLE } from "@/lib/parentAppInvite";
import {
  ADOPTION_STATUS_LABEL,
  INVITE_COOLDOWN_DAYS,
  invitedRecently,
  lastSeenLabel,
  type AdoptionReport,
  type AdoptionStatus,
  type FamilyRow,
} from "@/lib/parentsOnApp";
import { TENANT } from "@/lib/types";

const istDate = (iso: string) =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" }) : "";

/**
 * Comms → Parents on app: parent app adoption by class and section (the old
 * ERP's "Parent Mobile Usage Report"). Metric cards, one row per class and
 * section, and the household list — filter to "Never signed in" to see who
 * to chase, with their real phone numbers. "Send app invite" goes through
 * the school's approved School notice template (Hindi unless the family
 * chose English) via POST /api/comms/parents-on-app/invite: a dry run shows
 * who gets it, then the office presses Send. A family invited in the last
 * INVITE_COOLDOWN_DAYS days is not invited again.
 */

type Data = AdoptionReport & { asOf: string; presenceAvailable: boolean; invitesAvailable: boolean };
type StatusFilter = "all" | AdoptionStatus | "push_off";
type DryRun = {
  recipientCount: number;
  sample?: string[];
  skippedNotOnWhatsApp?: number;
  skippedNoNumber?: number;
  skippedOptOut?: number;
  skippedSignedIn?: number;
  skippedRecentlyInvited?: number;
  skippedNoPhone?: number;
  skippedNotOnRoll?: number;
};

const istDateTime = (iso: string) =>
  iso
    ? new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })
    : "";

const STATUS_TONE: Record<AdoptionStatus, string> = {
  active7: "text-[var(--success)]",
  active30: "text-[var(--tone-teal)]",
  dormant: "text-[var(--warning)]",
  never: "text-[var(--danger)]",
};

function matches(r: FamilyRow, q: string): boolean {
  if (!q) return true;
  const hay = `${r.guardianName} ${r.contacts.map((c) => c.mobile10).join(" ")} ${r.children.map((c) => `${c.name} ${c.className}`).join(" ")}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

function statusMatches(r: FamilyRow, f: StatusFilter): boolean {
  if (f === "all") return true;
  if (f === "push_off") return r.signedIn && !r.pushEnabled;
  return r.status === f;
}

export function ParentsOnAppPanel() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [classKey, setClassKey] = useState("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [toast, setToast] = useState("");
  /** Families the invite is being prepared for (the preview is open). */
  const [inviteFor, setInviteFor] = useState<FamilyRow[] | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/comms/parents-on-app", { cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as Data & { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error || `Could not load (${res.status})`);
      setData(json);
    } catch (e) {
      // Keep the last good report on screen; say this refresh failed.
      setError(e instanceof Error ? e.message : "Could not load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const now = useMemo(() => new Date(data?.asOf || Date.now()), [data]);
  const rows = useMemo(
    () =>
      (data?.families ?? []).filter(
        (r) => (classKey === "all" || r.classKeys.includes(classKey)) && statusMatches(r, status) && matches(r, q),
      ),
    [data, classKey, status, q],
  );
  const allKeys = useMemo(() => (data?.families ?? []).map((r) => r.householdId), [data]);
  const visibleKeys = useMemo(() => rows.map((r) => r.householdId), [rows]);
  const selection = useRowSelection(allKeys);
  const byId = useMemo(() => new Map((data?.families ?? []).map((r) => [r.householdId, r])), [data]);

  const s = data?.summary;
  const pct = (n: number) => (s && s.families ? `${Math.round((n / s.families) * 100)}% of families` : "");
  const classLabel = (key: string) => data?.classes.find((c) => c.key === key)?.label ?? "";

  const exportColumns = [
    { key: "parent", header: "Parent" },
    { key: "phone", header: "Phone" },
    { key: "children", header: "Children (class)", width: 2 },
    { key: "status", header: "Status" },
    { key: "lastSeen", header: "Last seen (IST)" },
    { key: "push", header: "Notifications" },
    { key: "version", header: "App version" },
    { key: "firstSignIn", header: "First sign-in (IST)" },
    { key: "invited", header: "Last app invite (IST)" },
  ];
  const exportRows = () =>
    rows.map((r) => ({
      parent: r.guardianName,
      phone: r.contacts.map((c) => c.mobile10).join(", "),
      children: r.children.map((c) => `${c.name} (${c.className})`).join(", "),
      status: ADOPTION_STATUS_LABEL[r.status],
      lastSeen: istDateTime(r.lastSeenAt),
      push: r.pushEnabled ? `On (${r.phones} phone${r.phones === 1 ? "" : "s"})` : r.signedIn ? "Off" : "",
      version: r.versions.join(", "),
      firstSignIn: istDateTime(r.firstSignInAt),
      invited: istDateTime(r.invitedAt),
    }));
  const filterNote = [
    classKey !== "all" ? classLabel(classKey) : "",
    status !== "all" ? (status === "push_off" ? "Notifications off" : ADOPTION_STATUS_LABEL[status]) : "",
    q ? `“${q}”` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setToast(`${what} copied.`);
    } catch {
      setToast(`Could not copy — ${text}`);
    }
  };

  return (
    <section className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4" aria-label="Parents on app">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-[var(--brand-deep)]">Parent app usage</h3>
          <p className="text-[11px] text-[var(--muted)]">
            Families with a child on roll this session, each counted once. &ldquo;Last seen&rdquo; is the latest sign-in, launch or app open
            from any of the family&apos;s phones (India time). Families whose children are all inactive are left out.
          </p>
        </div>
        <button type="button" className={btnOutline} onClick={() => void load()} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>
      {error ? <p className="text-xs text-[var(--danger)]">{data ? `Refresh failed — showing the last report. ${error}` : error}</p> : null}
      {data && !data.presenceAvailable ? (
        <p className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[11px] text-[var(--muted)]">
          App-open records could not be read, so &ldquo;last seen&rdquo; here comes only from sign-ins and notification check-ins. Families who
          turned notifications off may look older than they are.
        </p>
      ) : null}

      {data && !data.invitesAvailable ? (
        <p className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[11px] text-[var(--danger)]">
          Could not read who was already invited, so &ldquo;Invited&rdquo; dates are missing and sending invites is switched off until it loads.
        </p>
      ) : null}

      {s ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { label: "Families", value: String(s.families), hint: "child on roll" },
            { label: "Signed in (ever)", value: String(s.signedIn), hint: pct(s.signedIn) },
            { label: "Active 7 days", value: String(s.active7), hint: pct(s.active7) },
            { label: "Active 30 days", value: String(s.active30), hint: pct(s.active30) },
            { label: "Notifications on", value: String(s.pushEnabled), hint: `${s.phones} phone${s.phones === 1 ? "" : "s"}` },
            {
              label: "Never signed in",
              value: String(s.never),
              hint: s.neverNoContact ? `${s.neverNoContact} with no phone on record` : "to invite",
              onClick: () => {
                setStatus("never");
                setClassKey("all");
              },
            },
          ].map((k) => (
            <button
              key={k.label}
              type="button"
              disabled={!k.onClick}
              onClick={k.onClick}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-left disabled:cursor-default enabled:hover:border-[var(--brand-deep)]"
            >
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">{k.label}</p>
              <p className="text-lg font-bold text-[var(--brand-deep)]">{k.value}</p>
              <p className="text-[10px] text-[var(--muted)]">{k.hint}</p>
            </button>
          ))}
        </div>
      ) : null}

      {data ? (
        <ErpTableShell className="overflow-x-auto" exportAs="parent_app_usage_by_class" exportTitle="Parent app usage by class">
          <ErpTable className="text-xs" minWidth="min-w-[640px]">
            <ErpTableHead>
              <tr>
                <th className="px-3 py-2">Class · section</th>
                <th className="px-3 py-2 text-right">Families</th>
                <th className="px-3 py-2 text-right">Signed in</th>
                <th className="px-3 py-2 text-right">Active 7d</th>
                <th className="px-3 py-2 text-right">Active 30d</th>
                <th className="px-3 py-2 text-right">Notifications</th>
                <th className="px-3 py-2 text-right">Never</th>
                <th className="w-10 px-2 py-2" aria-label="Actions" />
              </tr>
            </ErpTableHead>
            <ErpTableBody>
              {data.classes.map((c) => (
                <tr key={c.key} className={classKey === c.key ? "bg-[var(--surface)]" : undefined}>
                  <td className="px-3 py-1.5 font-semibold text-[var(--brand-deep)]">{c.label}</td>
                  <td className="px-3 py-1.5 text-right">{c.families}</td>
                  <td className="px-3 py-1.5 text-right">
                    {c.signedIn}
                    <span className="ml-1 text-[10px] text-[var(--muted)]">{c.families ? `${Math.round((c.signedIn / c.families) * 100)}%` : ""}</span>
                  </td>
                  <td className="px-3 py-1.5 text-right">{c.active7}</td>
                  <td className="px-3 py-1.5 text-right">{c.active30}</td>
                  <td className="px-3 py-1.5 text-right">{c.pushEnabled}</td>
                  <td className="px-3 py-1.5 text-right">
                    {c.never ? (
                      <button
                        type="button"
                        className="font-semibold text-[var(--danger)] underline"
                        onClick={() => {
                          setClassKey(c.key);
                          setStatus("never");
                        }}
                      >
                        {c.never}
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
                          id: "never",
                          label: "Show families never signed in",
                          hidden: (x) => !x.never,
                          onSelect: (x) => {
                            setClassKey(x.key);
                            setStatus("never");
                          },
                        },
                        {
                          id: "all",
                          label: "Show all families of this class",
                          onSelect: (x) => {
                            setClassKey(x.key);
                            setStatus("all");
                          },
                        },
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </ErpTableBody>
          </ErpTable>
        </ErpTableShell>
      ) : null}

      {data ? (
        <>
          <ErpControlBar
            search={{ value: q, onChange: setQ, placeholder: "Search parent, child or phone…", label: "Search families" }}
            filters={
              <>
                <select className={`${field} w-auto`} value={classKey} onChange={(e) => setClassKey(e.target.value)} aria-label="Class and section">
                  <option value="all">All classes</option>
                  {data.classes.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <select className={`${field} w-auto`} value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} aria-label="App status">
                  <option value="all">Every family</option>
                  <option value="never">Never signed in</option>
                  <option value="dormant">Not opened 30+ days</option>
                  <option value="active30">Active this month (not this week)</option>
                  <option value="active7">Active this week</option>
                  <option value="push_off">Signed in, notifications off</option>
                </select>
              </>
            }
            summary={
              <span className="text-[11px] text-[var(--muted)]">
                {rows.length} of {data.families.length} families
              </span>
            }
            exportMenu={
              <ExportMenu
                title="Parent app usage"
                subtitle={`${TENANT.name} · as of ${istDateTime(data.asOf)}`}
                filterNote={filterNote}
                columns={exportColumns}
                rows={exportRows}
                fileBaseName="parent_app_usage"
              />
            }
          />

          <ErpTableShell className="overflow-x-auto">
            <ErpTable className="text-xs" minWidth="min-w-[860px]">
              <ErpTableHead>
                <tr>
                  <th className="w-8 px-2 py-2">
                    <RowCheckbox
                      checked={selection.allSelected(visibleKeys)}
                      indeterminate={selection.someSelected(visibleKeys)}
                      onChange={() => selection.toggleAll(visibleKeys)}
                      label="Select every family shown"
                    />
                  </th>
                  <th className="px-3 py-2">Parent · phone</th>
                  <th className="px-3 py-2">Children</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Last seen</th>
                  <th className="px-3 py-2">Notifications</th>
                  <th className="px-3 py-2">App</th>
                  <th className="w-10 px-2 py-2" aria-label="Actions" />
                </tr>
              </ErpTableHead>
              <ErpTableBody>
                {rows.map((r) => (
                  <tr key={r.householdId}>
                    <td className="px-2 py-1.5">
                      <RowCheckbox
                        checked={selection.isSelected(r.householdId)}
                        onChange={() => selection.toggle(r.householdId)}
                        label={`Select ${r.guardianName || "family"}`}
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <p className="font-semibold text-[var(--ink)]">{r.guardianName || "—"}</p>
                      <p className="text-[11px] text-[var(--muted)]">
                        {r.contacts.length ? r.contacts.map((c) => c.mobile10).join(", ") : "no phone on record"}
                      </p>
                    </td>
                    <td className="px-3 py-1.5 text-[var(--ink)]">
                      {r.children.map((c) => `${c.name}${c.className ? ` (${c.className})` : ""}`).join(", ")}
                    </td>
                    <td className="px-3 py-1.5">
                      <p className={`font-semibold ${STATUS_TONE[r.status]}`}>{ADOPTION_STATUS_LABEL[r.status]}</p>
                      {r.invitedAt ? (
                        <p className="text-[10px] text-[var(--muted)]" title={istDateTime(r.invitedAt)}>
                          Invited {istDate(r.invitedAt)}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-3 py-1.5" title={istDateTime(r.lastSeenAt)}>
                      {r.signedIn ? lastSeenLabel(r.lastSeenAt, now) : "—"}
                    </td>
                    <td className="px-3 py-1.5">
                      {r.pushEnabled ? `On · ${r.phones} phone${r.phones === 1 ? "" : "s"}` : r.signedIn ? "Off" : "—"}
                    </td>
                    <td className="px-3 py-1.5 text-[var(--muted)]">{r.versions.length ? r.versions.join(", ") : "—"}</td>
                    <td className="px-2 py-1 text-right">
                      <RowActionMenu
                        row={r}
                        label="Family actions"
                        actions={[
                          {
                            id: "invite",
                            label: "Send app invite…",
                            hidden: (x) => x.signedIn,
                            disabled: (x) => !x.contacts.length || invitedRecently(x.invitedAt, now) || !data.invitesAvailable,
                            onSelect: (x) => setInviteFor([x]),
                          },
                          {
                            id: "copy",
                            label: "Copy phone number",
                            hidden: (x) => !x.contacts.length,
                            onSelect: (x) => void copy(x.contacts[0]!.mobile10, "Phone number"),
                          },
                          {
                            id: "call",
                            label: "Call",
                            hidden: (x) => !x.contacts.length,
                            onSelect: (x) => {
                              window.location.href = `tel:+91${x.contacts[0]!.mobile10}`;
                            },
                          },
                        ]}
                      />
                    </td>
                  </tr>
                ))}
                {!rows.length ? (
                  <tr>
                    <td colSpan={8} className="px-3 py-6 text-center text-[12px] text-[var(--muted)]">
                      No family matches these filters.
                    </td>
                  </tr>
                ) : null}
              </ErpTableBody>
            </ErpTable>
          </ErpTableShell>
          <p className="text-[10px] text-[var(--muted)]">
            A family with children in two classes appears under both classes in the table above; every total counts it once. Placeholder numbers
            (0000000000 and the like) are not shown as contacts.
          </p>
        </>
      ) : !error ? (
        <p className="text-xs text-[var(--muted)]">Loading…</p>
      ) : null}

      {toast ? (
        <p className="text-[11px] text-[var(--muted)]" role="status">
          {toast}
        </p>
      ) : null}

      <BulkActionBar
        selection={selection}
        noun="family"
        actions={[
          {
            id: "invite",
            label: "Send app invite",
            disabled: !data?.invitesAvailable,
            onRun: (keys) => {
              const picked = keys.map((k) => byId.get(k)).filter((r): r is FamilyRow => !!r);
              const never = picked.filter((r) => !r.signedIn && !invitedRecently(r.invitedAt, now));
              if (!never.length) {
                setToast(
                  `Every selected family has signed in already or was invited in the last ${INVITE_COOLDOWN_DAYS} days — no invite needed.`,
                );
                return;
              }
              setInviteFor(never);
            },
          },
          {
            id: "copy",
            label: "Copy phone numbers",
            onRun: (keys) => {
              const nums = keys.map((k) => byId.get(k)?.contacts[0]?.mobile10).filter(Boolean);
              void copy(nums.join("\n"), `${nums.length} phone numbers`);
            },
          },
        ]}
      />

      {inviteFor ? (
        <InviteDialog
          families={inviteFor}
          onClose={(sent) => {
            setInviteFor(null);
            if (sent) {
              setToast(sent);
              selection.clear();
              void load(); // show the new "Invited" dates
            }
          }}
        />
      ) : null}
    </section>
  );
}

/**
 * Preview first, then a dry run against the real audience, then Send — the
 * count the office approved is echoed back (confirmCount) so a changed
 * audience is refused rather than sent.
 */
function InviteDialog({ families, onClose }: { families: FamilyRow[]; onClose: (sentMessage?: string) => void }) {
  const [dry, setDry] = useState<DryRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const householdIds = useMemo(() => families.map((f) => f.householdId), [families]);
  const noPhone = families.filter((f) => !f.contacts.length).length;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function post(dryRun: boolean) {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/comms/parents-on-app/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ householdIds, dryRun, confirmCount: dryRun ? undefined : dry?.recipientCount }),
      });
      const body = (await res.json().catch(() => ({}))) as DryRun & { error?: string; sent?: number; failed?: number };
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      if (dryRun) {
        setDry(body);
      } else {
        // Whatever happened, the families reached are recorded — reload the
        // report rather than leaving a Send button that would re-aim at them.
        if (!body.sent && body.error) throw new Error(body.error);
        onClose(`App invite sent to ${body.sent ?? 0} famil${body.sent === 1 ? "y" : "ies"}${body.failed ? ` · ${body.failed} failed` : ""}.`);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Not sent");
      if (!dryRun) setDry(null); // a fresh check is needed; families already reached drop out of it
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center" role="dialog" aria-modal="true" aria-label="Send app invite">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-[var(--shadow-2,0_16px_40px_rgba(0,0,0,0.22))]">
        <div className="flex items-start justify-between gap-2">
          <h4 className="text-sm font-semibold text-[var(--brand-deep)]">
            App invite to {families.length} famil{families.length === 1 ? "y" : "ies"}
          </h4>
          <button type="button" className="text-xs text-[var(--muted)] underline" onClick={() => onClose()} disabled={busy}>
            Close
          </button>
        </div>
        <p className="mt-1 text-[11px] text-[var(--muted)]">
          Sent on WhatsApp from the school number in the approved &ldquo;School notice&rdquo; template — Hindi for every family that has not chosen
          English. Only families who have never signed in and were not invited in the last {INVITE_COOLDOWN_DAYS} days are included, at
          most once a day each.
          {noPhone ? ` ${noPhone} of them have no phone on record and will be skipped.` : ""}
        </p>
        <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
          <p className="text-[11px] font-semibold text-[var(--ink)]">{APP_INVITE_TITLE}</p>
          <p className="mt-1 whitespace-pre-wrap text-[11px] text-[var(--ink)]">{APP_INVITE_BODY}</p>
        </div>
        <p className="mt-2 text-[11px] text-[var(--muted)]">
          {families
            .slice(0, 6)
            .map((f) => f.guardianName || f.children[0]?.name || "Family")
            .join(", ")}
          {families.length > 6 ? ` and ${families.length - 6} more` : ""}
        </p>

        {dry ? (
          <p className="mt-2 text-[11px] text-[var(--ink)]">
            <strong>{dry.recipientCount}</strong> famil{dry.recipientCount === 1 ? "y" : "ies"} will get it
            {dry.skippedNotOnWhatsApp ? ` · ${dry.skippedNotOnWhatsApp} skipped (number not on WhatsApp)` : ""}
            {dry.skippedNoNumber ? ` · ${dry.skippedNoNumber} without a number` : ""}
            {dry.skippedOptOut ? ` · ${dry.skippedOptOut} opted out` : ""}
            {dry.skippedRecentlyInvited ? ` · ${dry.skippedRecentlyInvited} invited in the last ${INVITE_COOLDOWN_DAYS} days` : ""}
            {dry.skippedSignedIn ? ` · ${dry.skippedSignedIn} signed in meanwhile` : ""}
            {dry.skippedNoPhone ? ` · ${dry.skippedNoPhone} with no phone` : ""}. WhatsApp from the school number is charged per message.
          </p>
        ) : null}
        {err ? <p className="mt-2 text-xs text-[var(--danger)]">{err}</p> : null}

        <div className="mt-3 flex flex-wrap justify-end gap-2">
          {!dry ? (
            <button type="button" className={btnOutline} disabled={busy || !householdIds.length} onClick={() => void post(true)}>
              {busy ? "Checking…" : "Check who gets it"}
            </button>
          ) : (
            <button
              type="button"
              className="btn-accent rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
              disabled={busy || !dry.recipientCount}
              onClick={() => {
                if (window.confirm(`Send the app invite to ${dry.recipientCount} families on WhatsApp now?`)) void post(false);
              }}
            >
              {busy ? "Sending…" : `Send to ${dry.recipientCount} families`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
