"use client";

import { useEffect, useMemo, useState } from "react";
import { reportAiOutcome } from "@/lib/aiOutcomeClient";
import {
  Download,
  FileText,
  Pencil,
  Printer,
  Send,
  Sparkles,
  Stamp,
  X,
} from "lucide-react";
import { loadMasters, type MastersState } from "@/lib/masters";
import { hasPermission } from "@/lib/rbac";
import { resolveSessionStaff } from "@/lib/staffResolve";
import {
  agreementStatusLabel,
  agreementTemplates,
  counterSignStaffAgreement,
  createStaffAgreement,
  loadAgreements,
  sendStaffAgreement,
  signStaffAgreement,
  templateLabel,
  updateStaffAgreementDraft,
  voidStaffAgreement,
  CONSENT_TEXT,
  type AgreementTemplateId,
  type StaffAgreement,
} from "@/lib/staffAgreement";
import type {
  AgreementPdfPageFormat,
  AgreementPdfPrintMode,
} from "@/lib/staffAgreementPdf";
import {
  downloadStaffAgreementPdf,
  printStaffAgreement,
} from "@/lib/staffAgreementPdf";
import { StaffImageField } from "@/components/staff/StaffImageField";
import { useDemoSession } from "@/components/shell/SessionContext";
import {
  ErpPanel,
  ErpStatusBadge,
  ErpTable,
  ErpTableBody,
  ErpTableHead,
  ErpTableShell,
} from "@/components/ui/erp-roster";
import { btn, btnOutline, field } from "@/components/ui/erp-ui";

type Mode = "hr" | "self";
type AiLanguage = "en" | "hi" | "both";

export function StaffAgreementPanel({
  mode = "hr",
  staffId: fixedStaffId,
}: {
  mode?: Mode;
  /** When set (profile form), scope to one staff member */
  staffId?: string;
}) {
  const session = useDemoSession();
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [agreements, setAgreements] = useState<StaffAgreement[]>([]);
  const [tick, setTick] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [createStaffId, setCreateStaffId] = useState(fixedStaffId || "");
  const [templateId, setTemplateId] =
    useState<AgreementTemplateId>("appointment_letter");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [draftIsAi, setDraftIsAi] = useState(false);
  const [draftGenerationId, setDraftGenerationId] = useState("");

  const [aiDetails, setAiDetails] = useState("");
  const [aiLanguage, setAiLanguage] = useState<AiLanguage>("both");
  const [aiAgreementType, setAiAgreementType] = useState("appointment");
  const [aiLoading, setAiLoading] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingStaffId, setEditingStaffId] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [editDirty, setEditDirty] = useState(false);
  const [aiReviseNote, setAiReviseNote] = useState("");

  const [printMode, setPrintMode] = useState<AgreementPdfPrintMode>("full");
  const [pageFormat, setPageFormat] = useState<AgreementPdfPageFormat>("a4");

  const [consent, setConsent] = useState(false);
  const [signatureUrl, setSignatureUrl] = useState("");

  useEffect(() => {
    setMasters(loadMasters());
    setAgreements(loadAgreements().agreements);
  }, [tick]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    void (async () => {
      const [{ ensureStaffAgreementsHydrated }, { withHydrationSlot }] =
        await Promise.all([
          import("@/lib/staffAgreementPersistence"),
          import("@/lib/deskHydrateGuard"),
        ]);
      await withHydrationSlot(() => ensureStaffAgreementsHydrated());
      setTick((t) => t + 1);
    })();
  }, []);

  const sessionStaff = useMemo(() => {
    if (!masters) return null;
    return resolveSessionStaff(session, masters);
  }, [masters, session]);

  const canEdit = useMemo(() => {
    if (!masters) return false;
    return hasPermission(session, masters, "staff", "edit");
  }, [masters, session]);

  const effectiveMode: Mode =
    mode === "self" || (!canEdit && sessionStaff) ? "self" : "hr";

  const roster = useMemo(
    () =>
      (masters?.staff ?? [])
        .filter((s) => s.status === "active")
        .sort((a, b) => a.empCode.localeCompare(b.empCode)),
    [masters],
  );

  const visible = useMemo(() => {
    let rows = [...agreements];
    if (fixedStaffId) {
      rows = rows.filter((a) => a.staffId === fixedStaffId);
    }
    if (effectiveMode === "self" && sessionStaff) {
      rows = rows.filter((a) => a.staffId === sessionStaff.id);
    }
    return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [agreements, fixedStaffId, effectiveMode, sessionStaff]);

  const editingAgreement = useMemo(() => {
    if (!editingId) return null;
    return agreements.find((a) => a.id === editingId) ?? null;
  }, [agreements, editingId]);

  const pendingSelf = useMemo(() => {
    if (!sessionStaff) return null;
    return visible.find((a) => a.status === "pending_staff") ?? null;
  }, [visible, sessionStaff]);

  function flash(msg: string, isError = false) {
    if (isError) {
      setError(msg);
      setNotice(null);
      window.setTimeout(() => setError(null), 3200);
    } else {
      setNotice(msg);
      setError(null);
      window.setTimeout(() => setNotice(null), 2800);
    }
  }

  function pdfOptions(row: StaffAgreement) {
    return {
      printMode,
      pageFormat,
      includePrincipalStamp: row.status === "counter_signed",
    };
  }

  async function callAgreementAi(opts: {
    mode: "create" | "revise";
    staffId: string;
    title?: string;
    body?: string;
    changeRequest?: string;
  }): Promise<{ title: string; body: string; generationId: string } | null> {
    setAiLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/staff-agreement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: opts.mode,
          staffId: opts.staffId,
          language: aiLanguage,
          details: aiDetails,
          agreementType: aiAgreementType,
          currentTitle: opts.title,
          currentBody: opts.body,
          changeRequest: opts.changeRequest,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        title?: string;
        body?: string;
        generationId?: string;
      };
      if (!res.ok || data.error) {
        flash(data.error || "AI generation failed", true);
        return null;
      }
      return {
        title: data.title || "Employment Agreement",
        body: data.body || "",
        generationId: data.generationId || "",
      };
    } catch {
      flash("Network error — try again", true);
      return null;
    } finally {
      setAiLoading(false);
    }
  }

  async function onGenerateAi() {
    if (!masters || !canEdit) return;
    const sid = fixedStaffId || createStaffId;
    if (!sid) {
      flash("Select a staff member first", true);
      return;
    }
    const result = await callAgreementAi({ mode: "create", staffId: sid });
    if (!result) return;
    setTemplateId("custom");
    setDraftTitle(result.title);
    setDraftBody(result.body);
    setDraftIsAi(true);
    setDraftGenerationId(result.generationId);
    flash("CBSE-style AI draft ready — review, edit, then create draft");
  }

  async function onCreate() {
    if (!masters || !canEdit) return;
    const sid = fixedStaffId || createStaffId;
    if (!sid) {
      flash("Select a staff member", true);
      return;
    }
    setBusy(true);
    const r = createStaffAgreement({
      masters,
      staffId: sid,
      templateId,
      createdBy: session.fullName || "HR",
      actorStaffId: sessionStaff?.id,
      title: draftTitle || undefined,
      bodyTemplate: draftBody || undefined,
      aiGenerated: draftIsAi,
    });
    setBusy(false);
    if (!r.ok) {
      flash(r.error, true);
      return;
    }
    if (draftIsAi && draftGenerationId) {
      reportAiOutcome({ ids: [draftGenerationId], outcome: "accepted", targetType: "staff_agreement" });
      setDraftGenerationId("");
    }
    flash("Agreement created (draft)");
    setDraftTitle("");
    setDraftBody("");
    setDraftIsAi(false);
    startEdit(r.agreement);
    setTick((t) => t + 1);
  }

  function closeEditor() {
    setEditingId(null);
    setEditingStaffId("");
    setEditTitle("");
    setEditBody("");
    setEditDirty(false);
    setAiReviseNote("");
  }

  function startEdit(row: StaffAgreement) {
    if (row.status !== "draft") {
      flash("Only draft agreements can be edited", true);
      return;
    }
    setEditingId(row.id);
    setEditingStaffId(row.staffId);
    setEditTitle(row.title);
    setEditBody(row.body);
    setEditDirty(false);
    setAiReviseNote("");
  }

  async function onAiReviseDraft() {
    if (!editingStaffId || !editBody.trim()) {
      flash("Add some agreement text before asking AI to revise", true);
      return;
    }
    const result = await callAgreementAi({
      mode: "revise",
      staffId: editingStaffId,
      title: editTitle,
      body: editBody,
      changeRequest:
        aiReviseNote.trim() ||
        "Align with CBSE affiliation norms and standard clauses used by reputed CBSE private schools in India. Expand any thin sections.",
    });
    if (!result) return;
    if (
      !window.confirm(
        "Apply AI-revised CBSE agreement text? Your current editor content will be replaced (you can still edit before saving).",
      )
    ) {
      return;
    }
    setEditTitle(result.title);
    setEditBody(result.body);
    setEditDirty(true);
    flash("AI revision applied — review and Save draft");
  }

  function onSaveDraft() {
    if (!editingId) return;
    const r = updateStaffAgreementDraft(
      editingId,
      { title: editTitle, body: editBody },
      { name: session.fullName || "HR", staffId: sessionStaff?.id },
    );
    if (!r.ok) {
      flash(r.error, true);
      return;
    }
    flash("Draft saved");
    setEditDirty(false);
    setTick((t) => t + 1);
  }

  async function onSend(id: string) {
    if (!canEdit) return;
    const r = sendStaffAgreement(id, {
      name: session.fullName || "HR",
      staffId: sessionStaff?.id,
    });
    if (!r.ok) {
      flash(r.error, true);
      return;
    }
    flash("Sent to staff for signature");
    closeEditor();
    setTick((t) => t + 1);
  }

  async function onCounterSign(id: string) {
    if (!masters || !canEdit) return;
    setBusy(true);
    const r = await counterSignStaffAgreement({
      agreementId: id,
      actorName: session.fullName || "Principal",
      actorStaffId: sessionStaff?.id,
      masters,
    });
    setBusy(false);
    if (!r.ok) {
      flash(r.error, true);
      return;
    }
    flash("Counter-signed with principal stamp");
    setTick((t) => t + 1);
  }

  function onVoid(id: string) {
    if (!canEdit) return;
    if (!window.confirm("Void this agreement?")) return;
    const r = voidStaffAgreement(id, {
      name: session.fullName || "HR",
      staffId: sessionStaff?.id,
    });
    if (!r.ok) {
      flash(r.error, true);
      return;
    }
    if (editingId === id) closeEditor();
    flash("Agreement voided");
    setTick((t) => t + 1);
  }

  async function onSelfSign() {
    if (!masters || !sessionStaff || !pendingSelf) return;
    setBusy(true);
    const r = await signStaffAgreement({
      agreementId: pendingSelf.id,
      staffId: sessionStaff.id,
      signatureUrl,
      consentAccepted: consent,
      actorName: sessionStaff.fullName,
      masters,
    });
    setBusy(false);
    if (!r.ok) {
      flash(r.error, true);
      return;
    }
    setConsent(false);
    setSignatureUrl("");
    flash("Agreement signed — PDF locked");
    setTick((t) => t + 1);
  }

  async function onDownload(row: StaffAgreement) {
    if (!masters) return;
    setBusy(true);
    try {
      await downloadStaffAgreementPdf(row, masters, pdfOptions(row));
    } catch {
      flash("Could not generate PDF", true);
    } finally {
      setBusy(false);
    }
  }

  async function onPrint(row: StaffAgreement) {
    if (!masters) return;
    setBusy(true);
    try {
      await printStaffAgreement(row, masters, pdfOptions(row));
    } catch {
      flash("Could not open print dialog", true);
    } finally {
      setBusy(false);
    }
  }

  if (!masters) {
    return <p className="text-sm text-[var(--muted)]">Loading agreements…</p>;
  }

  return (
    <div className="space-y-4">
      {notice ? (
        <p className="text-sm font-medium text-emerald-700">{notice}</p>
      ) : null}
      {error ? (
        <p className="text-sm font-medium text-[var(--danger)]">{error}</p>
      ) : null}

      {effectiveMode === "self" && pendingSelf ? (
        <ErpPanel
          title="Employment agreement — action required"
          description="Read the terms, accept consent, and sign below."
        >
          <div className="space-y-4">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] p-4">
              <h3 className="text-sm font-bold text-[var(--brand-deep)]">
                {pendingSelf.title}
              </h3>
              <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap text-xs leading-relaxed text-[var(--brand-deep)]">
                {pendingSelf.body}
              </pre>
            </div>

            <label className="flex items-start gap-2 text-sm text-[var(--brand-deep)]">
              <input
                type="checkbox"
                className="mt-1"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              <span>{CONSENT_TEXT}</span>
            </label>

            <StaffImageField
              label="Your signature"
              value={signatureUrl}
              onChange={setSignatureUrl}
              onError={(m) => flash(m, true)}
              aspect="wide"
              hint="Draw or upload signature · under 800 KB"
            />

            <button
              type="button"
              className={btn}
              disabled={busy || !consent || !signatureUrl}
              onClick={() => void onSelfSign()}
            >
              {busy ? "Signing…" : "Sign agreement"}
            </button>
          </div>
        </ErpPanel>
      ) : effectiveMode === "self" ? (
        <p className="text-sm text-[var(--muted)]">
          No agreement pending your signature.
        </p>
      ) : null}

      {effectiveMode === "hr" && canEdit ? (
        <>
          <ErpPanel
            title="Draft with AI (CBSE norms)"
            description="Generates a detailed agreement with standard CBSE school clauses — probation, POCSO, conduct, notice period, etc."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              {!fixedStaffId ? (
                <label className="text-xs font-semibold text-[var(--muted)]">
                  Staff
                  <select
                    className={`${field} mt-1 !py-2`}
                    value={createStaffId}
                    onChange={(e) => setCreateStaffId(e.target.value)}
                  >
                    <option value="">Select…</option>
                    {roster.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.empCode} · {s.fullName}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="text-xs font-semibold text-[var(--muted)]">
                Agreement type
                <select
                  className={`${field} mt-1 !py-2`}
                  value={aiAgreementType}
                  onChange={(e) => setAiAgreementType(e.target.value)}
                >
                  <option value="appointment">Appointment / offer</option>
                  <option value="confidentiality">Confidentiality</option>
                  <option value="policy">Policy acknowledgment</option>
                  <option value="conduct">Conduct rules</option>
                </select>
              </label>
              <label className="text-xs font-semibold text-[var(--muted)]">
                Language
                <select
                  className={`${field} mt-1 !py-2`}
                  value={aiLanguage}
                  onChange={(e) => setAiLanguage(e.target.value as AiLanguage)}
                >
                  <option value="en">English</option>
                  <option value="hi">Hindi</option>
                  <option value="both">English + Hindi</option>
                </select>
              </label>
            </div>
            <label className="mt-3 block text-xs font-semibold text-[var(--muted)]">
              Details for AI (salary, probation, notice period, duties, special clauses…)
              <textarea
                className={`${field} mt-1 min-h-[88px] !py-2`}
                value={aiDetails}
                onChange={(e) => setAiDetails(e.target.value)}
                placeholder="e.g. Basic pay ₹25,000, probation 6 months, 30 days notice, reporting to Principal…"
              />
            </label>
            <button
              type="button"
              className={`${btnOutline} mt-3`}
              disabled={aiLoading || !(fixedStaffId || createStaffId)}
              onClick={() => void onGenerateAi()}
            >
              <Sparkles className="mr-1 inline h-4 w-4" />
              {aiLoading ? "Generating CBSE draft…" : "Generate CBSE agreement (AI)"}
            </button>
          </ErpPanel>

          <ErpPanel
            title="Create agreement"
            description="Pick a template or use AI text below — edit title & body, then create draft."
          >
            <div className="flex flex-wrap items-end gap-3">
              {!fixedStaffId ? (
                <label className="min-w-[12rem] text-xs font-semibold text-[var(--muted)]">
                  Staff
                  <select
                    className={`${field} mt-1 !py-2`}
                    value={createStaffId}
                    onChange={(e) => setCreateStaffId(e.target.value)}
                  >
                    <option value="">Select…</option>
                    {roster.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.empCode} · {s.fullName}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="min-w-[12rem] text-xs font-semibold text-[var(--muted)]">
                Template
                <select
                  className={`${field} mt-1 !py-2`}
                  value={templateId}
                  onChange={(e) => {
                    const id = e.target.value as AgreementTemplateId;
                    setTemplateId(id);
                    if (id !== "custom") {
                      setDraftTitle("");
                      setDraftBody("");
                      setDraftIsAi(false);
                    }
                  }}
                >
                  {agreementTemplates().map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {(templateId === "custom" || draftTitle || draftBody) ? (
              <div className="mt-4 space-y-3">
                <label className="block text-xs font-semibold text-[var(--muted)]">
                  Title
                  <input
                    className={`${field} mt-1 !py-2`}
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    placeholder="Employment Agreement"
                  />
                </label>
                <label className="block text-xs font-semibold text-[var(--muted)]">
                  Body (placeholders like {"{{staffName}}"} are filled on create)
                  <textarea
                    className={`${field} mt-1 min-h-[160px] !py-2 font-mono text-xs`}
                    value={draftBody}
                    onChange={(e) => setDraftBody(e.target.value)}
                  />
                </label>
              </div>
            ) : null}

            <button
              type="button"
              className={`${btn} mt-4`}
              disabled={busy}
              onClick={() => void onCreate()}
            >
              <FileText className="mr-1 inline h-4 w-4" />
              Create draft
            </button>
          </ErpPanel>
        </>
      ) : null}

      {effectiveMode === "hr" && canEdit ? (
        <ErpPanel title="Print settings" description="Applies to Download and Print on each agreement.">
          <div className="flex flex-wrap gap-4">
            <label className="text-xs font-semibold text-[var(--muted)]">
              Print mode
              <select
                className={`${field} mt-1 !py-2`}
                value={printMode}
                onChange={(e) =>
                  setPrintMode(e.target.value as AgreementPdfPrintMode)
                }
              >
                <option value="full">Full letterhead (white paper)</option>
                <option value="green_stationery">
                  Green / pre-printed stationery (text only)
                </option>
              </select>
            </label>
            <label className="text-xs font-semibold text-[var(--muted)]">
              Paper size
              <select
                className={`${field} mt-1 !py-2`}
                value={pageFormat}
                onChange={(e) =>
                  setPageFormat(e.target.value as AgreementPdfPageFormat)
                }
              >
                <option value="a4">A4</option>
                <option value="legal">Legal (8.5″ × 14″)</option>
              </select>
            </label>
          </div>
          {printMode === "green_stationery" ? (
            <p className="mt-2 text-[11px] text-[var(--muted)]">
              Load green legal paper in the printer. Print uses black text only — no
              logo or white background. Align top margin (~50 mm) with your
              pre-printed letterhead.
            </p>
          ) : null}
        </ErpPanel>
      ) : null}

      <ErpTableShell>
        <ErpTable>
          <ErpTableHead>
            <tr>
              <th className="px-4 py-3 font-bold">Agreement No.</th>
              <th className="px-4 py-3 font-bold">Staff</th>
              <th className="px-4 py-3 font-bold">Template</th>
              <th className="px-4 py-3 font-bold">Status</th>
              <th className="px-4 py-3 font-bold">Created</th>
              <th className="px-4 py-3 font-bold">Hash</th>
              <th className="px-4 py-3 font-bold" />
            </tr>
          </ErpTableHead>
          <ErpTableBody>
            {visible.map((row) => (
              <tr key={row.id} className="hover:bg-[var(--surface-sunken)]">
                <td className="px-4 py-3 font-mono text-xs font-semibold text-[var(--brand-deep)]">
                  {row.agreementNo || "—"}
                </td>
                <td className="px-4 py-3">
                  <span className="font-semibold text-[var(--brand-deep)]">
                    {row.empCode}
                  </span>
                  <br />
                  <span className="text-xs text-[var(--muted)]">
                    {row.staffName}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm">
                  {templateLabel(row.templateId)}
                  {row.aiGenerated ? (
                    <span
                      className="ml-1.5 rounded-full bg-[rgba(197,160,40,0.15)] px-1.5 py-0.5 text-[9px] font-semibold text-[#8a6400]"
                      title="Initial draft came from the AI drafting assistant — reviewed and signed by humans before it takes effect"
                    >
                      AI-drafted
                    </span>
                  ) : null}
                  <br />
                  <span className="text-[10px] text-[var(--muted)]">
                    {row.title}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <ErpStatusBadge
                    active={
                      row.status === "counter_signed" ||
                      row.status === "signed_staff"
                    }
                    activeLabel={agreementStatusLabel(row.status)}
                    inactiveLabel={agreementStatusLabel(row.status)}
                  />
                </td>
                <td className="px-4 py-3 text-xs text-[var(--muted)]">
                  {row.createdAt.slice(0, 10)}
                  {row.staffSignedAt ? (
                    <>
                      <br />
                      Signed {row.staffSignedAt.slice(0, 10)}
                    </>
                  ) : null}
                </td>
                <td className="px-4 py-3 font-mono text-[10px] text-[var(--muted)]">
                  {row.documentHash}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="inline-flex flex-col items-end gap-1">
                    {canEdit && row.status === "draft" ? (
                      <>
                        <button
                          type="button"
                          className="text-xs font-semibold text-[var(--brand-deep)]"
                          onClick={(e) => {
                            e.stopPropagation();
                            startEdit(row);
                          }}
                        >
                          <Pencil className="mr-1 inline h-3 w-3" />
                          Edit
                        </button>
                        <button
                          type="button"
                          className="text-xs font-semibold text-[var(--brand-deep)]"
                          onClick={() => void onSend(row.id)}
                        >
                          <Send className="mr-1 inline h-3 w-3" />
                          Send to staff
                        </button>
                      </>
                    ) : null}
                    {canEdit && row.status === "signed_staff" ? (
                      <button
                        type="button"
                        className="text-xs font-semibold text-[var(--brand-deep)]"
                        disabled={busy}
                        onClick={() => void onCounterSign(row.id)}
                      >
                        <Stamp className="mr-1 inline h-3 w-3" />
                        Counter-sign
                      </button>
                    ) : null}
                    {row.status !== "void" &&
                    (row.pdfDataUrl ||
                      row.status === "draft" ||
                      row.status === "pending_staff" ||
                      row.status === "signed_staff" ||
                      row.status === "counter_signed") ? (
                      <>
                        <button
                          type="button"
                          className="text-xs font-semibold text-[var(--brand-deep)]"
                          disabled={busy}
                          onClick={() => void onDownload(row)}
                        >
                          <Download className="mr-1 inline h-3 w-3" />
                          Download PDF
                        </button>
                        <button
                          type="button"
                          className="text-xs font-semibold text-[var(--brand-deep)]"
                          disabled={busy}
                          onClick={() => void onPrint(row)}
                        >
                          <Printer className="mr-1 inline h-3 w-3" />
                          Print
                        </button>
                      </>
                    ) : null}
                    {canEdit &&
                    row.status !== "void" &&
                    row.status !== "counter_signed" ? (
                      <button
                        type="button"
                        className="text-xs text-[var(--muted)]"
                        onClick={() => onVoid(row.id)}
                      >
                        Void
                      </button>
                    ) : null}
                    {row.audit.length > 0 ? (
                      <details className="text-left text-[10px] text-[var(--muted)]">
                        <summary className="cursor-pointer">Audit</summary>
                        <ul className="mt-1 max-h-24 space-y-1 overflow-auto">
                          {row.audit.map((a) => (
                            <li key={a.id}>
                              {a.action} · {a.at.slice(0, 19)} · {a.actorName}
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
            {visible.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-8 text-center text-sm text-[var(--muted)]"
                >
                  No employment agreements yet.
                </td>
              </tr>
            ) : null}
          </ErpTableBody>
        </ErpTable>
      </ErpTableShell>

      {editingId && editingAgreement?.status === "draft" && canEdit ? (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="agreement-editor-title"
          onClick={() => closeEditor()}
        >
          <div
            className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-[var(--card)] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
              <div>
                <h2
                  id="agreement-editor-title"
                  className="text-base font-bold text-[var(--brand-deep)]"
                >
                  Edit draft — {editingAgreement.empCode} · {editingAgreement.staffName}
                </h2>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  Save before sending. Use AI below to align with CBSE school employment norms.
                </p>
                {editingAgreement.aiGenerated ? (
                  <p className="mt-1 text-[11px] font-semibold text-[#8a6400]">
                    This draft started from AI-generated text — review every clause
                    before sending for signature.
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                className="rounded-lg p-1 text-[var(--muted)] hover:bg-[var(--surface-sunken)]"
                aria-label="Close editor"
                onClick={() => closeEditor()}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
              {editDirty ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  You have unsaved changes. Use <strong>AI: Align with CBSE norms</strong> to
                  expand or improve the draft per standard CBSE private-school agreements.
                </div>
              ) : null}

              <label className="block text-xs font-semibold text-[var(--muted)]">
                Title
                <input
                  className={`${field} mt-1 !py-2`}
                  value={editTitle}
                  onChange={(e) => {
                    setEditTitle(e.target.value);
                    setEditDirty(true);
                  }}
                />
              </label>

              <label className="block text-xs font-semibold text-[var(--muted)]">
                Agreement text
                <textarea
                  className={`${field} mt-1 min-h-[240px] !py-2 text-xs leading-relaxed`}
                  value={editBody}
                  onChange={(e) => {
                    setEditBody(e.target.value);
                    setEditDirty(true);
                  }}
                />
              </label>

              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] p-3">
                <p className="text-xs font-semibold text-[var(--brand-deep)]">
                  AI assist (CBSE alignment)
                </p>
                <p className="mt-1 text-[11px] text-[var(--muted)]">
                  Revises your draft to match clauses used in CBSE-affiliated schools — child
                  safety, POCSO, conduct, notice period, disciplinary action, etc.
                </p>
                <label className="mt-2 block text-[11px] font-semibold text-[var(--muted)]">
                  Output language
                  <select
                    className={`${field} mt-1 !py-2 text-xs`}
                    value={aiLanguage}
                    onChange={(e) => setAiLanguage(e.target.value as AiLanguage)}
                  >
                    <option value="en">English</option>
                    <option value="hi">Hindi (हिन्दी)</option>
                    <option value="both">English + Hindi</option>
                  </select>
                </label>
                <label className="mt-2 block text-[11px] font-semibold text-[var(--muted)]">
                  What should AI change? (optional)
                  <input
                    className={`${field} mt-1 !py-2 text-xs`}
                    value={aiReviseNote}
                    onChange={(e) => setAiReviseNote(e.target.value)}
                    placeholder="e.g. Add 90-day notice for senior teachers, mention summer camp duties…"
                  />
                </label>
                <button
                  type="button"
                  className={`${btnOutline} mt-2`}
                  disabled={aiLoading || !editBody.trim()}
                  onClick={() => void onAiReviseDraft()}
                >
                  <Sparkles className="mr-1 inline h-4 w-4" />
                  {aiLoading ? "Revising…" : "AI: Align with CBSE norms"}
                </button>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 border-t border-[var(--border)] px-5 py-4">
              <button type="button" className={btn} onClick={onSaveDraft}>
                Save draft
              </button>
              <button
                type="button"
                className={btnOutline}
                onClick={() => void onSend(editingAgreement.id)}
              >
                <Send className="mr-1 inline h-4 w-4" />
                Send to staff
              </button>
              <button type="button" className={btnOutline} onClick={() => closeEditor()}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Compact self-service block for My docs tab */
export function StaffAgreementSelfPanel() {
  return <StaffAgreementPanel mode="self" />;
}
