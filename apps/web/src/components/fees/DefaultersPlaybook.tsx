"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { withHydrationSlot } from "@/lib/deskHydrateGuard";
import {
  buildPlaybook,
  composeEscalationNotice,
  composeWhatsAppDefaulterReminder,
  formatInrFromPaise,
  listLiveDefaulters,
  stageLabel,
  type LiveDefaulter,
} from "@/lib/playbook";
import {
  buildPaymentSharePayload,
  buildPaymentShareUrl,
  composeWhatsAppPaymentLinkMessage,
  createPaymentLink,
  whatsAppPaymentLinkUrl,
} from "@/lib/payments";
import { loadMasters, type MastersState } from "@/lib/masters";
import {
  householdOf,
  householdWhatsApp,
  isValidMobile,
  loadSis,
  type SisState,
} from "@/lib/sis";
import { TENANT, type OverdueStage } from "@/lib/types";
import { useDemoSession } from "@/components/shell/SessionContext";
import { StudentNameLabel } from "@/components/students/StudentAvatar";
import { FilterExportButtons } from "@/components/reports/FilterExportButtons";
import { describeFilters } from "@/lib/reportExport";
import { InstallmentPlanDialog } from "@/components/fees/InstallmentPlanDialog";
import { PrincipalHoldOverrideDialog } from "@/components/fees/PrincipalHoldOverrideDialog";
import {
  checkHold,
  listPolicyHoldRows,
  type HoldCheck,
} from "@/lib/holds";
import {
  composeParentMeetingInvite,
  ensureFeeRecoveryTasksHydrated,
  listOpenParentMeetings,
  scheduleParentMeeting,
  type FeeRecoveryMeeting,
} from "@/lib/feeRecoveryTasks";
import { openWaMe } from "@/lib/waMe";
import type { HoldCode } from "@/lib/types";
import { paymentLikelihood } from "@/lib/collectionsAi";
import { useModuleStateHydration } from "@/lib/useModuleStateHydration";

const STAGE_FILTERS: { value: "" | OverdueStage; label: string }[] = [
  { value: "", label: "All stages" },
  { value: "S1", label: "S1 Due" },
  { value: "S2", label: "S2 Overdue" },
  { value: "S3", label: "S3 Serious" },
  { value: "S4", label: "S4 Hard" },
  { value: "S0", label: "S0 Upcoming" },
];

export function DefaultersPlaybook() {
  const session = useDemoSession();
  const ay = session.academicYearCode;
  const [sis, setSis] = useState<SisState | null>(null);
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [rows, setRows] = useState<LiveDefaulter[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [classId, setClassId] = useState("");
  const [stageFilter, setStageFilter] = useState<"" | OverdueStage>("");
  const [includeUpcoming, setIncludeUpcoming] = useState(false);
  const [rosterMode, setRosterMode] = useState<"active" | "inactive">(
    "active",
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  // Re-read when the server copy of fee holds lands (login/refresh hydration).
  useModuleStateHydration("fee_holds", () => setTick((t) => t + 1));
  const [planOpen, setPlanOpen] = useState(false);
  const [holdDialog, setHoldDialog] = useState(false);
  const [holdTarget, setHoldTarget] = useState<{
    code: HoldCode;
    mode: "unhold" | "rehold";
    block: Extract<HoldCheck, { allowed: false }> | null;
  } | null>(null);
  const [meetings, setMeetings] = useState<FeeRecoveryMeeting[]>([]);
  const [aiDraft, setAiDraft] = useState<
    { whatsappMessage: string; callScript: string } | null
  >(null);
  const [aiDraftLoading, setAiDraftLoading] = useState(false);
  const [aiDraftError, setAiDraftError] = useState<string | null>(null);

  function refresh() {
    const s = loadSis();
    const m = loadMasters();
    const list = listLiveDefaulters({
      sis: s,
      masters: m,
      academicYearCode: ay,
      includeUpcoming,
      inactiveOnly: rosterMode === "inactive",
    });
    setSis(s);
    setMasters(m);
    setRows(list);
    setMeetings(listOpenParentMeetings());
    setTick((t) => t + 1);
    setSelectedId((prev) => {
      if (prev && list.some((r) => r.studentId === prev)) return prev;
      return list[0]?.studentId ?? null;
    });
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includeUpcoming, rosterMode, ay]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    void (async () => {
      await withHydrationSlot(() => ensureFeeRecoveryTasksHydrated());
      setMeetings(listOpenParentMeetings());
    })();
  }, []);

  const classOptions = useMemo(() => {
    if (!masters) return [];
    return masters.classes.filter((c) => c.isActive);
  }, [masters]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (stageFilter && r.stage !== stageFilter) return false;
      if (classId && r.student.classId !== classId) return false;
      if (!q) return true;
      return (
        r.fullName.toLowerCase().includes(q) ||
        r.admissionNo.toLowerCase().includes(q) ||
        r.classLabel.toLowerCase().includes(q)
      );
    });
  }, [rows, query, classId, stageFilter]);

  const selected =
    filtered.find((r) => r.studentId === selectedId) ??
    filtered[0] ??
    null;

  useEffect(() => {
    if (selected && selected.studentId !== selectedId) {
      setSelectedId(selected.studentId);
    }
  }, [filtered, selected, selectedId]);

  const playbook = useMemo(() => {
    if (!selected) return null;
    return buildPlaybook({
      overdueDays: selected.overdueDays,
      amountPaise: selected.overdueAmountPaise,
      studentName: selected.fullName,
    });
  }, [selected]);

  const likelihood = useMemo(() => {
    if (!selected) return null;
    return paymentLikelihood({
      overdueDays: selected.overdueDays,
      overdueAmountPaise: selected.overdueAmountPaise,
      planCode: selected.planCode,
    });
  }, [selected]);

  useEffect(() => {
    setAiDraft(null);
    setAiDraftError(null);
  }, [selectedId]);

  async function draftWithAi(row: LiveDefaulter) {
    setAiDraftLoading(true);
    setAiDraftError(null);
    setAiDraft(null);
    try {
      const res = await fetch("/api/ai/collections-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentName: row.fullName,
          classLabel: row.classLabel,
          amountLabel: formatInrFromPaise(row.overdueAmountPaise),
          overdueDaysLabel:
            row.overdueDays < 0
              ? "upcoming"
              : row.overdueDays === 0
                ? "due today"
                : `${row.overdueDays} day(s) overdue`,
          stageLabel: row.stageLabel,
          // Household's preferred language (Students → Family); "" = not asked → English.
          language: sis ? householdOf(sis, row.householdId)?.preferredLanguage ?? "" : "",
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        whatsappMessage?: string;
        callScript?: string;
        language?: string;
        warnings?: string[];
      };
      if (!json.ok || !json.whatsappMessage || !json.callScript) {
        setAiDraftError(json.error || "Draft failed");
        return;
      }
      setAiDraft({
        whatsappMessage: json.whatsappMessage,
        callScript: json.callScript,
      });
    } catch (e) {
      setAiDraftError(e instanceof Error ? e.message : "Draft failed");
    } finally {
      setAiDraftLoading(false);
    }
  }

  const policyHolds = useMemo(() => {
    if (!selected || !playbook) return [];
    return listPolicyHoldRows(selected.studentId, playbook.holds);
  }, [selected, playbook, tick]);

  const totals = useMemo(() => {
    const amount = filtered.reduce((s, r) => s + r.overdueAmountPaise, 0);
    const byStage: Partial<Record<OverdueStage, number>> = {};
    for (const r of filtered) {
      byStage[r.stage] = (byStage[r.stage] ?? 0) + 1;
    }
    return { count: filtered.length, amount, byStage };
  }, [filtered]);

  function flash(msg: string) {
    setNotice(msg);
    setError(null);
    window.setTimeout(() => setNotice(null), 3200);
  }

  function guardianMobile(row: LiveDefaulter): string {
    if (!sis) return "";
    return householdWhatsApp(householdOf(sis, row.householdId));
  }

  function createLinkForRow(row: LiveDefaulter) {
    const dues =
      row.overdueDues.length > 0 ? row.overdueDues : row.openDues;
    return createPaymentLink({
      householdId: row.householdId,
      studentId: row.studentId,
      studentName: row.fullName,
      classLabel: row.classLabel,
      dues,
      createdBy: session.fullName,
      academicYearCode: row.academicYearCode || ay,
      note: `Defaulter ${row.stageLabel}`,
    });
  }

  function sendPayLink(row: LiveDefaulter) {
    const created = createLinkForRow(row);
    if (!created.ok) {
      setError(created.error);
      return;
    }
    const payload = buildPaymentSharePayload(
      created.link,
      TENANT.nameDisplay,
    );
    const url = buildPaymentShareUrl(payload);
    const mobile = guardianMobile(row);
    if (mobile && isValidMobile(mobile)) {
      const msg = composeWhatsAppPaymentLinkMessage(
        created.link,
        url,
        TENANT.nameDisplay,
      );
      window.open(whatsAppPaymentLinkUrl(mobile, msg), "_blank", "noopener");
      flash(`UPI link ${created.link.code} — WhatsApp opened`);
    } else {
      void navigator.clipboard.writeText(url).then(
        () =>
          flash(
            `UPI link ${created.link.code} copied — set WhatsApp on household`,
          ),
        () => flash(url),
      );
    }
    refresh();
  }

  function sendReminder(row: LiveDefaulter, withLink: boolean) {
    const mobile = guardianMobile(row);
    let payUrl = "";
    if (withLink) {
      const created = createLinkForRow(row);
      if (!created.ok) {
        setError(created.error);
        return;
      }
      payUrl = buildPaymentShareUrl(
        buildPaymentSharePayload(created.link, TENANT.nameDisplay),
      );
    }
    const msg = composeWhatsAppDefaulterReminder({
      schoolName: TENANT.nameDisplay,
      studentName: row.fullName,
      classLabel: row.classLabel,
      amountPaise: row.overdueAmountPaise,
      overdueDays: row.overdueDays,
      stageLabel: row.stageLabel,
      payUrl: payUrl || undefined,
    });
    if (mobile && isValidMobile(mobile)) {
      window.open(whatsAppPaymentLinkUrl(mobile, msg), "_blank", "noopener");
      flash(`Reminder sent via WhatsApp (${mobile})`);
    } else {
      void navigator.clipboard.writeText(msg).then(
        () => flash("Reminder copied — no WhatsApp on household"),
        () => setError("Could not copy reminder"),
      );
    }
    if (withLink) refresh();
  }

  function runReminderCampaign(withLink: boolean) {
    const targets = filtered.filter((r) => selectedIds.has(r.studentId));
    const list = targets.length > 0 ? targets : filtered.slice(0, 15);
    if (list.length === 0) {
      setError("No defaulters to remind");
      return;
    }
    const ok = window.confirm(
      `Open WhatsApp for ${list.length} student(s)${withLink ? " with pay links" : ""}? (browsers may block multiple tabs)`,
    );
    if (!ok) return;
    let sent = 0;
    for (const row of list) {
      sendReminder(row, withLink);
      sent += 1;
    }
    flash(`Reminder campaign · ${sent} message(s)`);
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function onAction(actionId: string, row: LiveDefaulter) {
    setError(null);
    if (actionId === "paylink" || actionId === "remind") {
      sendPayLink(row);
      return;
    }
    if (actionId === "whatsapp") {
      sendReminder(row, true);
      return;
    }
    if (actionId === "call") {
      const mobile = guardianMobile(row);
      if (mobile) {
        void navigator.clipboard.writeText(mobile).then(
          () => flash(`Guardian mobile copied: ${mobile}`),
          () => flash(mobile),
        );
      } else {
        setError("No mobile on household — update in Students");
      }
      return;
    }
    if (actionId === "escalate") {
      const text = composeEscalationNotice({
        schoolName: TENANT.nameDisplay,
        studentName: row.fullName,
        classLabel: row.classLabel,
        admissionNo: row.admissionNo,
        amountPaise: row.overdueAmountPaise,
        overdueDays: row.overdueDays,
        earliestDueOn: row.earliestDueOn,
      });
      void navigator.clipboard.writeText(text).then(
        () => flash("Escalation notice copied"),
        () => setError("Could not copy notice"),
      );
      return;
    }
    if (actionId === "plan") {
      setPlanOpen(true);
      return;
    }
    if (actionId === "meeting") {
      const mobile = guardianMobile(row);
      const result = scheduleParentMeeting({
        studentId: row.studentId,
        householdId: row.householdId,
        studentName: row.fullName,
        classLabel: row.classLabel,
        admissionNo: row.admissionNo,
        amountPaise: row.overdueAmountPaise,
        overdueDays: row.overdueDays,
        mobile,
        createdBy: session.fullName || "office",
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const invite = composeParentMeetingInvite(result.meeting);
      setMeetings(listOpenParentMeetings());
      if (mobile && isValidMobile(mobile)) {
        openWaMe(mobile, invite);
        flash(
          `Parent meeting ${result.meeting.scheduledOn} · WhatsApp opened`,
        );
      } else {
        void navigator.clipboard.writeText(invite).then(
          () =>
            flash(
              `Parent meeting ${result.meeting.scheduledOn} · invite copied (no mobile)`,
            ),
          () =>
            flash(`Parent meeting scheduled for ${result.meeting.scheduledOn}`),
        );
      }
      return;
    }
  }

  void tick;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--brand-deep)]">
            Defaulters
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Live Fee Take ledger · stage coach · WhatsApp / UPI link — attendance
            never held
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-lg border border-[rgba(32,48,80,0.15)] px-3 py-1.5 text-xs font-semibold text-[var(--brand-deep)]"
            onClick={() => refresh()}
          >
            Refresh
          </button>
          <Link
            href="/fees"
            className="btn-accent rounded-lg px-3 py-1.5 text-xs font-semibold"
          >
            Open Fee Take
          </Link>
        </div>
      </div>

      {error ? (
        <p className="mt-3 rounded-lg bg-[#dc2626]/10 px-3 py-2 text-sm text-[#dc2626]">
          {error}
        </p>
      ) : null}

      {meetings.length > 0 ? (
        <div className="mt-3 rounded-lg border border-[rgba(32,48,80,0.12)] bg-[rgba(248,248,240,0.9)] px-3 py-2 text-[12px] text-[var(--brand-deep)]">
          <span className="font-semibold">
            {meetings.length} parent meeting(s) scheduled
          </span>
          <span className="text-[var(--muted)]">
            {" "}
            · next {meetings[0]?.studentName} on {meetings[0]?.scheduledOn}
          </span>
        </div>
      ) : null}
      {notice ? (
        <p className="mt-3 rounded-lg bg-[rgba(32,48,80,0.06)] px-3 py-2 text-sm text-[var(--brand-deep)]">
          {notice}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-3 rounded-xl border border-[rgba(32,48,80,0.1)] bg-white px-4 py-3 text-sm">
        <div>
          <span className="text-[var(--muted)]">Students </span>
          <span className="font-bold text-[var(--brand-deep)]">
            {totals.count}
          </span>
        </div>
        <div>
          <span className="text-[var(--muted)]">Overdue </span>
          <span className="font-bold text-[var(--danger)]">
            {formatInrFromPaise(totals.amount)}
          </span>
        </div>
        {(["S4", "S3", "S2", "S1"] as OverdueStage[]).map((s) =>
          totals.byStage[s] ? (
            <div key={s} className="text-[var(--muted)]">
              {stageLabel(s)}{" "}
              <span className="font-semibold text-[var(--brand-deep)]">
                {totals.byStage[s]}
              </span>
            </div>
          ) : null,
        )}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,0.7fr)_minmax(0,0.7fr)_auto]">
        <label className="block text-sm">
          <span className="mb-1 block text-[11px] text-[var(--muted)]">
            Search
          </span>
          <input
            className="field !py-1.5"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name, admission no, class…"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-[11px] text-[var(--muted)]">
            Class
          </span>
          <select
            className="field !py-1.5"
            value={classId}
            onChange={(e) => setClassId(e.target.value)}
          >
            <option value="">All classes</option>
            {classOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-[11px] text-[var(--muted)]">
            Stage
          </span>
          <select
            className="field !py-1.5"
            value={stageFilter}
            onChange={(e) =>
              setStageFilter(e.target.value as "" | OverdueStage)
            }
          >
            {STAGE_FILTERS.map((s) => (
              <option key={s.label} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-end gap-2 pb-2 text-sm text-[var(--brand-deep)]">
          <input
            type="checkbox"
            checked={includeUpcoming}
            onChange={(e) => setIncludeUpcoming(e.target.checked)}
          />
          Include upcoming (not yet due)
        </label>
        <div className="flex flex-wrap items-end gap-2 pb-1 sm:col-span-4">
          <div className="flex rounded-lg border border-[rgba(32,48,80,0.15)] p-0.5 text-xs font-semibold">
            <button
              type="button"
              className={`rounded-md px-3 py-1.5 ${
                rosterMode === "active"
                  ? "bg-[var(--brand-deep)] text-white"
                  : "text-[var(--muted)]"
              }`}
              onClick={() => setRosterMode("active")}
            >
              Active dues
            </button>
            <button
              type="button"
              className={`rounded-md px-3 py-1.5 ${
                rosterMode === "inactive"
                  ? "bg-[var(--brand-deep)] text-white"
                  : "text-[var(--muted)]"
              }`}
              onClick={() => setRosterMode("inactive")}
            >
              Inactive / TC dues
            </button>
          </div>
          <button
            type="button"
            className="rounded-lg border border-[rgba(32,48,80,0.2)] px-3 py-1.5 text-xs font-semibold"
            onClick={() => runReminderCampaign(true)}
          >
            Campaign WhatsApp
            {selectedIds.size > 0 ? ` (${selectedIds.size})` : " (filtered)"}
          </button>
          <FilterExportButtons
            title={
              rosterMode === "inactive"
                ? "Inactive student dues"
                : "Fee defaulters"
            }
            subtitle={`${TENANT.shortName} · ${ay}`}
            filterNote={describeFilters([
              rosterMode === "inactive" ? "Inactive roster" : "Active roster",
              classOptions.find((c) => c.id === classId)?.name
                ? `Class ${classOptions.find((c) => c.id === classId)?.name}`
                : "",
              stageFilter ? stageLabel(stageFilter) : "",
              includeUpcoming ? "Incl. upcoming" : "",
              query.trim() ? `Search “${query.trim()}”` : "",
            ])}
            fileBaseName={
              rosterMode === "inactive"
                ? "inactive_fee_dues"
                : "fee_defaulters"
            }
            columns={[
              { key: "admissionNo", header: "Adm no", width: 1 },
              { key: "fullName", header: "Name", width: 1.5 },
              { key: "classLabel", header: "Class", width: 0.8 },
              { key: "stage", header: "Stage", width: 0.9 },
              { key: "days", header: "Days", width: 0.6, align: "right" },
              {
                key: "overdue",
                header: "Overdue",
                width: 1,
                align: "right",
              },
              { key: "mobile", header: "WhatsApp", width: 1 },
            ]}
            rows={filtered.map((d) => ({
              admissionNo: d.admissionNo,
              fullName: d.fullName,
              classLabel: d.classLabel,
              stage: stageLabel(d.stage),
              days: d.overdueDays,
              overdue: formatInrFromPaise(d.overdueAmountPaise),
              mobile: sis
                ? householdWhatsApp(householdOf(sis, d.householdId))
                : "",
            }))}
            onMessage={flash}
          />
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1.1fr]">
        <section>
          <h2 className="text-sm font-bold text-[var(--brand-deep)]">
            {rosterMode === "inactive"
              ? "Inactive / left — open dues"
              : "Live ledger"}
          </h2>
          {filtered.length === 0 ? (
            <p className="mt-3 rounded-xl border border-[rgba(32,48,80,0.12)] bg-white px-4 py-10 text-center text-sm text-[var(--muted)]">
              {rows.length === 0
                ? rosterMode === "inactive"
                  ? "No open dues on inactive students."
                  : "No overdue open dues on the Fee Take ledger. Collect or wait for due dates."
                : "No students match these filters."}
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-[rgba(32,48,80,0.1)] overflow-hidden rounded-xl border border-[rgba(32,48,80,0.12)] bg-white">
              {filtered.map((d) => {
                const active = d.studentId === selected?.studentId;
                const rowLikelihood = paymentLikelihood({
                  overdueDays: d.overdueDays,
                  overdueAmountPaise: d.overdueAmountPaise,
                  planCode: d.planCode,
                });
                return (
                  <li key={d.studentId} className="flex items-stretch">
                    <label className="flex items-center px-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(d.studentId)}
                        onChange={() => toggleSelect(d.studentId)}
                        aria-label={`Select ${d.fullName}`}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => setSelectedId(d.studentId)}
                      className={`flex min-w-0 flex-1 items-center gap-3 px-2 py-3 text-left transition ${
                        active
                          ? "bg-[rgba(32,48,80,0.06)]"
                          : "hover:bg-[rgba(32,48,80,0.03)]"
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium text-[var(--ink)]">
                          <StudentNameLabel student={d.student} />{" "}
                          <span className="font-normal text-[var(--muted)]">
                            {d.classLabel}
                          </span>
                        </div>
                        <div className="text-xs text-[var(--muted)]">
                          {d.admissionNo} · {d.stageLabel} · due{" "}
                          {d.earliestDueOn}
                          {d.planCode ? (
                            <span className="ml-1 font-semibold text-[var(--brand-mid)]">
                              · {d.planCode}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <div className="text-right text-sm">
                        <div className="font-semibold text-[var(--danger)]">
                          {formatInrFromPaise(d.overdueAmountPaise)}
                        </div>
                        <div className="text-xs text-[var(--muted)]">
                          {d.overdueDays < 0
                            ? "Upcoming"
                            : d.overdueDays === 0
                              ? "Due today"
                              : `${d.overdueDays}d overdue`}
                        </div>
                        <div
                          className={`mt-0.5 text-[10px] font-semibold ${
                            rowLikelihood.tone === "good"
                              ? "text-[#15803d]"
                              : rowLikelihood.tone === "warn"
                                ? "text-[#8a6400]"
                                : "text-[var(--danger)]"
                          }`}
                        >
                          {rowLikelihood.score}% likely
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-5 shadow-sm">
          {!selected || !playbook ? (
            <p className="text-sm text-[var(--muted)]">
              Select a student to open the fee action coach.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-base font-semibold text-[var(--brand-deep)]">
                    Fee action coach — {selected.fullName}{" "}
                    {selected.classLabel}
                  </h3>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    Overdue: {formatInrFromPaise(playbook.amountPaise)} ·{" "}
                    {playbook.overdueDays < 0
                      ? "upcoming"
                      : `${playbook.overdueDays} days`}{" "}
                    · {playbook.stageLabel}
                  </p>
                  <p className="mt-0.5 text-[11px] text-[var(--muted)]">
                    Open (incl. future):{" "}
                    {formatInrFromPaise(selected.openAmountPaise)} · WhatsApp{" "}
                    {guardianMobile(selected) || "not set"}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="rounded-md bg-[rgba(180,35,24,0.1)] px-2 py-1 text-xs font-semibold text-[var(--danger)]">
                    {playbook.stage}
                  </span>
                  {likelihood ? (
                    <span
                      className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${
                        likelihood.tone === "good"
                          ? "bg-[rgba(21,128,61,0.1)] text-[#15803d]"
                          : likelihood.tone === "warn"
                            ? "bg-[rgba(180,131,0,0.12)] text-[#8a6400]"
                            : "bg-[rgba(180,35,24,0.1)] text-[var(--danger)]"
                      }`}
                      title="Heuristic estimate from overdue days, amount, and any active recovery plan — not a guarantee"
                    >
                      {likelihood.label} · {likelihood.score}%
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="mt-4 max-h-36 overflow-y-auto rounded-lg border border-[rgba(32,48,80,0.1)]">
                <ul className="divide-y divide-[rgba(32,48,80,0.08)] text-[11px]">
                  {selected.overdueDues.slice(0, 12).map((due) => (
                    <li
                      key={due.dueKey}
                      className="flex justify-between gap-2 px-3 py-1.5"
                    >
                      <span className="min-w-0 truncate text-[var(--brand-deep)]">
                        {due.label}
                      </span>
                      <span className="shrink-0 font-semibold tabular-nums">
                        {formatInrFromPaise(due.balancePaise)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mt-5">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                  DO NOW
                </h4>
                <ul className="mt-2 space-y-2">
                  {selected.planCode &&
                  !playbook.doNow.some((a) => a.id === "plan") ? (
                    <li className="flex items-center justify-between gap-3 rounded-lg bg-[var(--surface)] px-3 py-2 text-sm">
                      <span>Manage installment plan {selected.planCode}</span>
                      <button
                        type="button"
                        className="btn-accent shrink-0 rounded-lg px-2.5 py-1 text-xs font-semibold"
                        onClick={() => setPlanOpen(true)}
                      >
                        Plan
                      </button>
                    </li>
                  ) : null}
                  {playbook.doNow.map((a) => (
                    <li
                      key={a.id}
                      className="flex items-center justify-between gap-3 rounded-lg bg-[var(--surface)] px-3 py-2 text-sm"
                    >
                      <span>
                        {a.id === "plan" && selected.planCode
                          ? `Manage installment plan ${selected.planCode}`
                          : a.label}
                      </span>
                      <button
                        type="button"
                        className="btn-accent shrink-0 rounded-lg px-2.5 py-1 text-xs font-semibold"
                        onClick={() => onAction(a.id, selected)}
                      >
                        {a.cta}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mt-5">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                    AI DRAFT
                  </h4>
                  <button
                    type="button"
                    disabled={aiDraftLoading}
                    className="rounded-lg border border-[rgba(32,48,80,0.2)] px-2.5 py-1 text-[11px] font-semibold text-[var(--brand-deep)] disabled:opacity-50"
                    onClick={() => void draftWithAi(selected)}
                  >
                    {aiDraftLoading
                      ? "Drafting…"
                      : aiDraft
                        ? "Redraft"
                        : "Draft message + call script"}
                  </button>
                </div>
                <p className="mt-1 text-[11px] text-[var(--muted)]">
                  AI-drafted — review before sending, nothing goes out automatically.
                </p>
                {aiDraftError ? (
                  <p className="mt-2 text-[11px] text-[var(--danger)]">
                    {aiDraftError}
                  </p>
                ) : null}
                {aiDraft ? (
                  <div className="mt-2 space-y-2">
                    <div className="rounded-lg bg-[var(--surface)] p-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                          WhatsApp message
                        </span>
                        <button
                          type="button"
                          className="text-[10px] font-semibold text-[var(--brand-deep)] underline"
                          onClick={() =>
                            void navigator.clipboard
                              .writeText(aiDraft.whatsappMessage)
                              .then(
                                () => flash("Draft message copied"),
                                () => setError("Could not copy"),
                              )
                          }
                        >
                          Copy
                        </button>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-[12px] text-[var(--ink)]">
                        {aiDraft.whatsappMessage}
                      </p>
                    </div>
                    <div className="rounded-lg bg-[var(--surface)] p-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                          Call script
                        </span>
                        <button
                          type="button"
                          className="text-[10px] font-semibold text-[var(--brand-deep)] underline"
                          onClick={() =>
                            void navigator.clipboard
                              .writeText(aiDraft.callScript)
                              .then(
                                () => flash("Call script copied"),
                                () => setError("Could not copy"),
                              )
                          }
                        >
                          Copy
                        </button>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-[12px] text-[var(--ink)]">
                        {aiDraft.callScript}
                      </p>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="mt-5">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                  STOP / HOLD (policy)
                </h4>
                <p className="mt-1 text-[11px] text-[var(--muted)]">
                  Unhold / Re-hold each policy with Principal PIN (
                  demo 2468)
                </p>
                <ul className="mt-2 space-y-2">
                  {policyHolds.map((h) => {
                    const isHeld = h.status === "held";
                    const isUnheld = h.status === "unheld";
                    const isClear = h.status === "clear";
                    return (
                      <li
                        key={h.code}
                        className="rounded-lg bg-[var(--surface)] px-3 py-2 text-sm"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="font-medium text-[var(--brand-deep)]">
                              {h.label}
                            </div>
                            <div className="mt-0.5 text-[11px] text-[var(--muted)]">
                              {isClear
                                ? "Not triggered at this stage"
                                : isUnheld
                                  ? `Unheld until ${h.override?.expiresOn ?? "—"}${
                                      h.override?.reason
                                        ? ` · ${h.override.reason}`
                                        : ""
                                    }`
                                  : h.mode === "auto"
                                    ? "Held · enforced"
                                    : "Held · suggest"}
                            </div>
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1">
                            <span
                              className={`text-[10px] font-bold uppercase tracking-wide ${
                                isUnheld
                                  ? "text-[#15803d]"
                                  : isHeld
                                    ? "text-[var(--danger)]"
                                    : "text-[var(--muted)]"
                              }`}
                            >
                              {isUnheld ? "Unheld" : isHeld ? "Held" : "Clear"}
                            </span>
                            {isHeld ? (
                              <button
                                type="button"
                                className="btn-accent rounded-md px-2 py-0.5 text-[11px] font-semibold"
                                onClick={() => {
                                  const check = checkHold(
                                    selected.studentId,
                                    h.code,
                                  );
                                  setHoldTarget({
                                    code: h.code,
                                    mode: "unhold",
                                    block: check.allowed ? null : check,
                                  });
                                  setHoldDialog(true);
                                }}
                              >
                                Unhold
                              </button>
                            ) : null}
                            {isUnheld ? (
                              <button
                                type="button"
                                className="rounded-md border border-[#dc2626]/35 px-2 py-0.5 text-[11px] font-semibold text-[#dc2626]"
                                onClick={() => {
                                  setHoldTarget({
                                    code: h.code,
                                    mode: "rehold",
                                    block: null,
                                  });
                                  setHoldDialog(true);
                                }}
                              >
                                Re-hold
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>

              <div className="mt-5">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                  Still ALLOWED
                </h4>
                <p className="mt-2 text-sm text-[var(--muted)]">
                  {playbook.stillAllowed.join(" · ")}
                </p>
              </div>
            </>
          )}
        </section>
      </div>

      {planOpen && selected ? (
        <InstallmentPlanDialog
          row={selected}
          createdBy={session.fullName}
          onClose={() => setPlanOpen(false)}
          onSaved={(msg) => {
            setPlanOpen(false);
            flash(msg);
            refresh();
          }}
        />
      ) : null}

      {holdDialog && selected && holdTarget ? (
        <PrincipalHoldOverrideDialog
          studentId={selected.studentId}
          studentName={selected.fullName}
          holdCode={holdTarget.code}
          mode={holdTarget.mode}
          block={holdTarget.block}
          overriddenBy={session.fullName}
          onClose={() => {
            setHoldDialog(false);
            setHoldTarget(null);
          }}
          onGranted={() => {
            const action =
              holdTarget.mode === "rehold" ? "re-held" : "unheld";
            setHoldDialog(false);
            setHoldTarget(null);
            flash(`Policy ${action} with Principal PIN`);
            refresh();
          }}
        />
      ) : null}
    </div>
  );
}
