"use client";

import { useEffect, useMemo, useState } from "react";
import { useDemoSession } from "@/components/shell/SessionContext";
import { chatSelfFromSession } from "@/lib/erpChat";
import {
  staffAllowedSections,
  type ChatSectionRef,
} from "@/lib/erpChatAccess";
import { loadMasters, type MastersState } from "@/lib/masters";
import { loadSis } from "@/lib/sis";
import {
  applyLeave,
  computeLeaveDays,
  createStaffRequestTicket,
  loadStaffHr,
  STAFF_REQUEST_TYPE_LABELS,
  type LeaveTypeCode,
  type StaffRequestType,
} from "@/lib/staffHr";
import {
  activeOutdoorDutyForStaff,
  endOutdoorDuty,
  loadStaffAttendance,
  OUTDOOR_DUTY_PURPOSE_LABELS,
  startOutdoorDuty,
  type OutdoorDutyPurpose,
  type OutdoorDutySession,
} from "@/lib/staffAttendance";
import { captureSurveyGeo } from "@/lib/fieldSurvey";
import { ensureWaTemplatesHydrated } from "@/lib/waTemplatesPersistence";
import { withHydrationSlot } from "@/lib/deskHydrateGuard";
import {
  loadWaTemplates,
  listApprovedTemplates,
  WA_TEMPLATE_VARIABLES,
  type WaTemplate,
} from "@/lib/waTemplates";

type Audience = "class_parents" | "leadership";
type Mode = "message" | "leave" | "request" | "outdoor";

type TemplateSend = {
  name: string;
  language: string;
  variableKeys?: string[];
  variables?: Record<string, string>;
};

type BroadcastResult = {
  ok?: boolean;
  recipientCount?: number;
  skippedOptOut?: number;
  sent?: number;
  failed?: number;
  error?: string;
};

function variableLabel(key: string): string {
  return WA_TEMPLATE_VARIABLES.find((v) => v.key === key)?.label || key;
}

async function postStaffBroadcast(
  payload: {
    audience: Audience;
    sectionId?: string;
    body?: string;
    template?: TemplateSend;
  },
  dryRun: boolean,
): Promise<BroadcastResult> {
  const res = await fetch("/api/v1/staff/broadcast", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...payload, dryRun }),
  });
  const json = (await res.json()) as BroadcastResult;
  if (!res.ok) throw new Error(json.error || "Send failed");
  return json;
}

/** Header WhatsApp button for staff: message their own class parents or
 * leadership, and (for leadership) file a real tracked leave request
 * instead of just sending a message that could get lost in chat. This one
 * genuinely sends WhatsApp — unlike the internal chat button, the logo is
 * accurate here. */
export function StaffBroadcastButton() {
  const session = useDemoSession();
  const [open, setOpen] = useState(false);
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [audience, setAudience] = useState<Audience>("class_parents");
  const [mode, setMode] = useState<Mode>("message");
  const [sectionId, setSectionId] = useState("");
  const [message, setMessage] = useState("");
  const [templates, setTemplates] = useState<WaTemplate[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [templateVars, setTemplateVars] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<BroadcastResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentResult, setSentResult] = useState<BroadcastResult | null>(null);

  // Leave-request fields
  const [hr, setHr] = useState(() => loadStaffHr());
  const [leaveType, setLeaveType] = useState<LeaveTypeCode>("");
  const [fromDate, setFromDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [toDate, setToDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [halfDay, setHalfDay] = useState(false);
  const [reason, setReason] = useState("");
  const [leaveDone, setLeaveDone] = useState<string | null>(null);

  // Request-ticket fields
  const [requestType, setRequestType] = useState<StaffRequestType>("supplies");
  const [requestSubject, setRequestSubject] = useState("");
  const [requestDescription, setRequestDescription] = useState("");
  const [requestDone, setRequestDone] = useState<string | null>(null);

  // Outdoor-duty fields
  const [odActive, setOdActive] = useState<OutdoorDutySession | null>(null);
  const [odPurpose, setOdPurpose] = useState<OutdoorDutyPurpose>("official_errand");
  const [odDestination, setOdDestination] = useState("");
  const [odNote, setOdNote] = useState("");
  const [odDone, setOdDone] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMasters(loadMasters());
    setTemplates(listApprovedTemplates(loadWaTemplates()));
    void withHydrationSlot(() => ensureWaTemplatesHydrated()).then(() => {
      setTemplates(listApprovedTemplates(loadWaTemplates()));
    });
    const freshHr = loadStaffHr();
    setHr(freshHr);
    setLeaveType((cur) => cur || freshHr.leaveTypes[0]?.code || "");
  }, [open]);

  const actor = useMemo(() => {
    if (!masters || !session) return null;
    return chatSelfFromSession(session, masters, loadSis());
  }, [masters, session]);

  useEffect(() => {
    if (!open || !actor?.staffId) return;
    setOdActive(activeOutdoorDutyForStaff(loadStaffAttendance(), actor.staffId));
  }, [open, actor]);

  const sections = useMemo((): ChatSectionRef[] => {
    if (!masters || !actor || actor.kind !== "staff" || !session) return [];
    const staff = (masters.staff ?? []).find((s) => s.id === actor.staffId);
    return staffAllowedSections(
      staff,
      masters,
      session.academicYearCode,
      actor.roleCodes,
    );
  }, [masters, actor, session]);

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === templateId) || null,
    [templates, templateId],
  );

  useEffect(() => {
    if (sections.length === 1 && !sectionId) {
      setSectionId(sections[0]!.sectionId);
    }
  }, [sections, sectionId]);

  if (!session || session.persona !== "staff") return null;

  function reset() {
    setAudience("class_parents");
    setMode("message");
    setSectionId("");
    setMessage("");
    setTemplateId("");
    setTemplateVars({});
    setPreview(null);
    setError(null);
    setSentResult(null);
    setBusy(false);
    setReason("");
    setLeaveDone(null);
    setRequestType("supplies");
    setRequestSubject("");
    setRequestDescription("");
    setRequestDone(null);
    setOdPurpose("official_errand");
    setOdDestination("");
    setOdNote("");
    setOdDone(null);
  }

  function buildPayload(): {
    audience: Audience;
    sectionId?: string;
    body?: string;
    template?: TemplateSend;
  } {
    return {
      audience,
      sectionId: audience === "class_parents" ? sectionId : undefined,
      ...(selectedTemplate
        ? {
            template: {
              name: selectedTemplate.metaName,
              language: selectedTemplate.metaLanguage,
              variableKeys: selectedTemplate.variables,
              variables: templateVars,
            },
          }
        : { body: message.trim() }),
    };
  }

  async function runPreview() {
    setError(null);
    setBusy(true);
    try {
      setPreview(await postStaffBroadcast(buildPayload(), true));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not preview send");
    } finally {
      setBusy(false);
    }
  }

  async function confirmSend() {
    setBusy(true);
    setError(null);
    try {
      setSentResult(await postStaffBroadcast(buildPayload(), false));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Send failed");
    } finally {
      setBusy(false);
    }
  }

  async function submitLeave() {
    if (!actor?.staffId || !session) return;
    setBusy(true);
    setError(null);
    try {
      const r = applyLeave({
        academicYearCode: session.academicYearCode,
        staffId: actor.staffId,
        typeCode: leaveType,
        fromDate,
        toDate,
        halfDay,
        reason: reason.trim(),
        appliedBy: session.fullName,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      // Real record is already filed — this is just an FYI ping, so no
      // preview/confirm dance for a handful of leadership numbers.
      await postStaffBroadcast(
        {
          audience: "leadership",
          body: `Leave request from ${session.fullName}: ${leaveType}, ${fromDate}${
            toDate !== fromDate ? ` to ${toDate}` : ""
          }${halfDay ? " (half day)" : ""}.${reason.trim() ? ` Reason: ${reason.trim()}` : ""} Check Staff → Leave to approve.`,
        },
        false,
      ).catch(() => null);
      setLeaveDone(
        `Leave request filed (${computeLeaveDays(fromDate, toDate, halfDay)} day(s)) — visible in Staff → Leave for approval.`,
      );
      setReason("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not file leave request");
    } finally {
      setBusy(false);
    }
  }

  async function submitRequest() {
    if (!actor?.staffId || !session) return;
    setBusy(true);
    setError(null);
    try {
      const r = createStaffRequestTicket({
        staffId: actor.staffId,
        raisedByName: session.fullName,
        type: requestType,
        subject: requestSubject.trim(),
        description: requestDescription.trim(),
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      // Real ticket is already filed — this is just an FYI ping, so no
      // preview/confirm dance for a handful of leadership numbers.
      await postStaffBroadcast(
        {
          audience: "leadership",
          body: `${STAFF_REQUEST_TYPE_LABELS[requestType]} request from ${session.fullName}: ${requestSubject.trim()}.${
            requestDescription.trim() ? ` ${requestDescription.trim()}` : ""
          } Check Staff → Requests to triage.`,
        },
        false,
      ).catch(() => null);
      setRequestDone(
        "Request filed — visible in Staff → Requests for triage.",
      );
      setRequestSubject("");
      setRequestDescription("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not file request");
    } finally {
      setBusy(false);
    }
  }

  async function submitOutdoorStart() {
    if (!actor?.staffId || !session || !masters) return;
    setBusy(true);
    setError(null);
    try {
      const geo = await captureSurveyGeo().catch(() => null);
      const r = startOutdoorDuty({
        academicYearCode: session.academicYearCode,
        staffId: actor.staffId,
        purpose: odPurpose,
        destination: odDestination.trim(),
        note: odNote.trim(),
        startGeo: geo,
        createdBy: session.fullName,
        roster: masters.staff ?? [],
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setOdActive(r.session);
      // Real check-out is already filed — this is just an FYI ping, so no
      // preview/confirm dance for a handful of leadership numbers.
      await postStaffBroadcast(
        {
          audience: "leadership",
          body: `${session.fullName} checked out for outdoor duty — ${OUTDOOR_DUTY_PURPOSE_LABELS[odPurpose]} · ${odDestination.trim()}.${
            odNote.trim() ? ` ${odNote.trim()}` : ""
          }${geo ? " (GPS captured)" : ""}`,
        },
        false,
      ).catch(() => null);
      setOdDone(
        `Checked out for ${OUTDOOR_DUTY_PURPOSE_LABELS[odPurpose]} at ${odDestination.trim()}${geo ? " — location recorded" : " — location unavailable"}.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not check out");
    } finally {
      setBusy(false);
    }
  }

  async function submitOutdoorEnd() {
    if (!actor?.staffId || !session || !masters || !odActive) return;
    setBusy(true);
    setError(null);
    try {
      const geo = await captureSurveyGeo().catch(() => null);
      const r = endOutdoorDuty({
        academicYearCode: session.academicYearCode,
        sessionId: odActive.id,
        staffId: actor.staffId,
        endGeo: geo,
        markedBy: session.fullName,
        roster: masters.staff ?? [],
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setOdActive(null);
      await postStaffBroadcast(
        {
          audience: "leadership",
          body: `${session.fullName} checked back in from outdoor duty (${OUTDOOR_DUTY_PURPOSE_LABELS[odActive.purpose]} · ${odActive.destination}).`,
        },
        false,
      ).catch(() => null);
      setOdDone("Checked in — outdoor duty closed.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not check in");
    } finally {
      setBusy(false);
    }
  }

  const canSend =
    audience === "class_parents" && !sectionId
      ? false
      : selectedTemplate
        ? selectedTemplate.variables.every((k) => (templateVars[k] || "").trim())
        : !!message.trim();

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-[#25D366] text-white shadow-sm transition hover:brightness-105"
        aria-label="WhatsApp"
        title="Message class parents or leadership"
      >
        <WhatsAppGlyph />
      </button>

      {open ? (
        <div className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-[min(100vw-1.5rem,24rem)] space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-[0_16px_40px_rgba(32,48,80,0.28)]">
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold text-[var(--brand-deep)]">
              WhatsApp
            </p>
            <button
              type="button"
              className="text-xs font-semibold text-[var(--muted)]"
              onClick={() => {
                setOpen(false);
                reset();
              }}
            >
              ✕
            </button>
          </div>

          {sentResult ? (
            <div className="space-y-2 text-sm">
              <p>
                Sent to {sentResult.sent ?? 0} of{" "}
                {sentResult.recipientCount ?? 0} recipient(s)
                {sentResult.failed ? ` — ${sentResult.failed} failed` : ""}
                {sentResult.skippedOptOut
                  ? ` — ${sentResult.skippedOptOut} opted out`
                  : ""}
                .
              </p>
              <button
                type="button"
                className="w-full rounded-lg bg-[var(--primary)] py-2 text-xs font-semibold text-[var(--primary-foreground)]"
                onClick={reset}
              >
                Done
              </button>
            </div>
          ) : (
            <>
              <div className="inline-flex rounded-lg border border-[var(--border)] p-0.5 text-xs">
                {sections.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => {
                      setAudience("class_parents");
                      setMode("message");
                      setPreview(null);
                    }}
                    className={`rounded-md px-2.5 py-1 font-medium ${
                      audience === "class_parents"
                        ? "bg-[var(--brand-deep)] text-white"
                        : "text-[var(--muted)]"
                    }`}
                  >
                    My class parents
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    setAudience("leadership");
                    setPreview(null);
                  }}
                  className={`rounded-md px-2.5 py-1 font-medium ${
                    audience === "leadership"
                      ? "bg-[var(--brand-deep)] text-white"
                      : "text-[var(--muted)]"
                  }`}
                >
                  Owner / Admin / Principal
                </button>
              </div>

              {audience === "class_parents" ? (
                sections.length > 1 ? (
                  <label className="block text-xs">
                    <span className="mb-1 block font-medium text-[var(--brand-deep)]">
                      Class / section
                    </span>
                    <select
                      className="w-full rounded-lg border border-[var(--border)] p-2 text-sm"
                      value={sectionId}
                      onChange={(e) => {
                        setSectionId(e.target.value);
                        setPreview(null);
                      }}
                    >
                      <option value="">Select…</option>
                      {sections.map((s) => (
                        <option key={s.sectionId} value={s.sectionId}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : sections.length === 1 ? (
                  <p className="text-xs text-[var(--muted)]">
                    Sending to parents of {sections[0]!.label}
                  </p>
                ) : null
              ) : (
                <div className="inline-flex rounded-lg border border-[var(--border)] p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setMode("message")}
                    className={`rounded-md px-2.5 py-1 font-medium ${
                      mode === "message"
                        ? "bg-[var(--brand-deep)] text-white"
                        : "text-[var(--muted)]"
                    }`}
                  >
                    Send a message
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("leave")}
                    className={`rounded-md px-2.5 py-1 font-medium ${
                      mode === "leave"
                        ? "bg-[var(--brand-deep)] text-white"
                        : "text-[var(--muted)]"
                    }`}
                  >
                    Apply for leave
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("request")}
                    className={`rounded-md px-2.5 py-1 font-medium ${
                      mode === "request"
                        ? "bg-[var(--brand-deep)] text-white"
                        : "text-[var(--muted)]"
                    }`}
                  >
                    Raise a request
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("outdoor")}
                    className={`rounded-md px-2.5 py-1 font-medium ${
                      mode === "outdoor"
                        ? "bg-[var(--brand-deep)] text-white"
                        : "text-[var(--muted)]"
                    }`}
                  >
                    {odActive ? "Outdoor duty (active)" : "Check out for outdoor duty"}
                  </button>
                </div>
              )}

              {audience === "leadership" && mode === "leave" ? (
                leaveDone ? (
                  <div className="space-y-2 text-sm">
                    <p className="rounded-lg border border-[var(--success)]/25 bg-[var(--success-soft)] p-2.5 text-[var(--success)]">
                      {leaveDone}
                    </p>
                    <button
                      type="button"
                      className="w-full rounded-lg bg-[var(--primary)] py-2 text-xs font-semibold text-[var(--primary-foreground)]"
                      onClick={reset}
                    >
                      Done
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block text-xs">
                        <span className="mb-1 block font-medium text-[var(--brand-deep)]">
                          Leave type
                        </span>
                        <select
                          className="w-full rounded-lg border border-[var(--border)] p-2 text-sm"
                          value={leaveType}
                          onChange={(e) =>
                            setLeaveType(e.target.value as LeaveTypeCode)
                          }
                        >
                          {hr.leaveTypes.map((t) => (
                            <option key={t.code} value={t.code}>
                              {t.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="flex items-end gap-1.5 text-xs">
                        <input
                          type="checkbox"
                          checked={halfDay}
                          onChange={(e) => {
                            setHalfDay(e.target.checked);
                            if (e.target.checked) setToDate(fromDate);
                          }}
                        />
                        <span className="text-[var(--brand-deep)]">Half day</span>
                      </label>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block text-xs">
                        <span className="mb-1 block font-medium text-[var(--brand-deep)]">
                          From
                        </span>
                        <input
                          type="date"
                          className="w-full rounded-lg border border-[var(--border)] p-2 text-sm"
                          value={fromDate}
                          onChange={(e) => {
                            setFromDate(e.target.value);
                            if (halfDay) setToDate(e.target.value);
                          }}
                        />
                      </label>
                      <label className="block text-xs">
                        <span className="mb-1 block font-medium text-[var(--brand-deep)]">
                          To
                        </span>
                        <input
                          type="date"
                          disabled={halfDay}
                          className="w-full rounded-lg border border-[var(--border)] p-2 text-sm disabled:opacity-50"
                          value={toDate}
                          onChange={(e) => setToDate(e.target.value)}
                        />
                      </label>
                    </div>
                    <textarea
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Reason…"
                      rows={2}
                      className="w-full rounded-lg border border-[var(--border)] p-2 text-sm"
                    />
                    {error ? (
                      <p className="text-xs text-[var(--danger)]">{error}</p>
                    ) : null}
                    <button
                      type="button"
                      disabled={busy || !reason.trim() || !leaveType}
                      className="w-full rounded-lg bg-[var(--primary)] py-2 text-xs font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
                      onClick={() => void submitLeave()}
                    >
                      {busy ? "Filing…" : "Submit leave request"}
                    </button>
                    <p className="text-[10px] text-[var(--muted)]">
                      Files a real tracked request in Staff → Leave and pings
                      leadership on WhatsApp — not just a chat message.
                    </p>
                  </div>
                )
              ) : audience === "leadership" && mode === "request" ? (
                requestDone ? (
                  <div className="space-y-2 text-sm">
                    <p className="rounded-lg border border-[var(--success)]/25 bg-[var(--success-soft)] p-2.5 text-[var(--success)]">
                      {requestDone}
                    </p>
                    <button
                      type="button"
                      className="w-full rounded-lg bg-[var(--primary)] py-2 text-xs font-semibold text-[var(--primary-foreground)]"
                      onClick={reset}
                    >
                      Done
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <label className="block text-xs">
                      <span className="mb-1 block font-medium text-[var(--brand-deep)]">
                        Type
                      </span>
                      <select
                        className="w-full rounded-lg border border-[var(--border)] p-2 text-sm"
                        value={requestType}
                        onChange={(e) =>
                          setRequestType(e.target.value as StaffRequestType)
                        }
                      >
                        {Object.entries(STAFF_REQUEST_TYPE_LABELS).map(
                          ([code, label]) => (
                            <option key={code} value={code}>
                              {label}
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                    <input
                      className="w-full rounded-lg border border-[var(--border)] p-2 text-sm"
                      placeholder="Subject (short)"
                      value={requestSubject}
                      onChange={(e) => setRequestSubject(e.target.value)}
                    />
                    <textarea
                      value={requestDescription}
                      onChange={(e) => setRequestDescription(e.target.value)}
                      placeholder="Details…"
                      rows={2}
                      className="w-full rounded-lg border border-[var(--border)] p-2 text-sm"
                    />
                    {error ? (
                      <p className="text-xs text-[var(--danger)]">{error}</p>
                    ) : null}
                    <button
                      type="button"
                      disabled={busy || !requestSubject.trim()}
                      className="w-full rounded-lg bg-[var(--primary)] py-2 text-xs font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
                      onClick={() => void submitRequest()}
                    >
                      {busy ? "Filing…" : "Submit request"}
                    </button>
                    <p className="text-[10px] text-[var(--muted)]">
                      Files a real tracked ticket in Staff → Requests and
                      pings leadership on WhatsApp — not just a chat message.
                    </p>
                  </div>
                )
              ) : audience === "leadership" && mode === "outdoor" ? (
                odDone ? (
                  <div className="space-y-2 text-sm">
                    <p className="rounded-lg border border-[var(--success)]/25 bg-[var(--success-soft)] p-2.5 text-[var(--success)]">
                      {odDone}
                    </p>
                    <button
                      type="button"
                      className="w-full rounded-lg bg-[var(--primary)] py-2 text-xs font-semibold text-[var(--primary-foreground)]"
                      onClick={reset}
                    >
                      Done
                    </button>
                  </div>
                ) : odActive ? (
                  <div className="space-y-2">
                    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-sunken)] p-2.5 text-xs">
                      <p className="font-semibold text-[var(--brand-deep)]">
                        Out since {new Date(odActive.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </p>
                      <p className="mt-0.5 text-[var(--muted)]">
                        {OUTDOOR_DUTY_PURPOSE_LABELS[odActive.purpose]} ·{" "}
                        {odActive.destination}
                        {odActive.note ? ` — ${odActive.note}` : ""}
                      </p>
                    </div>
                    {error ? (
                      <p className="text-xs text-[var(--danger)]">{error}</p>
                    ) : null}
                    <button
                      type="button"
                      disabled={busy}
                      className="w-full rounded-lg bg-[var(--primary)] py-2 text-xs font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
                      onClick={() => void submitOutdoorEnd()}
                    >
                      {busy ? "Checking in…" : "Check in — I'm back"}
                    </button>
                    <p className="text-[10px] text-[var(--muted)]">
                      Closes the outdoor duty session and records your
                      return time (and location, if available).
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <label className="block text-xs">
                      <span className="mb-1 block font-medium text-[var(--brand-deep)]">
                        Purpose
                      </span>
                      <select
                        className="w-full rounded-lg border border-[var(--border)] p-2 text-sm"
                        value={odPurpose}
                        onChange={(e) =>
                          setOdPurpose(e.target.value as OutdoorDutyPurpose)
                        }
                      >
                        {Object.entries(OUTDOOR_DUTY_PURPOSE_LABELS).map(
                          ([code, label]) => (
                            <option key={code} value={code}>
                              {label}
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                    <input
                      className="w-full rounded-lg border border-[var(--border)] p-2 text-sm"
                      placeholder="Destination (e.g. SBI branch, Cantt)"
                      value={odDestination}
                      onChange={(e) => setOdDestination(e.target.value)}
                    />
                    <textarea
                      value={odNote}
                      onChange={(e) => setOdNote(e.target.value)}
                      placeholder="Note (optional)…"
                      rows={2}
                      className="w-full rounded-lg border border-[var(--border)] p-2 text-sm"
                    />
                    {error ? (
                      <p className="text-xs text-[var(--danger)]">{error}</p>
                    ) : null}
                    <button
                      type="button"
                      disabled={busy || !odDestination.trim()}
                      className="w-full rounded-lg bg-[var(--primary)] py-2 text-xs font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
                      onClick={() => void submitOutdoorStart()}
                    >
                      {busy ? "Checking out…" : "Check out"}
                    </button>
                    <p className="text-[10px] text-[var(--muted)]">
                      Marks today Present · Outdoor duty, captures your
                      location if you allow it, and pings leadership — visible
                      in Staff → Outdoor duty.
                    </p>
                  </div>
                )
              ) : (
                <>
                  <label className="block text-xs">
                    <span className="mb-1 block font-medium text-[var(--brand-deep)]">
                      Approved template (optional)
                    </span>
                    <select
                      className="w-full rounded-lg border border-[var(--border)] p-2 text-sm"
                      value={templateId}
                      onChange={(e) => {
                        setTemplateId(e.target.value);
                        setTemplateVars({});
                        setPreview(null);
                      }}
                    >
                      <option value="">Free text instead</option>
                      {templates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} ({t.language})
                        </option>
                      ))}
                    </select>
                  </label>

                  {selectedTemplate ? (
                    <div className="space-y-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-sunken)] p-2.5">
                      <p className="whitespace-pre-wrap text-xs text-[var(--brand-deep)]">
                        {selectedTemplate.body}
                      </p>
                      {selectedTemplate.variables.map((key) => (
                        <input
                          key={key}
                          className="w-full rounded-lg border border-[var(--border)] p-2 text-xs"
                          placeholder={variableLabel(key)}
                          value={templateVars[key] || ""}
                          onChange={(e) => {
                            setTemplateVars((v) => ({
                              ...v,
                              [key]: e.target.value,
                            }));
                            setPreview(null);
                          }}
                        />
                      ))}
                    </div>
                  ) : (
                    <textarea
                      value={message}
                      onChange={(e) => {
                        setMessage(e.target.value);
                        setPreview(null);
                      }}
                      placeholder="Message text…"
                      rows={3}
                      className="w-full rounded-lg border border-[var(--border)] p-2 text-sm"
                    />
                  )}

                  {error ? (
                    <p className="text-xs text-[var(--danger)]">{error}</p>
                  ) : null}

                  {preview ? (
                    <div className="rounded-lg border border-[var(--info)]/25 bg-[var(--info-soft)] p-2 text-xs">
                      <span
                        className="font-semibold"
                        style={{ color: "var(--info)" }}
                      >
                        {preview.recipientCount ?? 0} recipient(s) will
                        receive this
                      </span>
                      {preview.skippedOptOut ? (
                        <span className="block text-[var(--muted)]">
                          {preview.skippedOptOut} excluded (opted out)
                        </span>
                      ) : null}
                    </div>
                  ) : null}

                  {preview ? (
                    <button
                      type="button"
                      disabled={busy || (preview.recipientCount ?? 0) === 0}
                      className="w-full rounded-lg bg-[var(--danger)] py-2 text-xs font-semibold text-white disabled:opacity-50"
                      onClick={() => void confirmSend()}
                    >
                      {busy
                        ? "Sending…"
                        : `Send to ${preview.recipientCount ?? 0} number(s)`}
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busy || !canSend}
                      className="w-full rounded-lg bg-[var(--primary)] py-2 text-xs font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
                      onClick={() => void runPreview()}
                    >
                      {busy ? "Checking…" : "Preview recipients"}
                    </button>
                  )}
                </>
              )}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function WhatsAppGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}
