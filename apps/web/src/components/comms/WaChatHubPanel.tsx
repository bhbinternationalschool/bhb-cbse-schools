"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  WA_CHAT_CATEGORIES,
  type WaChatCategory,
} from "@/lib/waChatCategories";
import { loadWaTemplates, type WaTemplate } from "@/lib/waTemplates";
import {
  MastersTableCard,
  MastersWorkCard,
} from "@/components/masters/MastersLayout";

type HubMessage = {
  id: string;
  direction: "in" | "out";
  role: string;
  text: string;
  at: string;
  by: string;
};

type HubThread = {
  id: string;
  mobile: string;
  displayName: string;
  category: WaChatCategory;
  categoryLabel: string;
  status: string;
  unreadStaff: number;
  messages: HubMessage[];
  updatedAt: string;
  lastInText: string;
  lastOutText: string;
};

type HubStats = {
  totalThreads: number;
  unreadTotal: number;
  byCategory: Record<
    WaChatCategory,
    { threads: number; unread: number }
  >;
};

type DocVerificationField = {
  field: string;
  status: "match" | "mismatch" | "missing_ocr" | "missing_record" | "skipped";
  detail?: string;
};

type DocVerificationOcrResult = {
  verdict: "likely_match" | "review" | "likely_mismatch" | "unreadable";
  fields: DocVerificationField[];
  ocrTextPreview?: string;
};

type InboundMediaItem = {
  id: string;
  waMessageId: string | null;
  mobileE164: string;
  contactName: string | null;
  mediaId: string;
  mediaType: "image" | "document" | "video" | "audio";
  mimeType: string | null;
  filename: string | null;
  caption: string | null;
  householdId: string | null;
  receivedAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  ocrResult: DocVerificationOcrResult | null;
  householdChildren: { id: string; name: string }[];
};

const STUDENT_DOC_KEYS: { value: string; label: string }[] = [
  { value: "birthCert", label: "Birth certificate" },
  { value: "photo", label: "Photo" },
  { value: "aadhaar", label: "Aadhaar" },
  { value: "addressProof", label: "Address proof" },
  { value: "tc", label: "Transfer certificate" },
  { value: "casteCert", label: "Caste certificate" },
  { value: "incomeCert", label: "Income certificate" },
];

const STAFF_DOC_KEYS: { value: string; label: string }[] = [
  { value: "photo", label: "Photo" },
  { value: "aadhaar", label: "Aadhaar" },
  { value: "pan", label: "PAN" },
  { value: "addressProof", label: "Address proof" },
  { value: "educationCert", label: "Education certificate" },
  { value: "experienceCert", label: "Experience certificate" },
  { value: "medicalCert", label: "Medical certificate" },
  { value: "policeVerification", label: "Police verification" },
  { value: "joiningLetter", label: "Joining letter" },
  { value: "contract", label: "Contract" },
  { value: "drivingLicense", label: "Driving license" },
  { value: "other", label: "Other" },
];

const inp =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm";

export function WaChatHubPanel({
  by,
  canEdit,
}: {
  by: string;
  canEdit: boolean;
}) {
  const [category, setCategory] = useState<WaChatCategory | "all">("all");
  const [threads, setThreads] = useState<HubThread[]>([]);
  const [stats, setStats] = useState<HubStats | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [approvedTemplates, setApprovedTemplates] = useState<WaTemplate[]>([]);
  const [busy, setBusy] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [mediaItems, setMediaItems] = useState<InboundMediaItem[]>([]);
  const [mediaShowAll, setMediaShowAll] = useState(false);
  const [mediaVisionOn, setMediaVisionOn] = useState(false);
  const [mediaUi, setMediaUi] = useState<
    Record<
      string,
      {
        previewDataUrl?: string;
        previewMime?: string;
        previewLoading?: boolean;
        previewError?: string;
        subject: "student" | "staff";
        subjectId: string;
        docKey: string;
        ocrLoading?: boolean;
        ocrError?: string;
        busy?: boolean;
      }
    >
  >({});

  function mediaState(id: string) {
    return (
      mediaUi[id] || {
        subject: "student" as const,
        subjectId: "",
        docKey: STUDENT_DOC_KEYS[0].value,
      }
    );
  }
  function patchMediaUi(id: string, patch: Partial<ReturnType<typeof mediaState>>) {
    setMediaUi((prev) => ({ ...prev, [id]: { ...mediaState(id), ...patch } }));
  }

  useEffect(() => {
    const tpl = loadWaTemplates();
    setApprovedTemplates(
      tpl.templates.filter((t) => t.status === "approved" && !t.paused),
    );
  }, []);

  const refresh = useCallback(async () => {
    try {
      const q =
        category === "all" ? "" : `?category=${encodeURIComponent(category)}`;
      const res = await fetch(`/api/wa/hub${q}`);
      if (!res.ok) return;
      const json = (await res.json()) as {
        threads?: HubThread[];
        stats?: HubStats;
        outboundConfigured?: boolean;
      };
      setThreads(Array.isArray(json.threads) ? json.threads : []);
      setStats(json.stats ?? null);
      setConfigured(!!json.outboundConfigured);
    } catch {
      /* offline */
    }
  }, [category]);

  useEffect(() => {
    void refresh();
    const t = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(t);
  }, [refresh]);

  const refreshMedia = useCallback(async () => {
    try {
      const q = mediaShowAll ? "" : "?pending=1";
      const res = await fetch(`/api/wa/inbound-media${q}`);
      if (!res.ok) return;
      const json = (await res.json()) as {
        items?: InboundMediaItem[];
        visionConfigured?: boolean;
      };
      setMediaItems(Array.isArray(json.items) ? json.items : []);
      setMediaVisionOn(!!json.visionConfigured);
    } catch {
      /* offline */
    }
  }, [mediaShowAll]);

  useEffect(() => {
    void refreshMedia();
    const t = window.setInterval(() => void refreshMedia(), 30_000);
    return () => window.clearInterval(t);
  }, [refreshMedia]);

  async function viewMedia(item: InboundMediaItem) {
    patchMediaUi(item.id, { previewLoading: true, previewError: undefined });
    try {
      const res = await fetch("/api/wa/inbound-media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "view", id: item.id }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        dataUrl?: string;
        mimeType?: string;
        error?: string;
      };
      if (!res.ok || !json.dataUrl) {
        patchMediaUi(item.id, {
          previewLoading: false,
          previewError: json.error || "Could not fetch media",
        });
        return;
      }
      patchMediaUi(item.id, {
        previewLoading: false,
        previewDataUrl: json.dataUrl,
        previewMime: json.mimeType,
      });
    } catch (e) {
      patchMediaUi(item.id, {
        previewLoading: false,
        previewError: e instanceof Error ? e.message : "Could not fetch media",
      });
    }
  }

  async function markMediaReviewed(item: InboundMediaItem) {
    patchMediaUi(item.id, { busy: true });
    try {
      await fetch("/api/wa/inbound-media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "markReviewed", id: item.id, by }),
      }).catch(() => null);
      await refreshMedia();
    } finally {
      patchMediaUi(item.id, { busy: false });
    }
  }

  async function runMediaOcr(item: InboundMediaItem) {
    const st = mediaState(item.id);
    if (!st.subjectId) {
      patchMediaUi(item.id, { ocrError: "Pick who this document belongs to" });
      return;
    }
    patchMediaUi(item.id, { ocrLoading: true, ocrError: undefined });
    try {
      const res = await fetch("/api/wa/inbound-media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "runOcr",
          id: item.id,
          subject: st.subject,
          subjectId: st.subjectId,
          docKey: st.docKey,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !json.ok) {
        patchMediaUi(item.id, {
          ocrLoading: false,
          ocrError: json.error || "OCR check failed",
        });
        return;
      }
      patchMediaUi(item.id, { ocrLoading: false });
      await refreshMedia();
    } catch (e) {
      patchMediaUi(item.id, {
        ocrLoading: false,
        ocrError: e instanceof Error ? e.message : "OCR check failed",
      });
    }
  }

  const selected = threads.find((t) => t.id === selectedId) || null;

  const categoryChips = useMemo(() => {
    const chips: { id: WaChatCategory | "all"; label: string; unread: number }[] =
      [
        {
          id: "all",
          label: "All",
          unread: stats?.unreadTotal ?? 0,
        },
      ];
    for (const c of WA_CHAT_CATEGORIES) {
      chips.push({
        id: c.id,
        label: c.short,
        unread: stats?.byCategory?.[c.id]?.unread ?? 0,
      });
    }
    return chips;
  }, [stats]);

  async function openThread(t: HubThread) {
    setSelectedId(t.id);
    setSummary(null);
    setSummaryError(null);
    if (t.unreadStaff > 0) {
      await fetch("/api/wa/hub", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "markRead",
          mobile: t.mobile,
          category: t.category,
        }),
      }).catch(() => null);
      void refresh();
    }
  }

  async function sendReply() {
    if (!selected || !canEdit || busy) return;
    const text = reply.trim();
    if (!text) return;
    setBusy(true);
    try {
      const res = await fetch("/api/wa/hub", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reply",
          threadId: selected.id,
          text,
          by,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        alert(json.error || "Send failed");
        return;
      }
      setReply("");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function summarizeThread() {
    if (!selected) return;
    setSummaryLoading(true);
    setSummaryError(null);
    setSummary(null);
    try {
      const res = await fetch("/api/ai/thread-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categoryLabel: selected.categoryLabel,
          contactName: selected.displayName || selected.mobile,
          messages: selected.messages.map((m) => ({
            direction: m.direction,
            role: m.role,
            text: m.text,
            at: m.at,
          })),
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        summary?: string;
      };
      if (!json.ok || !json.summary) {
        setSummaryError(json.error || "Summary failed");
        return;
      }
      setSummary(json.summary);
    } catch (e) {
      setSummaryError(e instanceof Error ? e.message : "Summary failed");
    } finally {
      setSummaryLoading(false);
    }
  }

  async function sendTemplate() {
    if (!selected || !canEdit || busy || !templateId) return;
    const tpl = approvedTemplates.find((t) => t.id === templateId);
    if (!tpl) return;
    setBusy(true);
    try {
      const res = await fetch("/api/wa/hub", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "sendTemplate",
          threadId: selected.id,
          by,
          template: {
            name: tpl.metaName,
            language: tpl.metaLanguage || tpl.language,
            variableKeys: tpl.variables,
            variables: Object.fromEntries(
              tpl.variables.map((k) => [k, ""]),
            ),
            previewText: tpl.localFallbackBody || tpl.body,
          },
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        alert(json.error || "Template send failed");
        return;
      }
      setTemplateId("");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const selectedTemplate = approvedTemplates.find((t) => t.id === templateId);

  return (
    <div className="space-y-4">
      <p className="text-[12px] text-[var(--muted)]">
        School WhatsApp hub — messages grouped by{" "}
        <strong>parents, staff, admission, jobs, vendors, transport</strong>, etc.
        Bot sends <strong>buttons & list rows</strong> when Meta allows; falls back to
        text keywords.{" "}
        {configured ? (
          <span className="text-[#166534]">Outbound API on.</span>
        ) : (
          <span className="text-[#9a3412]">WhatsApp is not configured yet.</span>
        )}
      </p>

      <div className="flex flex-wrap gap-1.5">
        {categoryChips.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => {
              setCategory(c.id);
              setSelectedId(null);
            }}
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
              category === c.id
                ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                : "border border-[var(--border)] bg-[var(--card)]"
            }`}
          >
            {c.label}
            {c.unread > 0 ? ` · ${c.unread}` : ""}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <MastersTableCard title="Received · by category">
          {threads.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-[var(--muted)]">
              No WhatsApp threads yet — parents/staff message +91 94519 38805.
            </div>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {threads.map((t) => (
                <li key={`${t.category}-${t.id}`}>
                  <button
                    type="button"
                    className={`flex w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-[var(--surface-sunken)] ${
                      selectedId === t.id ? "bg-[rgba(21,128,61,0.1)]" : ""
                    }`}
                    onClick={() => void openThread(t)}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-[13px] font-semibold text-[var(--brand-deep)]">
                        {t.displayName || "Contact"} · {t.mobile}
                      </span>
                      {t.unreadStaff > 0 ? (
                        <span className="rounded-full bg-[#0f766e] px-1.5 text-[10px] font-bold text-white">
                          {t.unreadStaff}
                        </span>
                      ) : null}
                    </span>
                    <span className="text-[10px] font-medium text-[#0f766e]">
                      {t.categoryLabel} · {t.status}
                    </span>
                    <span className="line-clamp-1 text-[11px] text-[var(--muted)]">
                      In: {t.lastInText || "—"}
                    </span>
                    <span className="line-clamp-1 text-[11px] text-[var(--muted)]">
                      Bot/staff: {t.lastOutText || "—"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </MastersTableCard>

        <MastersWorkCard
          title={
            selected
              ? `${selected.categoryLabel} · ${selected.displayName || selected.mobile}`
              : "Conversation"
          }
          hint={
            selected
              ? `Updated ${selected.updatedAt.slice(0, 16).replace("T", " ")}`
              : "Select a thread"
          }
        >
          {!selected ? (
            <p className="text-[12px] text-[var(--muted)]">
              Choose a thread to see parent/staff messages (in) and bot replies
              (out).
            </p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  disabled={summaryLoading}
                  onClick={() => void summarizeThread()}
                  className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-[11px] font-semibold text-[var(--brand-deep)] disabled:opacity-50"
                >
                  {summaryLoading
                    ? "Summarizing…"
                    : summary
                      ? "Re-summarize"
                      : "Summarize with AI"}
                </button>
              </div>
              {summaryError ? (
                <p className="text-[11px] text-[var(--danger)]">{summaryError}</p>
              ) : null}
              {summary ? (
                <div className="rounded-lg border border-[rgba(197,160,40,0.3)] bg-[rgba(197,160,40,0.08)] px-3 py-2 text-[12px] text-[var(--ink)]">
                  {summary}
                </div>
              ) : null}
              <div className="max-h-80 space-y-2 overflow-y-auto rounded-lg border border-[var(--border)] bg-[rgba(248,248,240,0.6)] p-2">
                {selected.messages.map((m) => (
                  <div
                    key={m.id}
                    className={`rounded-lg px-2 py-1.5 text-[12px] whitespace-pre-wrap ${
                      m.direction === "in"
                        ? "bg-[var(--card)] border-l-2 border-[#0f766e]"
                        : m.role === "staff"
                          ? "bg-[rgba(15,118,110,0.15)]"
                          : "bg-[var(--surface-sunken)] border-l-2 border-[#64748b]"
                    }`}
                  >
                    <p className="text-[9px] font-semibold uppercase text-[var(--muted)]">
                      {m.direction === "in" ? "Received" : "Bot / staff"} ·{" "}
                      {m.by || "—"} · {m.at.slice(11, 16)}
                    </p>
                    {m.text}
                  </div>
                ))}
              </div>
              {canEdit ? (
                <div className="space-y-2 border-t border-[var(--border)] pt-3">
                  <textarea
                    className={`${inp} min-h-[72px]`}
                    placeholder={`Reply on WhatsApp (${selected.categoryLabel})…`}
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                  />
                  <button
                    type="button"
                    disabled={busy || !reply.trim()}
                    className="rounded-lg bg-[var(--primary)] px-3 py-2 text-[11px] font-semibold text-[var(--primary-foreground)] disabled:opacity-60"
                    onClick={() => void sendReply()}
                  >
                    {busy ? "Sending…" : "Send free-text"}
                  </button>
                  <p className="text-[10px] text-[var(--muted)]">
                    Free-text works within 24h of the contact&apos;s last message.
                    Outside that window, use an approved Meta template.
                  </p>
                  <label className="block text-[11px] font-semibold text-[var(--muted)]">
                    Approved Meta template
                    <select
                      className={`${inp} mt-1`}
                      value={templateId}
                      onChange={(e) => setTemplateId(e.target.value)}
                    >
                      <option value="">None</option>
                      {approvedTemplates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} ({t.language}) · {t.metaName}
                        </option>
                      ))}
                    </select>
                  </label>
                  {approvedTemplates.length === 0 ? (
                    <p className="text-[10px] text-amber-800">
                      No approved templates — sync in Masters → WhatsApp templates.
                    </p>
                  ) : null}
                  {selectedTemplate ? (
                    <p className="whitespace-pre-wrap rounded-lg bg-[var(--surface-sunken)] p-2 text-[10px] text-[var(--muted)]">
                      {selectedTemplate.localFallbackBody || selectedTemplate.body}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    disabled={busy || !templateId}
                    className="rounded-lg border border-[var(--brand-deep)] px-3 py-2 text-[11px] font-semibold text-[var(--brand-deep)] disabled:opacity-60"
                    onClick={() => void sendTemplate()}
                  >
                    {busy ? "Sending…" : "Send template"}
                  </button>
                </div>
              ) : (
                <p className="text-[11px] text-[var(--muted)]">
                  Read-only — you need comms edit access to reply.
                </p>
              )}
            </div>
          )}
        </MastersWorkCard>
      </div>

      <MastersTableCard title="Documents received">
        <div className="flex items-center justify-end gap-2 border-b border-[var(--border)] px-3 py-2">
          {!mediaVisionOn ? (
            <span className="text-[10px] text-amber-800">
              Vision OCR not configured
            </span>
          ) : null}
          <label className="flex items-center gap-1 text-[10px] font-semibold text-[var(--muted)]">
            <input
              type="checkbox"
              checked={mediaShowAll}
              onChange={(e) => setMediaShowAll(e.target.checked)}
            />
            Show reviewed too
          </label>
        </div>
        {mediaItems.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-[var(--muted)]">
            No {mediaShowAll ? "" : "pending "}photos/PDFs from parents or staff yet
            — Aadhaar, birth certificate, payment proof etc. sent on WhatsApp
            land here.
          </div>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {mediaItems.map((item) => {
              const ui = mediaState(item.id);
              const docKeys =
                ui.subject === "student" ? STUDENT_DOC_KEYS : STAFF_DOC_KEYS;
              return (
                <li key={item.id} className="space-y-2 px-3 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-[13px] font-semibold text-[var(--brand-deep)]">
                        {item.contactName || item.mobileE164} · {item.mobileE164}
                      </p>
                      <p className="text-[11px] text-[var(--muted)]">
                        {item.mediaType} · {item.filename || item.mimeType || "file"}
                        {" · "}
                        {item.receivedAt.slice(0, 16).replace("T", " ")}
                        {item.reviewedAt ? ` · reviewed by ${item.reviewedBy}` : ""}
                      </p>
                      {item.caption ? (
                        <p className="text-[11px] text-[var(--muted)]">
                          &ldquo;{item.caption}&rdquo;
                        </p>
                      ) : null}
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        disabled={ui.previewLoading}
                        onClick={() => void viewMedia(item)}
                        className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-[11px] font-semibold text-[var(--brand-deep)] disabled:opacity-50"
                      >
                        {ui.previewLoading ? "Loading…" : "View"}
                      </button>
                      {canEdit && !item.reviewedAt ? (
                        <button
                          type="button"
                          disabled={ui.busy}
                          onClick={() => void markMediaReviewed(item)}
                          className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-[11px] font-semibold text-[var(--muted)] disabled:opacity-50"
                        >
                          Mark reviewed
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {ui.previewError ? (
                    <p className="text-[11px] text-[var(--danger)]">{ui.previewError}</p>
                  ) : null}
                  {ui.previewDataUrl ? (
                    ui.previewMime?.startsWith("image/") ? (
                      <img
                        src={ui.previewDataUrl}
                        alt="Inbound document"
                        className="max-h-64 rounded-lg border border-[var(--border)]"
                      />
                    ) : (
                      <a
                        href={ui.previewDataUrl}
                        download={item.filename || "document"}
                        className="text-[11px] font-semibold text-[var(--brand-deep)] underline"
                      >
                        Download {item.filename || "document"}
                      </a>
                    )
                  ) : null}

                  {canEdit && mediaVisionOn ? (
                    <div className="flex flex-wrap items-center gap-1.5 border-t border-[var(--border)] pt-2">
                      <select
                        className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-[11px]"
                        value={ui.subject}
                        onChange={(e) =>
                          patchMediaUi(item.id, {
                            subject: e.target.value as "student" | "staff",
                            subjectId: "",
                            docKey:
                              e.target.value === "student"
                                ? STUDENT_DOC_KEYS[0].value
                                : STAFF_DOC_KEYS[0].value,
                          })
                        }
                      >
                        <option value="student">Student</option>
                        <option value="staff">Staff</option>
                      </select>
                      {ui.subject === "student" ? (
                        <select
                          className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-[11px]"
                          value={ui.subjectId}
                          onChange={(e) =>
                            patchMediaUi(item.id, { subjectId: e.target.value })
                          }
                        >
                          <option value="">
                            {item.householdChildren.length
                              ? "Select child"
                              : "No linked household found"}
                          </option>
                          {item.householdChildren.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-[11px]"
                          placeholder="Staff ID"
                          value={ui.subjectId}
                          onChange={(e) =>
                            patchMediaUi(item.id, { subjectId: e.target.value })
                          }
                        />
                      )}
                      <select
                        className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-[11px]"
                        value={ui.docKey}
                        onChange={(e) =>
                          patchMediaUi(item.id, { docKey: e.target.value })
                        }
                      >
                        {docKeys.map((d) => (
                          <option key={d.value} value={d.value}>
                            {d.label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={ui.ocrLoading}
                        onClick={() => void runMediaOcr(item)}
                        className="rounded-lg bg-[var(--primary)] px-2.5 py-1 text-[11px] font-semibold text-[var(--primary-foreground)] disabled:opacity-60"
                      >
                        {ui.ocrLoading ? "Checking…" : "Run OCR check"}
                      </button>
                    </div>
                  ) : null}
                  {ui.ocrError ? (
                    <p className="text-[11px] text-[var(--danger)]">{ui.ocrError}</p>
                  ) : null}
                  {item.ocrResult ? (
                    <div
                      className={`rounded-lg border px-2.5 py-1.5 text-[11px] ${
                        item.ocrResult.verdict === "likely_match"
                          ? "border-[var(--success)]/30 bg-[var(--success-soft)] text-[var(--success)]"
                          : item.ocrResult.verdict === "likely_mismatch"
                            ? "border-[var(--danger)]/30 bg-[var(--danger-soft)] text-[var(--danger)]"
                            : "border-[var(--warning)]/30 bg-[var(--warning-soft)] text-[var(--warning)]"
                      }`}
                    >
                      <p className="font-semibold uppercase">
                        {item.ocrResult.verdict.replace("_", " ")}
                      </p>
                      <ul className="mt-1 space-y-0.5">
                        {item.ocrResult.fields.map((f) => (
                          <li key={f.field}>
                            {f.field}: {f.status.replace("_", " ")}
                            {f.detail ? ` — ${f.detail}` : ""}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </MastersTableCard>
    </div>
  );
}
