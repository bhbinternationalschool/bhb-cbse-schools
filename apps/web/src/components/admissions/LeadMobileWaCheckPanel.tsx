"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { AdmissionLead } from "@/lib/admissions";
import {
  LeadTagListActions,
  type LeadTagListActionHandlers,
} from "@/components/admissions/LeadTagListActions";

/** Indian mobile: 10 digits starting 6–9. */
function isValidIndianMobile(v: string): boolean {
  return /^[6-9]\d{9}$/.test((v || "").trim());
}

/** Number the CRM would use for WhatsApp on this lead. */
function waNumberOf(lead: AdmissionLead): string {
  if (lead.whatsappSame !== false) return lead.mobile || "";
  return lead.whatsapp || lead.mobile || "";
}

type CheckSection =
  | ""
  | "invalid"
  | "wa_diff"
  | "conflicts"
  | "wa_map"
  | "on_wa"
  | "not_on_wa"
  | "wa_unknown";

type ApiHit = {
  status: "on_whatsapp" | "not_on_whatsapp" | "unknown" | "invalid_format";
  waId?: string;
  profileName?: string;
  detail?: string;
};

export function LeadMobileWaCheckPanel({
  leads,
  actions,
  onMergeSameMobile,
  onApplyWhatsAppNames,
  canEdit,
}: {
  leads: AdmissionLead[];
  actions: LeadTagListActionHandlers;
  onMergeSameMobile?: (leadIds: string[]) => void;
  /** Apply WA profile names onto leads for campaign {{guardianName}} */
  onApplyWhatsAppNames?: (
    updates: { mobile: string; displayName: string; waId?: string }[],
  ) => void;
  canEdit?: boolean;
}) {
  const [section, setSection] = useState<CheckSection>("");
  const [apiConfigured, setApiConfigured] = useState<boolean | null>(null);
  const [apiBusy, setApiBusy] = useState(false);
  const [apiMsg, setApiMsg] = useState<string | null>(null);
  const [apiByMobile, setApiByMobile] = useState<Record<string, ApiHit>>({});

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/wa/contacts-check");
        const json = (await res.json()) as { configured?: boolean };
        if (!cancelled) setApiConfigured(!!json.configured);
      } catch {
        if (!cancelled) setApiConfigured(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const report = useMemo(() => {
    const open = leads.filter((l) => l.stage !== "lost");

    const invalid = open.filter((l) => !isValidIndianMobile(l.mobile));

    // Leads where the WhatsApp number differs from the calling number
    const waDiff = open.filter((l) => {
      const wa = waNumberOf(l);
      return wa && l.mobile && wa !== l.mobile;
    });

    // Same WhatsApp number claimed by different guardian names
    const byWa = new Map<string, AdmissionLead[]>();
    for (const l of open) {
      const wa = waNumberOf(l);
      if (!isValidIndianMobile(wa)) continue;
      byWa.set(wa, [...(byWa.get(wa) || []), l]);
    }
    const conflicts: {
      number: string;
      names: string[];
      leads: AdmissionLead[];
    }[] = [];
    for (const [number, list] of byWa) {
      const names = [
        ...new Set(
          list
            .map((l) => l.guardianName.trim().toLowerCase())
            .filter(Boolean),
        ),
      ];
      if (names.length > 1) {
        conflicts.push({
          number,
          names: [
            ...new Set(list.map((l) => l.guardianName.trim()).filter(Boolean)),
          ],
          leads: list,
        });
      }
    }
    conflicts.sort((a, b) => b.leads.length - a.leads.length);

    const onWa: AdmissionLead[] = [];
    const notOnWa: AdmissionLead[] = [];
    const waUnknown: AdmissionLead[] = [];
    for (const l of open) {
      const wa = waNumberOf(l);
      if (!isValidIndianMobile(wa)) continue;
      const hit = apiByMobile[wa];
      if (!hit) continue;
      if (hit.status === "on_whatsapp") onWa.push(l);
      else if (hit.status === "not_on_whatsapp") notOnWa.push(l);
      else waUnknown.push(l);
    }

    return {
      open,
      invalid,
      waDiff,
      conflicts,
      byWa,
      onWa,
      notOnWa,
      waUnknown,
    };
  }, [leads, apiByMobile]);

  const waNamesAvailable = useMemo(() => {
    const updates: { mobile: string; displayName: string; waId?: string }[] =
      [];
    for (const [mobile, hit] of Object.entries(apiByMobile)) {
      const name = (hit.profileName || "").trim();
      if (!name) continue;
      if (hit.status !== "on_whatsapp" && hit.status !== "unknown") continue;
      updates.push({
        mobile,
        displayName: name,
        waId: hit.waId,
      });
    }
    return updates;
  }, [apiByMobile]);

  const alreadyApplied = useMemo(() => {
    return leads.filter(
      (l) => l.stage !== "lost" && (l.whatsappDisplayName || "").trim(),
    ).length;
  }, [leads]);

  async function runLiveWaCheck() {
    const mobiles = [...report.byWa.keys()];
    if (!mobiles.length) {
      setApiMsg("No valid mobiles to check.");
      return;
    }
    setApiBusy(true);
    setApiMsg(null);
    try {
      // Batch in chunks of 50 to stay polite to Meta rate limits
      const next: Record<string, ApiHit> = { ...apiByMobile };
      for (let i = 0; i < mobiles.length; i += 50) {
        const chunk = mobiles.slice(i, i + 50);
        const res = await fetch("/api/wa/contacts-check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mobiles: chunk }),
        });
        const json = (await res.json()) as {
          ok?: boolean;
          configured?: boolean;
          mode?: string;
          error?: string;
          results?: {
            local10?: string;
            status?: ApiHit["status"];
            waId?: string;
            profileName?: string;
            detail?: string;
          }[];
        };
        if (!json.configured) {
          setApiConfigured(false);
          setApiMsg(
            json.error ||
              "WhatsApp API not configured — set WHATSAPP_TOKEN + WHATSAPP_PHONE_ID after go-live.",
          );
          break;
        }
        setApiConfigured(true);
        if (!json.ok && (!json.results || !json.results.length)) {
          setApiMsg(json.error || "Contacts check failed");
          break;
        }
        for (const r of json.results || []) {
          if (!r.local10) continue;
          next[r.local10] = {
            status: r.status || "unknown",
            waId: r.waId,
            profileName: r.profileName,
            detail: r.detail,
          };
        }
        if (json.error && json.ok) {
          setApiMsg(`Partial: ${json.error}`);
        }
      }
      setApiByMobile(next);
      const checked = Object.keys(next).length;
      const on = Object.values(next).filter(
        (h) => h.status === "on_whatsapp",
      ).length;
      const off = Object.values(next).filter(
        (h) => h.status === "not_on_whatsapp",
      ).length;
      setApiMsg(
        `Live check done · ${checked} numbers · ${on} on WhatsApp · ${off} not on WhatsApp`,
      );
    } catch (e) {
      setApiMsg(e instanceof Error ? e.message : "Network error");
    } finally {
      setApiBusy(false);
    }
  }

  const chips: { id: CheckSection; label: string; n: number; tone: string }[] =
    [
      {
        id: "invalid",
        label: "Invalid / missing mobile",
        n: report.invalid.length,
        tone: "bg-[rgba(180,35,24,0.1)] text-[#b42318]",
      },
      {
        id: "wa_diff",
        label: "WhatsApp ≠ calling number",
        n: report.waDiff.length,
        tone: "bg-[rgba(180,83,9,0.12)] text-[#9a3412]",
      },
      {
        id: "conflicts",
        label: "Same number, different names",
        n: report.conflicts.length,
        tone: "bg-[rgba(126,34,206,0.1)] text-[#7e22ce]",
      },
      {
        id: "wa_map",
        label: "WhatsApp number → name map",
        n: report.byWa.size,
        tone: "bg-[rgba(21,128,61,0.12)] text-[#166534]",
      },
      {
        id: "on_wa",
        label: "On WhatsApp (API)",
        n: report.onWa.length,
        tone: "bg-[rgba(21,128,61,0.14)] text-[#166534]",
      },
      {
        id: "not_on_wa",
        label: "Not on WhatsApp (API)",
        n: report.notOnWa.length,
        tone: "bg-[rgba(180,35,24,0.1)] text-[#b42318]",
      },
      {
        id: "wa_unknown",
        label: "WA check inconclusive",
        n: report.waUnknown.length,
        tone: "bg-[rgba(71,85,105,0.12)] text-[#334155]",
      },
    ];

  const visibleChips = chips.filter((c) => c.n > 0);

  return (
    <div className="space-y-2 rounded-lg border border-[rgba(32,48,80,0.12)] bg-white p-2.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="max-w-3xl text-[11px] text-[var(--muted)]">
          <strong className="text-[var(--brand-deep)]">Offline now:</strong>{" "}
          format + CRM mapping only (10 digits starting 6–9; which number the
          CRM will use under which guardian name).{" "}
          <strong className="text-[var(--brand-deep)]">
            After go-live:
          </strong>{" "}
          with <code className="text-[10px]">WHATSAPP_TOKEN</code> +{" "}
          <code className="text-[10px]">WHATSAPP_PHONE_ID</code>, use{" "}
          <em>Check on WhatsApp API</em> to see which numbers are registered on
          WhatsApp (and WA id / name when the provider returns them).
        </p>
        <button
          type="button"
          disabled={apiBusy || report.byWa.size === 0}
          onClick={() => void runLiveWaCheck()}
          className="shrink-0 rounded-lg bg-[#166534] px-2.5 py-1.5 text-[11px] font-semibold text-white hover:brightness-110 disabled:opacity-50"
          title={
            apiConfigured === false
              ? "Will report not configured until WHATSAPP_* env is set"
              : "Verify numbers via WhatsApp Business API"
          }
        >
          {apiBusy
            ? "Checking…"
            : apiConfigured
              ? `Check on WhatsApp API · ${report.byWa.size}`
              : `Check on WhatsApp API (go-live) · ${report.byWa.size}`}
        </button>
        {canEdit &&
        onApplyWhatsAppNames &&
        waNamesAvailable.length > 0 ? (
          <button
            type="button"
            className="shrink-0 rounded-lg bg-[#0f766e] px-2.5 py-1.5 text-[11px] font-semibold text-white hover:brightness-110"
            title="Set WhatsApp display name on matching leads — campaigns use this for {{guardianName}}"
            onClick={() => {
              const ok =
                typeof window === "undefined" ||
                window.confirm(
                  `Update ${waNamesAvailable.length} number(s) with WhatsApp profile names?\n\nThis sets the campaign greeting name ({{guardianName}}) and updates the guardian name on those leads so desk lists match.\n\nExamples:\n${waNamesAvailable
                    .slice(0, 5)
                    .map((u) => `${u.mobile} → ${u.displayName}`)
                    .join("\n")}${waNamesAvailable.length > 5 ? "\n…" : ""}`,
                );
              if (!ok) return;
              onApplyWhatsAppNames(waNamesAvailable);
            }}
          >
            Update names from WhatsApp · {waNamesAvailable.length}
          </button>
        ) : null}
      </div>

      {Object.keys(apiByMobile).length > 0 &&
      waNamesAvailable.length === 0 ? (
        <p className="rounded-md bg-[rgba(71,85,105,0.08)] px-2 py-1 text-[10px] text-[#334155]">
          Live check found registration status, but no WhatsApp profile names
          yet (Meta often returns only wa_id). Names appear after a parent
          messages you, or if you use a BSP contacts URL that returns names —
          then this <strong>Update names from WhatsApp</strong> button unlocks.
          {alreadyApplied
            ? ` · ${alreadyApplied} lead(s) already have a WA display name.`
            : ""}
        </p>
      ) : null}

      {apiConfigured === false ? (
        <p className="rounded-md bg-[rgba(180,83,9,0.08)] px-2 py-1 text-[10px] text-[#9a3412]">
          WhatsApp API keys not detected on this server yet — live registration
          check will activate once env is set online.
        </p>
      ) : apiConfigured ? (
        <p className="rounded-md bg-[rgba(21,128,61,0.08)] px-2 py-1 text-[10px] text-[#166534]">
          WhatsApp API configured — live number check is available.
        </p>
      ) : null}

      {apiMsg ? (
        <p className="text-[11px] font-medium text-[var(--brand-deep)]">
          {apiMsg}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-1.5">
        {visibleChips.length === 0 ? (
          <span className="text-[11px] font-semibold text-[#166534]">
            All {report.open.length} working leads have valid 10-digit mobiles
            with no name conflicts.
          </span>
        ) : (
          visibleChips.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setSection(section === c.id ? "" : c.id)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                section === c.id
                  ? "bg-[var(--brand-deep)] text-white"
                  : `${c.tone} hover:brightness-95`
              }`}
            >
              {c.label} · {c.n} {section === c.id ? "▴" : "▾"}
            </button>
          ))
        )}
      </div>

      {section === "invalid" && report.invalid.length ? (
        <LeadActionCardList
          leads={report.invalid}
          actions={actions}
          detail={(l) => (
            <span className="text-[#b42318]">
              {!l.mobile
                ? "No mobile"
                : l.mobile.length !== 10
                  ? `${l.mobile.length} digits · captured “${l.mobile}”`
                  : `Starts with 0–5 · captured “${l.mobile}”`}
            </span>
          )}
        />
      ) : null}

      {section === "wa_diff" && report.waDiff.length ? (
        <LeadActionCardList
          leads={report.waDiff}
          actions={actions}
          detail={(l) => (
            <span>
              Call <span className="font-mono">{l.mobile}</span> · WA{" "}
              <span className="font-mono font-semibold text-[#166534]">
                {waNumberOf(l)}
              </span>
            </span>
          )}
        />
      ) : null}

      {section === "conflicts" && report.conflicts.length ? (
        <div className="max-h-80 space-y-2 overflow-y-auto">
          {report.conflicts.map((c) => {
            const openLeads = c.leads.filter((l) => l.stage !== "lost");
            const childPreview = [
              ...new Set(
                openLeads.flatMap((l) =>
                  String(l.childName || "")
                    .split(/[,;/|&]+/)
                    .map((p) => p.trim())
                    .filter(Boolean),
                ),
              ),
            ];
            return (
              <div
                key={c.number}
                className="rounded-md border border-[rgba(126,34,206,0.25)] bg-[rgba(126,34,206,0.04)] px-2.5 py-2 text-[11px]"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="font-mono font-semibold">{c.number}</span>
                      <span className="text-[var(--muted)]">
                        used by {c.names.length} names / {openLeads.length}{" "}
                        open leads
                      </span>
                    </div>
                    <div className="mt-0.5 text-[#7e22ce]">
                      Names: {c.names.join(" · ") || "—"}
                    </div>
                    {childPreview.length ? (
                      <div className="mt-0.5 text-[var(--brand-deep)]">
                        Children to merge:{" "}
                        <strong>{childPreview.join(", ")}</strong>
                      </div>
                    ) : null}
                  </div>
                  {canEdit &&
                  onMergeSameMobile &&
                  openLeads.length >= 2 ? (
                    <button
                      type="button"
                      className="shrink-0 rounded-lg bg-[#7e22ce] px-2.5 py-1.5 text-[11px] font-semibold text-white hover:brightness-110"
                      title="Keep one lead with all child names; close the rest as merged"
                      onClick={() => {
                        const ok =
                          typeof window === "undefined" ||
                          window.confirm(
                            `Merge ${openLeads.length} leads on ${c.number} into one lead?\n\nChildren: ${childPreview.join(", ")}\nGuardians: ${c.names.join(" · ")}\n\nOther leads will be marked Lost as merged.`,
                          );
                        if (!ok) return;
                        onMergeSameMobile(openLeads.map((l) => l.id));
                      }}
                    >
                      Merge all → one lead
                    </button>
                  ) : null}
                </div>
                <ul className="mt-2 space-y-2">
                  {openLeads.map((l) => (
                    <li
                      key={l.id}
                      className="rounded-md border border-[rgba(32,48,80,0.1)] bg-white px-2 py-1.5"
                    >
                      <div className="font-semibold text-[var(--brand-deep)]">
                        {l.childName}{" "}
                        <span className="font-mono text-[9px] font-normal text-[var(--muted)]">
                          {l.enquiryNo}
                        </span>
                      </div>
                      <div className="text-[10px] text-[var(--muted)]">
                        Guardian: {l.guardianName || "—"}
                      </div>
                      <LeadTagListActions lead={l} handlers={actions} />
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      ) : null}

      {section === "wa_map" ? (
        <div className="max-h-80 space-y-2 overflow-y-auto">
          {[...report.byWa.entries()]
            .sort((a, b) => b[1].length - a[1].length)
            .map(([number, list]) => {
              const names = [
                ...new Set(
                  list.map((l) => l.guardianName.trim()).filter(Boolean),
                ),
              ];
              return (
                <div
                  key={number}
                  className="rounded-md border border-[rgba(32,48,80,0.1)] px-2.5 py-2 text-[11px]"
                >
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-mono font-semibold">{number}</span>
                    <span
                      className={
                        names.length > 1
                          ? "font-semibold text-[#7e22ce]"
                          : "text-[var(--muted)]"
                      }
                    >
                      {names.join(" · ") || "—"}
                    </span>
                    {apiByMobile[number] ? (
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${
                          apiByMobile[number]!.status === "on_whatsapp"
                            ? "bg-[rgba(21,128,61,0.14)] text-[#166534]"
                            : apiByMobile[number]!.status === "not_on_whatsapp"
                              ? "bg-[rgba(180,35,24,0.1)] text-[#b42318]"
                              : "bg-[rgba(71,85,105,0.12)] text-[#334155]"
                        }`}
                      >
                        {apiByMobile[number]!.status === "on_whatsapp"
                          ? `On WA${apiByMobile[number]!.profileName ? ` · ${apiByMobile[number]!.profileName}` : ""}`
                          : apiByMobile[number]!.status === "not_on_whatsapp"
                            ? "Not on WA"
                            : "WA unknown"}
                      </span>
                    ) : null}
                  </div>
                  <ul className="mt-2 space-y-2">
                    {list.map((l) => (
                      <li
                        key={l.id}
                        className="rounded-md border border-[rgba(32,48,80,0.08)] bg-[rgba(32,48,80,0.02)] px-2 py-1.5"
                      >
                        <div className="font-semibold text-[var(--brand-deep)]">
                          {l.childName}{" "}
                          <span className="font-mono text-[9px] font-normal text-[var(--muted)]">
                            {l.enquiryNo}
                          </span>
                        </div>
                        <div className="text-[10px] text-[var(--muted)]">
                          Guardian: {l.guardianName || "—"} · AY{" "}
                          {l.academicYearCode || "—"}
                        </div>
                        <LeadTagListActions lead={l} handlers={actions} />
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
        </div>
      ) : null}

      {section === "on_wa" && report.onWa.length ? (
        <LeadActionCardList
          leads={report.onWa}
          actions={actions}
          detail={(l) => {
            const wa = waNumberOf(l);
            const hit = apiByMobile[wa];
            return (
              <span className="text-[#166534]">
                {wa}
                {hit?.profileName ? ` · WA name “${hit.profileName}”` : ""}
                {hit?.waId ? ` · wa_id ${hit.waId}` : ""}
                {hit?.detail ? ` · ${hit.detail}` : ""}
              </span>
            );
          }}
        />
      ) : null}

      {section === "not_on_wa" && report.notOnWa.length ? (
        <LeadActionCardList
          leads={report.notOnWa}
          actions={actions}
          detail={(l) => {
            const wa = waNumberOf(l);
            const hit = apiByMobile[wa];
            return (
              <span className="text-[#b42318]">
                {wa} — not registered on WhatsApp
                {hit?.detail ? ` (${hit.detail})` : ""}
              </span>
            );
          }}
        />
      ) : null}

      {section === "wa_unknown" && report.waUnknown.length ? (
        <LeadActionCardList
          leads={report.waUnknown}
          actions={actions}
          detail={(l) => {
            const wa = waNumberOf(l);
            const hit = apiByMobile[wa];
            return (
              <span>
                {wa}
                {hit?.detail ? ` — ${hit.detail}` : " — inconclusive"}
              </span>
            );
          }}
        />
      ) : null}
    </div>
  );
}

function LeadActionCardList({
  leads,
  actions,
  detail,
}: {
  leads: AdmissionLead[];
  actions: LeadTagListActionHandlers;
  detail: (lead: AdmissionLead) => ReactNode;
}) {
  return (
    <ul className="max-h-80 space-y-2 overflow-y-auto">
      {leads.map((l) => (
        <li
          key={l.id}
          className="rounded-md border border-[rgba(32,48,80,0.1)] px-2.5 py-2 text-[11px]"
        >
          <div className="font-semibold text-[var(--brand-deep)]">
            {l.childName}{" "}
            <span className="font-mono text-[9px] font-normal text-[var(--muted)]">
              {l.enquiryNo}
            </span>
          </div>
          <div className="text-[10px] text-[var(--muted)]">
            {l.guardianName || "—"} · {detail(l)}
          </div>
          <LeadTagListActions lead={l} handlers={actions} />
        </li>
      ))}
    </ul>
  );
}
