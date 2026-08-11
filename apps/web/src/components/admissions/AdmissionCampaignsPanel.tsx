"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ADMISSION_SOURCES,
  ADMISSION_STAGES,
  captureYear,
  listAcademicYearCodes,
  listCaptureYears,
  type AdmissionsState,
  type AdmissionStage,
} from "@/lib/admissions";
import { type MastersState } from "@/lib/masters";
import {
  CAMPAIGN_TEMPLATES,
  WA_ME_BATCH_CAP,
  campaignMessagesOf,
  createAudienceList,
  createCampaign,
  defaultAudienceFilters,
  defaultTemplateBody,
  deleteAudienceList,
  deleteCampaign,
  dispatchDueCampaigns,
  applyCampaignDispatchResults,
  enqueueCampaignMessages,
  loadWaCampaigns,
  openEnquiryFilters,
  previewCampaignSample,
  publicRegisterUrl,
  refreshListCounts,
  resolveAudienceLeads,
  saveWaCampaigns,
  scheduleCampaign,
  unpaidPartialFilters,
  unpaidRegistrationFilters,
  updateCampaign,
  type AudienceFeeFilterValue,
  type AudienceListFilters,
  type CampaignTemplateKey,
  type WaCampaignsState,
} from "@/lib/waCampaigns";
import {
  listApprovedTemplates,
  loadWaTemplates,
  type WaTemplate,
} from "@/lib/waTemplates";
import {
  MastersEmptyRow,
  MastersTableCard,
  MastersWorkCard,
} from "@/components/masters/MastersLayout";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import type { CampaignMessage } from "@/lib/waCampaigns";

const inp =
  "w-full rounded-lg border border-[rgba(32,48,80,0.15)] bg-white px-3 py-2 text-sm";

type PanelTab = "lists" | "campaigns" | "queue";

const CAMPAIGN_MESSAGE_COLUMNS: DataTableColumn<CampaignMessage>[] = [
  { key: "childName", header: "Child", value: (m) => m.childName, sortable: true },
  {
    key: "mobile",
    header: "Mobile",
    value: (m) => m.mobile,
    sortable: true,
    render: (m) => <span className="font-mono">{m.mobile}</span>,
  },
  { key: "status", header: "Status", value: (m) => m.status, sortable: true },
  {
    key: "open",
    header: "Open",
    render: (m) =>
      m.waMeUrl ? (
        <a
          href={m.waMeUrl}
          target="_blank"
          rel="noreferrer"
          className="font-semibold underline"
        >
          WhatsApp
        </a>
      ) : (
        m.error || "—"
      ),
  },
];

export function AdmissionCampaignsPanel({
  admissions,
  masters,
  by,
  canEdit,
  onAdmissionsCommit,
}: {
  admissions: AdmissionsState;
  masters: MastersState;
  by: string;
  canEdit: boolean;
  onAdmissionsCommit: (next: AdmissionsState, msg?: string) => void;
}) {
  const [wa, setWa] = useState<WaCampaignsState>(() => loadWaCampaigns());
  const [panel, setPanel] = useState<PanelTab>("lists");
  const [notice, setNotice] = useState<string | null>(null);

  const [listName, setListName] = useState("");
  const [filters, setFilters] = useState<AudienceListFilters>(() =>
    unpaidRegistrationFilters(),
  );

  const [campName, setCampName] = useState("");
  const [campListId, setCampListId] = useState("");
  const [campTemplate, setCampTemplate] =
    useState<CampaignTemplateKey>("registration_invite");
  const [campBody, setCampBody] = useState(() =>
    defaultTemplateBody("registration_invite"),
  );
  const [campRegistryId, setCampRegistryId] = useState("");
  const [campSchedule, setCampSchedule] = useState("");
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(
    null,
  );
  const [approvedTemplates, setApprovedTemplates] = useState<WaTemplate[]>([]);

  useEffect(() => {
    const tpl = loadWaTemplates();
    setApprovedTemplates(listApprovedTemplates(tpl));
  }, []);

  const classes = useMemo(
    () => (masters.classes ?? []).filter((c) => c.isActive),
    [masters],
  );
  const captureYears = useMemo(
    () => listCaptureYears(admissions),
    [admissions],
  );
  const ayCodes = useMemo(
    () => listAcademicYearCodes(admissions),
    [admissions],
  );

  useEffect(() => {
    const refreshed = refreshListCounts(loadWaCampaigns(), admissions);
    setWa(refreshed);
    saveWaCampaigns(refreshed);
  }, [admissions.leads.length]);

  function flash(msg: string) {
    setNotice(msg);
    window.setTimeout(() => setNotice(null), 4000);
  }

  function commitWa(next: WaCampaignsState, msg?: string) {
    saveWaCampaigns(next);
    setWa(next);
    if (msg) flash(msg);
  }

  const matchingLeads = useMemo(
    () => resolveAudienceLeads(admissions, filters),
    [admissions, filters],
  );
  const previewCount = matchingLeads.length;

  const selectedCampaign = wa.campaigns.find((c) => c.id === selectedCampaignId);
  const selectedMessages = selectedCampaignId
    ? campaignMessagesOf(wa, selectedCampaignId)
    : [];

  function toggleInList<T extends string>(
    key:
      | "stages"
      | "feeStatuses"
      | "classSoughtIds"
      | "sources"
      | "captureYears"
      | "academicYearCodes",
    value: T,
  ) {
    setFilters((f) => {
      const cur = f[key] as T[];
      const has = cur.includes(value);
      return {
        ...f,
        [key]: has ? cur.filter((x) => x !== value) : [...cur, value],
      };
    });
  }

  function toggleStage(stage: AdmissionStage) {
    toggleInList("stages", stage);
  }

  function onSaveList() {
    if (!canEdit) return;
    if (!listName.trim()) {
      flash("Name the list");
      return;
    }
    const r = createAudienceList(
      wa,
      { name: listName.trim(), filters },
      by,
      admissions,
    );
    commitWa(r.state, `List “${r.list.name}” · ${r.list.count} contacts`);
    setListName("");
    if (!campListId) setCampListId(r.list.id);
  }

  function onCreateCampaign() {
    if (!canEdit) return;
    const reg = approvedTemplates.find((t) => t.id === campRegistryId);
    const r = createCampaign(
      wa,
      {
        name: campName || "Untitled campaign",
        listId: campListId || wa.lists[0]?.id || "",
        templateKey: campTemplate,
        body: campBody,
        scheduledAt: campSchedule,
        registryTemplateId: reg?.id || "",
        registryMetaName: reg?.metaName || "",
        registryLanguage: reg?.metaLanguage || reg?.language || "",
      },
      by,
    );
    if (!r.ok) {
      flash(r.reason);
      return;
    }
    commitWa(r.state, `Campaign “${r.campaign.name}” created`);
    setSelectedCampaignId(r.campaign.id);
    setCampName("");
    setPanel("campaigns");
  }

  function onEnqueue(campaignId: string) {
    if (!canEdit) return;
    const r = enqueueCampaignMessages(wa, campaignId, admissions, by);
    if (!r.ok) {
      flash(r.reason);
      return;
    }
    if (r.admissions !== admissions) {
      onAdmissionsCommit(r.admissions, "Pay links prepared for fee reminders");
    }
    commitWa(r.wa, `Queued ${r.queued} messages`);
    setSelectedCampaignId(campaignId);
    setPanel("queue");
  }

  function onSchedule(campaignId: string) {
    if (!canEdit) return;
    const when =
      campSchedule ||
      wa.campaigns.find((c) => c.id === campaignId)?.scheduledAt ||
      "";
    const r = scheduleCampaign(wa, campaignId, when, admissions, by);
    if (!r.ok) {
      flash(r.reason);
      return;
    }
    if (r.admissions !== admissions) {
      onAdmissionsCommit(r.admissions, "Pay links prepared");
    }
    commitWa(r.wa, `Scheduled · queued ${r.queued}`);
    setPanel("queue");
  }

  function onDispatch(openWaMe: boolean) {
    if (!canEdit) return;
    void (async () => {
      if (openWaMe) {
        const r = dispatchDueCampaigns(wa, { openWaMe: true });
        commitWa(r.wa, r.note);
        for (const url of r.opened) {
          window.open(url, "_blank", "noopener,noreferrer");
        }
        return;
      }

      // Prefer live Meta/BSP when configured; otherwise stub-mark for demo
      const prepared = dispatchDueCampaigns(wa, { stubMarkSent: false });
      if (prepared.pending.length === 0) {
        commitWa(prepared.wa, prepared.note);
        return;
      }

      try {
        const health = await fetch("/api/integrations/health").then((r) =>
          r.json(),
        );
        const live = !!health?.whatsappOutbound;
        if (!live) {
          const stub = dispatchDueCampaigns(wa, { stubMarkSent: true });
          commitWa(stub.wa, stub.note);
          return;
        }

        const res = await fetch("/api/wa/dispatch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            dryRun: false,
            messages: prepared.pending.slice(0, 100).map((m) => ({
              messageId: m.id,
              mobile: m.mobile,
              body: m.body,
              ...(m.templateName
                ? {
                    template: {
                      name: m.templateName,
                      language: m.templateLanguage || "en",
                    },
                  }
                : {}),
            })),
          }),
        });
        const body = (await res.json()) as {
          mode?: string;
          sent?: number;
          failed?: number;
          results?: {
            messageId?: string;
            status: string;
            error?: string;
          }[];
          hint?: string;
        };
        if (!res.ok) {
          flash(body.hint || "Dispatch failed");
          return;
        }
        if (body.mode === "stub" || body.mode === "dry_run") {
          const stub = dispatchDueCampaigns(wa, { stubMarkSent: true });
          commitWa(
            stub.wa,
            `API returned ${body.mode} — ${stub.note}`,
          );
          return;
        }
        const next = applyCampaignDispatchResults(
          prepared.wa,
          body.results || [],
        );
        commitWa(
          next,
          `Live WhatsApp · sent ${body.sent ?? 0} · failed ${body.failed ?? 0}`,
        );
      } catch {
        flash("Could not reach WhatsApp dispatch API");
      }
    })();
  }

  return (
    <div className="space-y-4">
      <p className="rounded-lg border border-[rgba(32,48,80,0.12)] bg-[rgba(248,248,240,0.8)] px-3 py-2 text-[11px] text-[var(--muted)]">
        Campaigns push registration/pay links to CRM parents. Two-way chat uses
        the <strong>CRM parent chat → WhatsApp bot</strong> tab. Keywords: FEE ·
        REGISTER · DOCS · STATUS · VISIT · HUMAN.
      </p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-[var(--muted)]">
          Audience lists → multiple campaigns with schedule → broadcast queue.
          When Meta/BSP is configured, <strong>Dispatch due (live)</strong>{" "}
          sends via Cloud API; otherwise stub-mark or open WhatsApp (max{" "}
          {WA_ME_BATCH_CAP}).
        </p>
        <a
          href={publicRegisterUrl()}
          className="text-[11px] font-semibold text-[var(--brand-deep)] underline"
          target="_blank"
          rel="noreferrer"
        >
          Parent self-register →
        </a>
      </div>

      {notice ? (
        <p className="rounded-lg border border-[rgba(22,101,52,0.25)] bg-[rgba(22,101,52,0.08)] px-3 py-2 text-[12px] text-[#166534]">
          {notice}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {(
          [
            ["lists", "Audience lists"],
            ["campaigns", "Campaigns"],
            ["queue", "Queue & dispatch"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setPanel(id)}
            className={`rounded-full px-3 py-1.5 text-[11px] font-semibold ${
              panel === id
                ? "bg-[var(--brand-deep)] text-white"
                : "bg-[rgba(32,48,80,0.06)] text-[var(--muted)]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {panel === "lists" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <MastersWorkCard
            title="Build list"
            hint="Filter CRM leads · save as reusable audience"
          >
            <div className="space-y-3">
              <label className="block text-[11px] font-semibold text-[var(--muted)]">
                List name *
                <input
                  className={`${inp} mt-1`}
                  value={listName}
                  onChange={(e) => setListName(e.target.value)}
                  placeholder="e.g. Unpaid Nursery registration"
                />
              </label>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  className="rounded-md border border-[rgba(32,48,80,0.15)] px-2 py-1 text-[10px] font-semibold"
                  onClick={() => setFilters(unpaidRegistrationFilters())}
                >
                  Unpaid registered
                </button>
                <button
                  type="button"
                  className="rounded-md border border-[rgba(32,48,80,0.15)] px-2 py-1 text-[10px] font-semibold"
                  onClick={() => setFilters(unpaidPartialFilters())}
                >
                  Partial fee
                </button>
                <button
                  type="button"
                  className="rounded-md border border-[rgba(32,48,80,0.15)] px-2 py-1 text-[10px] font-semibold"
                  onClick={() => setFilters(openEnquiryFilters())}
                >
                  Open enquiries
                </button>
                <button
                  type="button"
                  className="rounded-md border border-[rgba(32,48,80,0.15)] px-2 py-1 text-[10px] font-semibold"
                  onClick={() => setFilters(defaultAudienceFilters())}
                >
                  Clear filters
                </button>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase text-[var(--muted)]">
                  Stages (multi)
                </p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {ADMISSION_STAGES.filter((s) => s.value !== "lost").map(
                    (s) => (
                      <button
                        key={s.value}
                        type="button"
                        onClick={() => toggleStage(s.value)}
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          filters.stages.includes(s.value)
                            ? "bg-[var(--brand-deep)] text-white"
                            : "bg-[rgba(32,48,80,0.06)] text-[var(--muted)]"
                        }`}
                      >
                        {s.label}
                      </button>
                    ),
                  )}
                </div>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase text-[var(--muted)]">
                  Fee status (multi)
                </p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {(
                    [
                      ["unpaid", "Unpaid"],
                      ["partial", "Partial"],
                      ["pending", "Pending UPI"],
                      ["paid", "Paid"],
                      ["waived", "Waived"],
                    ] as const
                  ).map(([v, label]) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => toggleInList("feeStatuses", v)}
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        filters.feeStatuses.includes(v)
                          ? "bg-[var(--brand-deep)] text-white"
                          : "bg-[rgba(32,48,80,0.06)] text-[var(--muted)]"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase text-[var(--muted)]">
                  Enquiry year (multi · newer first in list)
                </p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {captureYears.length === 0 ? (
                    <span className="text-[10px] text-[var(--muted)]">
                      No leads yet
                    </span>
                  ) : (
                    captureYears.map((y) => (
                      <button
                        key={y}
                        type="button"
                        onClick={() => toggleInList("captureYears", y)}
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          filters.captureYears.includes(y)
                            ? "bg-[var(--brand-deep)] text-white"
                            : "bg-[rgba(32,48,80,0.06)] text-[var(--muted)]"
                        }`}
                      >
                        {y}
                      </button>
                    ))
                  )}
                </div>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase text-[var(--muted)]">
                  Academic session (multi)
                </p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {ayCodes.map((ay) => (
                    <button
                      key={ay}
                      type="button"
                      onClick={() => toggleInList("academicYearCodes", ay)}
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        filters.academicYearCodes.includes(ay)
                          ? "bg-[var(--brand-deep)] text-white"
                          : "bg-[rgba(32,48,80,0.06)] text-[var(--muted)]"
                      }`}
                    >
                      {ay}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase text-[var(--muted)]">
                  Class (multi)
                </p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {classes.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleInList("classSoughtIds", c.id)}
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        filters.classSoughtIds.includes(c.id)
                          ? "bg-[var(--brand-deep)] text-white"
                          : "bg-[rgba(32,48,80,0.06)] text-[var(--muted)]"
                      }`}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase text-[var(--muted)]">
                  Source (multi)
                </p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {ADMISSION_SOURCES.map((s) => (
                    <button
                      key={s.value}
                      type="button"
                      onClick={() => toggleInList("sources", s.value)}
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        filters.sources.includes(s.value)
                          ? "bg-[var(--brand-deep)] text-white"
                          : "bg-[rgba(32,48,80,0.06)] text-[var(--muted)]"
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
              <label className="block text-[11px] font-semibold text-[var(--muted)]">
                Locality contains
                <input
                  className={`${inp} mt-1`}
                  value={filters.localityContains}
                  onChange={(e) =>
                    setFilters((f) => ({
                      ...f,
                      localityContains: e.target.value,
                    }))
                  }
                />
              </label>
              <p className="text-[12px] font-semibold text-[var(--brand-deep)]">
                Matching now: {previewCount} · ordered newer year / date first
              </p>
              {matchingLeads.length > 0 ? (
                <ul className="max-h-36 overflow-y-auto rounded-lg border border-[rgba(32,48,80,0.1)] bg-white text-[11px]">
                  {matchingLeads.slice(0, 12).map((l) => (
                    <li
                      key={l.id}
                      className="flex justify-between gap-2 border-b border-[rgba(32,48,80,0.06)] px-2 py-1 last:border-0"
                    >
                      <span className="font-medium text-[var(--brand-deep)]">
                        {l.childName}
                      </span>
                      <span className="shrink-0 text-[var(--muted)]">
                        {captureYear(l)} · {(l.leadDate || "").slice(0, 10) || "—"}
                      </span>
                    </li>
                  ))}
                  {matchingLeads.length > 12 ? (
                    <li className="px-2 py-1 text-[var(--muted)]">
                      +{matchingLeads.length - 12} more…
                    </li>
                  ) : null}
                </ul>
              ) : null}
              {canEdit ? (
                <button
                  type="button"
                  className="rounded-lg bg-[#0f766e] px-3 py-2 text-[11px] font-semibold text-white"
                  onClick={onSaveList}
                >
                  Save audience list
                </button>
              ) : null}
            </div>
          </MastersWorkCard>

          <MastersTableCard title="Saved lists">
            {wa.lists.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-[var(--muted)]">
                No lists yet — build one from filters.
              </div>
            ) : (
              <ul className="divide-y divide-[rgba(32,48,80,0.08)]">
                {wa.lists.map((list) => (
                  <li
                    key={list.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                  >
                    <div>
                      <p className="text-[13px] font-semibold text-[var(--brand-deep)]">
                        {list.name}
                      </p>
                      <p className="text-[11px] text-[var(--muted)]">
                        {list.count} contacts
                        {list.filters.feeStatuses.length
                          ? ` · fee ${list.filters.feeStatuses.join("+")}`
                          : ""}
                        {list.filters.stages.length
                          ? ` · ${list.filters.stages.join(", ")}`
                          : ""}
                        {list.filters.captureYears.length
                          ? ` · yrs ${list.filters.captureYears.join(",")}`
                          : ""}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="rounded-md border px-2 py-1 text-[10px] font-semibold"
                        onClick={() => {
                          setCampListId(list.id);
                          setPanel("campaigns");
                        }}
                      >
                        Use in campaign
                      </button>
                      {canEdit ? (
                        <button
                          type="button"
                          className="rounded-md border border-[rgba(154,52,18,0.3)] px-2 py-1 text-[10px] font-semibold text-[#9a3412]"
                          onClick={() =>
                            commitWa(
                              deleteAudienceList(wa, list.id),
                              "List deleted",
                            )
                          }
                        >
                          Delete
                        </button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </MastersTableCard>
        </div>
      ) : null}

      {panel === "campaigns" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <MastersWorkCard
            title="New campaign"
            hint="Choose list + template · schedule · enqueue"
          >
            <div className="space-y-3">
              <label className="block text-[11px] font-semibold text-[var(--muted)]">
                Campaign name
                <input
                  className={`${inp} mt-1`}
                  value={campName}
                  onChange={(e) => setCampName(e.target.value)}
                />
              </label>
              <label className="block text-[11px] font-semibold text-[var(--muted)]">
                Audience list *
                <select
                  className={`${inp} mt-1`}
                  value={campListId}
                  onChange={(e) => setCampListId(e.target.value)}
                >
                  <option value="">Select…</option>
                  {wa.lists.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name} ({l.count})
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-[11px] font-semibold text-[var(--muted)]">
                Draft body template
                <select
                  className={`${inp} mt-1`}
                  value={campTemplate}
                  onChange={(e) => {
                    const key = e.target.value as CampaignTemplateKey;
                    setCampTemplate(key);
                    setCampBody(defaultTemplateBody(key));
                  }}
                >
                  {CAMPAIGN_TEMPLATES.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-[11px] font-semibold text-[var(--muted)]">
                Meta approved template (Masters)
                <select
                  className={`${inp} mt-1`}
                  value={campRegistryId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setCampRegistryId(id);
                    const t = approvedTemplates.find((x) => x.id === id);
                    if (t?.localFallbackBody) setCampBody(t.localFallbackBody);
                  }}
                >
                  <option value="">None — free-text / session only</option>
                  {approvedTemplates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.language}) · {t.metaName}
                    </option>
                  ))}
                </select>
              </label>
              {approvedTemplates.length === 0 ? (
                <p className="text-[10px] text-amber-800">
                  No approved Meta templates yet. Sync in Masters → WhatsApp
                  templates (EN/HI catalog). Outside the 24h window, Meta requires
                  an approved template.
                </p>
              ) : null}
              <label className="block text-[11px] font-semibold text-[var(--muted)]">
                Message body
                <textarea
                  className={`${inp} mt-1 min-h-[140px] font-mono text-[11px]`}
                  value={campBody}
                  onChange={(e) => setCampBody(e.target.value)}
                />
              </label>
              <p className="text-[10px] text-[var(--muted)]">
                Vars: childName, guardianName, feeDue, registerLink, payLink,
                schoolName
              </p>
              <label className="block text-[11px] font-semibold text-[var(--muted)]">
                Schedule (Asia/Kolkata)
                <input
                  type="datetime-local"
                  className={`${inp} mt-1`}
                  value={campSchedule}
                  onChange={(e) => setCampSchedule(e.target.value)}
                />
              </label>
              <div className="whitespace-pre-wrap rounded-lg bg-[rgba(32,48,80,0.04)] p-2 text-[11px]">
                {previewCampaignSample({
                  id: "preview",
                  name: campName,
                  listId: campListId,
                  templateKey: campTemplate,
                  body: campBody,
                  status: "draft",
                  scheduledAt: campSchedule,
                  createdAt: "",
                  updatedAt: "",
                  createdBy: "",
                  note: "",
                  registryTemplateId: campRegistryId,
                  registryMetaName:
                    approvedTemplates.find((t) => t.id === campRegistryId)
                      ?.metaName || "",
                  registryLanguage:
                    approvedTemplates.find((t) => t.id === campRegistryId)
                      ?.language || "",
                })}
              </div>
              {canEdit ? (
                <button
                  type="button"
                  className="rounded-lg bg-[var(--brand-deep)] px-3 py-2 text-[11px] font-semibold text-white"
                  onClick={onCreateCampaign}
                >
                  Save campaign
                </button>
              ) : null}
            </div>
          </MastersWorkCard>

          <MastersTableCard title="All campaigns">
            {wa.campaigns.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-[var(--muted)]">
                No campaigns yet.
              </div>
            ) : (
              <ul className="divide-y divide-[rgba(32,48,80,0.08)]">
                {wa.campaigns.map((c) => {
                  const list = wa.lists.find((l) => l.id === c.listId);
                  return (
                    <li key={c.id} className="space-y-2 px-3 py-2">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="text-[13px] font-semibold text-[var(--brand-deep)]">
                            {c.name}
                          </p>
                          <p className="text-[11px] text-[var(--muted)]">
                            {c.status}
                            {c.scheduledAt ? ` · ${c.scheduledAt}` : ""} ·{" "}
                            {list?.name || "no list"}
                          </p>
                        </div>
                        <button
                          type="button"
                          className="rounded-md border px-2 py-1 text-[10px] font-semibold"
                          onClick={() => setSelectedCampaignId(c.id)}
                        >
                          Select
                        </button>
                      </div>
                      {canEdit ? (
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            className="rounded-md bg-[#0f766e] px-2 py-1 text-[10px] font-semibold text-white"
                            onClick={() => onEnqueue(c.id)}
                          >
                            Enqueue
                          </button>
                          <button
                            type="button"
                            className="rounded-md border px-2 py-1 text-[10px] font-semibold"
                            onClick={() => {
                              setCampSchedule(c.scheduledAt || campSchedule);
                              onSchedule(c.id);
                            }}
                          >
                            Schedule + queue
                          </button>
                          <button
                            type="button"
                            className="rounded-md border px-2 py-1 text-[10px] font-semibold"
                            onClick={() => {
                              commitWa(
                                updateCampaign(wa, c.id, { status: "paused" }),
                                "Paused",
                              );
                            }}
                          >
                            Pause
                          </button>
                          <button
                            type="button"
                            className="rounded-md border border-[rgba(154,52,18,0.3)] px-2 py-1 text-[10px] font-semibold text-[#9a3412]"
                            onClick={() =>
                              commitWa(deleteCampaign(wa, c.id), "Deleted")
                            }
                          >
                            Delete
                          </button>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </MastersTableCard>
        </div>
      ) : null}

      {panel === "queue" ? (
        <div className="space-y-4">
          <MastersWorkCard
            title="Dispatch"
            hint="Processes due scheduled campaigns. Configure WhatsApp for live broadcast."
          >
            <div className="flex flex-wrap gap-2">
              {canEdit ? (
                <>
                  <button
                    type="button"
                    className="rounded-lg bg-[var(--brand-deep)] px-3 py-2 text-[11px] font-semibold text-white"
                    onClick={() => onDispatch(false)}
                  >
                    Dispatch due (live / stub)
                  </button>
                  <button
                    type="button"
                    className="rounded-lg bg-[#15803d] px-3 py-2 text-[11px] font-semibold text-white"
                    onClick={() => onDispatch(true)}
                  >
                    Dispatch + open WhatsApp (≤{WA_ME_BATCH_CAP})
                  </button>
                </>
              ) : null}
            </div>
          </MastersWorkCard>

          <MastersTableCard
            title={
              selectedCampaign
                ? `Messages · ${selectedCampaign.name}`
                : "Select a campaign on the Campaigns tab"
            }
          >
            {!selectedCampaign ? (
              <div className="px-4 py-8 text-center text-sm text-[var(--muted)]">
                Select a campaign, then Enqueue.
              </div>
            ) : (
              <DataTable
                columns={CAMPAIGN_MESSAGE_COLUMNS}
                rows={selectedMessages}
                rowKey={(m) => m.id}
                emptyTitle="No messages yet"
                emptyDescription="Click Enqueue on the campaign to build the send queue."
                exportFileBaseName={`campaign-messages-${selectedCampaign.name}`}
                exportTitle={`Messages · ${selectedCampaign.name}`}
                minWidth="min-w-full"
              />
            )}
          </MastersTableCard>
        </div>
      ) : null}
    </div>
  );
}
