"use client";

import { useEffect, useMemo, useState } from "react";
import { ensureWaTemplatesHydrated } from "@/lib/waTemplatesPersistence";
import {
  loadWaTemplates,
  moduleLabel,
  saveWaTemplates,
  statusTone,
  updateTemplateLocal,
  createDraftWaTemplate,
  type WaTemplate,
  type WaTemplateButton,
  type WaTemplateLanguage,
  type WaTemplateModule,
  type WaTemplateStatus,
  type WaTemplatesState,
} from "@/lib/waTemplates";
import {
  useDemoSession,
  useSessionReadOnly,
} from "@/components/shell/SessionContext";
import {
  MastersEmptyRow,
  MastersTableCard,
  MastersTabStack,
  MastersWorkCard,
} from "@/components/masters/MastersLayout";

const inp =
  "w-full rounded-lg border border-[rgba(32,48,80,0.15)] bg-white px-3 py-2 text-sm";

export function WaTemplatesPanel() {
  const session = useDemoSession();
  const readOnly = useSessionReadOnly();
  const [state, setState] = useState<WaTemplatesState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<WaTemplateStatus | "all">(
    "all",
  );
  const [moduleFilter, setModuleFilter] = useState<WaTemplateModule | "all">(
    "all",
  );
  const [langFilter, setLangFilter] = useState<WaTemplateLanguage | "all">(
    "all",
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newMetaName, setNewMetaName] = useState("");
  const [newBody, setNewBody] = useState(
    "Namaste {{guardianName}}, message from {{schoolName}}.",
  );
  const [newModule, setNewModule] = useState<WaTemplateModule>("comms");
  const [newLang, setNewLang] = useState<WaTemplateLanguage>("en");

  useEffect(() => {
    setState(loadWaTemplates());
    void (async () => {
      await ensureWaTemplatesHydrated();
      setState(loadWaTemplates());
    })();
  }, []);

  function commit(next: WaTemplatesState, msg?: string) {
    if (readOnly) {
      setNotice("Session is closed — templates are read-only");
      window.setTimeout(() => setNotice(null), 2800);
      return;
    }
    setState(next);
    saveWaTemplates(next);
    if (msg) {
      setNotice(msg);
      window.setTimeout(() => setNotice(null), 2200);
    }
  }

  const filtered = useMemo(() => {
    if (!state) return [];
    return state.templates.filter((t) => {
      if (statusFilter !== "all" && t.status !== statusFilter) return false;
      if (moduleFilter !== "all" && t.module !== moduleFilter) return false;
      if (langFilter !== "all" && t.language !== langFilter) return false;
      return true;
    });
  }, [state, statusFilter, moduleFilter, langFilter]);

  const selected = useMemo(
    () => state?.templates.find((t) => t.id === selectedId) || null,
    [state, selectedId],
  );

  const modules = useMemo(() => {
    if (!state) return [] as WaTemplateModule[];
    return [...new Set(state.templates.map((t) => t.module))].sort();
  }, [state]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const t of state?.templates || []) {
      c[t.status] = (c[t.status] || 0) + 1;
    }
    return c;
  }, [state]);

  async function onSyncMeta() {
    if (!state) return;
    setSyncing(true);
    try {
      const res = await fetch("/api/wa/templates/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        state?: WaTemplatesState;
        mode?: string;
        synced?: number;
      };
      if (json.state) {
        commit(
          json.state,
          json.ok
            ? `Synced ${json.synced ?? 0} templates (${json.mode})`
            : json.error || "Sync finished with warnings",
        );
      } else {
        setNotice(json.error || "Sync failed");
        window.setTimeout(() => setNotice(null), 3200);
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Sync failed");
      window.setTimeout(() => setNotice(null), 3200);
    } finally {
      setSyncing(false);
    }
  }

  async function onSubmitMeta(templateId: string) {
    if (!state) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/wa/templates/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId, state }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        state?: WaTemplatesState;
        status?: string;
        warnings?: string[];
        hint?: string;
      };
      if (json.state) {
        commit(
          json.state,
          json.ok
            ? `Submitted to Meta (${json.status || "PENDING"})`
            : json.error || "Submit failed",
        );
      }
      if (json.warnings?.length) {
        setNotice(`${json.warnings.join(" ")}`);
        window.setTimeout(() => setNotice(null), 5000);
      }
      if (!res.ok && !json.state) {
        setNotice(json.error || "Submit failed");
        window.setTimeout(() => setNotice(null), 4000);
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Submit failed");
      window.setTimeout(() => setNotice(null), 3200);
    } finally {
      setSubmitting(false);
    }
  }

  function onCreateDraft() {
    if (!state) return;
    const metaName =
      newMetaName.trim() ||
      newName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
    const next = createDraftWaTemplate(state, {
      name: newName.trim() || metaName,
      metaName,
      module: newModule,
      language: newLang,
      body: newBody,
      by: session.fullName || "masters",
    });
    const created = next.templates[next.templates.length - 1];
    commit(next, "Draft template created");
    if (created) setSelectedId(created.id);
    setShowNew(false);
  }

  if (!state) {
    return (
      <p className="text-sm text-[var(--muted)]">Loading WhatsApp templates…</p>
    );
  }

  return (
    <MastersTabStack
      intro={
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-[var(--brand-deep)]">
                WhatsApp templates
              </h2>
              <p className="text-[12px] text-[var(--muted)]">
                Create templates here → <strong>Submit to Meta</strong> for
                approval (no Business Manager).{" "}
                <em>Session buttons</em> in the school bot work without templates
                (24h window). <em>Template buttons</em> need Meta approval below.
                Last sync: {state.lastMetaSyncAt || "never"}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {notice ? (
                <span className="rounded-lg bg-[rgba(197,160,40,0.18)] px-3 py-1.5 text-xs font-medium text-[var(--brand-deep)]">
                  {notice}
                </span>
              ) : null}
              <button
                type="button"
                disabled={readOnly}
                className="rounded-lg border border-[rgba(32,48,80,0.2)] px-3 py-2 text-[11px] font-semibold"
                onClick={() => setShowNew((v) => !v)}
              >
                {showNew ? "Cancel" : "New template"}
              </button>
              <button
                type="button"
                disabled={syncing || readOnly}
                className="rounded-lg bg-[var(--brand-deep)] px-3 py-2 text-[11px] font-semibold text-white disabled:opacity-50"
                onClick={() => void onSyncMeta()}
              >
                {syncing ? "Syncing…" : "Sync from Meta"}
              </button>
            </div>
          </div>
          {showNew ? (
            <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-3 text-[12px]">
              <p className="mb-2 font-semibold text-[var(--brand-deep)]">
                New draft template
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="block text-[11px] font-semibold text-[var(--muted)]">
                  Display name
                  <input
                    className={`${inp} mt-1`}
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Fee reminder"
                  />
                </label>
                <label className="block text-[11px] font-semibold text-[var(--muted)]">
                  Meta name (snake_case)
                  <input
                    className={`${inp} mt-1 font-mono`}
                    value={newMetaName}
                    onChange={(e) => setNewMetaName(e.target.value)}
                    placeholder="bhb_fee_reminder"
                  />
                </label>
                <label className="block text-[11px] font-semibold text-[var(--muted)]">
                  Module
                  <select
                    className={`${inp} mt-1`}
                    value={newModule}
                    onChange={(e) =>
                      setNewModule(e.target.value as WaTemplateModule)
                    }
                  >
                    <option value="comms">Comms</option>
                    <option value="admissions">Admissions</option>
                    <option value="fees">Fees</option>
                    <option value="transport">Transport</option>
                    <option value="general">General</option>
                  </select>
                </label>
                <label className="block text-[11px] font-semibold text-[var(--muted)]">
                  Language
                  <select
                    className={`${inp} mt-1`}
                    value={newLang}
                    onChange={(e) =>
                      setNewLang(e.target.value as WaTemplateLanguage)
                    }
                  >
                    <option value="en">English</option>
                    <option value="hi">Hindi</option>
                  </select>
                </label>
                <label className="block text-[11px] font-semibold text-[var(--muted)] sm:col-span-2">
                  Body (use {"{{guardianName}}"}, {"{{schoolName}}"}, etc.)
                  <textarea
                    className={`${inp} mt-1 min-h-[80px] font-mono text-[11px]`}
                    value={newBody}
                    onChange={(e) => setNewBody(e.target.value)}
                  />
                </label>
              </div>
              <button
                type="button"
                className="mt-2 rounded-lg bg-[#0f766e] px-3 py-2 text-[11px] font-semibold text-white"
                onClick={onCreateDraft}
              >
                Save draft
              </button>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2 text-[11px]">
            {(
              ["approved", "pending", "rejected", "paused", "draft"] as const
            ).map((s) => (
              <span
                key={s}
                className={`rounded-full px-2.5 py-1 font-semibold ${statusTone(s)}`}
              >
                {s}: {counts[s] || 0}
              </span>
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="block text-[11px] font-semibold text-[var(--muted)]">
              Status
              <select
                className={`${inp} mt-1`}
                value={statusFilter}
                onChange={(e) =>
                  setStatusFilter(e.target.value as WaTemplateStatus | "all")
                }
              >
                <option value="all">All</option>
                <option value="approved">Approved</option>
                <option value="pending">Pending / waiting</option>
                <option value="rejected">Rejected</option>
                <option value="paused">Paused</option>
                <option value="draft">Draft</option>
              </select>
            </label>
            <label className="block text-[11px] font-semibold text-[var(--muted)]">
              Module
              <select
                className={`${inp} mt-1`}
                value={moduleFilter}
                onChange={(e) =>
                  setModuleFilter(e.target.value as WaTemplateModule | "all")
                }
              >
                <option value="all">All modules</option>
                {modules.map((m) => (
                  <option key={m} value={m}>
                    {moduleLabel(m)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-[11px] font-semibold text-[var(--muted)]">
              Language
              <select
                className={`${inp} mt-1`}
                value={langFilter}
                onChange={(e) =>
                  setLangFilter(e.target.value as WaTemplateLanguage | "all")
                }
              >
                <option value="all">EN + HI</option>
                <option value="en">English</option>
                <option value="hi">Hindi</option>
              </select>
            </label>
          </div>
        </div>
      }
      tables={
        <div className="grid gap-4 lg:grid-cols-2">
          <MastersTableCard title={`Catalog (${filtered.length})`}>
            {filtered.length === 0 ? (
              <MastersEmptyRow label="No templates match filters." />
            ) : (
              <ul className="divide-y divide-[rgba(32,48,80,0.08)]">
                {filtered.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      className={`w-full px-3 py-2 text-left hover:bg-[rgba(32,48,80,0.04)] ${
                        selectedId === t.id ? "bg-[rgba(32,48,80,0.06)]" : ""
                      }`}
                      onClick={() => setSelectedId(t.id)}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[13px] font-semibold text-[var(--brand-deep)]">
                          {t.name}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${statusTone(t.status)}`}
                        >
                          {t.status}
                        </span>
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-600">
                          {t.language}
                        </span>
                        {t.carousel.length > 0 ? (
                          <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-800">
                            carousel×{t.carousel.length}
                          </span>
                        ) : null}
                        {t.headerFormat !== "NONE" &&
                        t.headerFormat !== "TEXT" ? (
                          <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-800">
                            {t.headerFormat.toLowerCase()}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 text-[11px] text-[var(--muted)]">
                        {moduleLabel(t.module)} · {t.category} · {t.metaName}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </MastersTableCard>
          <MastersTableCard title="Selected">
            {!selected ? (
              <MastersEmptyRow label="Click a template to edit local fallback / pause." />
            ) : (
              <div className="p-3 text-[12px]">
                <p className="font-semibold text-[var(--brand-deep)]">
                  {selected.name}
                </p>
                <p className="text-[11px] text-[var(--muted)]">
                  {selected.metaName} · {selected.metaLanguage}
                </p>
              </div>
            )}
          </MastersTableCard>
        </div>
      }
      work={
        selected ? (
          <MastersWorkCard
            title={selected.name}
            hint={`${selected.metaName} · ${selected.metaLanguage}`}
          >
            <TemplateEditor
              template={selected}
              readOnly={readOnly}
              submitting={submitting}
              onSubmitMeta={() => void onSubmitMeta(selected.id)}
              onSave={(patch, msg) => {
                commit(
                  updateTemplateLocal(
                    state,
                    selected.id,
                    patch,
                    session.fullName || "masters",
                  ),
                  msg,
                );
              }}
            />
          </MastersWorkCard>
        ) : (
          <MastersWorkCard
            title="Template detail"
            hint="Select a template from the catalog"
          >
            <p className="text-[12px] text-[var(--muted)]">
              <strong>Session buttons</strong> (school bot menus) work when parents
              message you — no template needed.{" "}
              <strong>Template buttons</strong> (quick-reply on campaigns / cold
              outbound) are created here and submitted to Meta for approval.
            </p>
          </MastersWorkCard>
        )
      }
    />
  );
}

function TemplateEditor({
  template,
  readOnly,
  submitting,
  onSubmitMeta,
  onSave,
}: {
  template: WaTemplate;
  readOnly: boolean;
  submitting: boolean;
  onSubmitMeta: () => void;
  onSave: (
    patch: Parameters<typeof updateTemplateLocal>[2],
    msg?: string,
  ) => void;
}) {
  const [body, setBody] = useState(template.body);
  const [fallback, setFallback] = useState(template.localFallbackBody);
  const [metaName, setMetaName] = useState(template.metaName);
  const [footer, setFooter] = useState(template.footer);
  const [btn1, setBtn1] = useState(template.buttons[0]?.text || "");
  const [btn2, setBtn2] = useState(template.buttons[1]?.text || "");
  const [btn3, setBtn3] = useState(template.buttons[2]?.text || "");

  useEffect(() => {
    setBody(template.body);
    setFallback(template.localFallbackBody);
    setMetaName(template.metaName);
    setFooter(template.footer);
    setBtn1(template.buttons[0]?.text || "");
    setBtn2(template.buttons[1]?.text || "");
    setBtn3(template.buttons[2]?.text || "");
  }, [
    template.id,
    template.body,
    template.localFallbackBody,
    template.metaName,
    template.footer,
    template.buttons,
  ]);

  function buildButtons(): WaTemplateButton[] {
    return [btn1, btn2, btn3]
      .map((t) => t.trim())
      .filter(Boolean)
      .map((text) => ({ type: "QUICK_REPLY" as const, text }));
  }

  const canSubmit =
    !readOnly &&
    template.status !== "approved" &&
    body.trim().length > 0 &&
    metaName.trim().length > 0;

  return (
    <div className="space-y-3 text-[12px]">
      <div className="flex flex-wrap gap-2">
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${statusTone(template.status)}`}
        >
          {template.status}
        </span>
        {template.rejectionReason ? (
          <span className="text-[11px] text-rose-700">
            Rejected: {template.rejectionReason}
          </span>
        ) : null}
      </div>
      <p className="text-[11px] text-[var(--muted)]">
        Variables:{" "}
        {template.variables.length
          ? template.variables.map((v) => `{{${v}}}`).join(", ")
          : "—"}
      </p>
      <label className="block text-[11px] font-semibold text-[var(--muted)]">
        Meta template name
        <input
          className={`${inp} mt-1 font-mono text-[11px]`}
          value={metaName}
          disabled={readOnly}
          onChange={(e) => setMetaName(e.target.value)}
        />
      </label>
      <label className="block text-[11px] font-semibold text-[var(--muted)]">
        Footer (optional, max 60 chars)
        <input
          className={`${inp} mt-1 text-[11px]`}
          value={footer}
          disabled={readOnly}
          onChange={(e) => setFooter(e.target.value)}
        />
      </label>
      <div className="rounded-lg border border-[rgba(32,48,80,0.1)] p-2">
        <p className="mb-1 text-[11px] font-semibold text-[var(--brand-deep)]">
          Template quick-reply buttons (max 3, Meta-approved templates only)
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          {[btn1, btn2, btn3].map((val, i) => (
            <input
              key={i}
              className={`${inp} text-[11px]`}
              value={i === 0 ? btn1 : i === 1 ? btn2 : btn3}
              disabled={readOnly}
              placeholder={`Button ${i + 1}`}
              onChange={(e) => {
                if (i === 0) setBtn1(e.target.value);
                else if (i === 1) setBtn2(e.target.value);
                else setBtn3(e.target.value);
              }}
            />
          ))}
        </div>
        <p className="mt-1 text-[10px] text-[var(--muted)]">
          For bot menus (MENU, PARENT, REPORTS), session buttons are sent
          automatically — no template needed.
        </p>
      </div>
      <label className="block text-[11px] font-semibold text-[var(--muted)]">
        Body preview
        <textarea
          className={`${inp} mt-1 min-h-[120px] font-mono text-[11px]`}
          value={body}
          disabled={readOnly}
          onChange={(e) => setBody(e.target.value)}
        />
      </label>
      <label className="block text-[11px] font-semibold text-[var(--muted)]">
        Local fallback (24h / wa.me)
        <textarea
          className={`${inp} mt-1 min-h-[80px] font-mono text-[11px]`}
          value={fallback}
          disabled={readOnly}
          onChange={(e) => setFallback(e.target.value)}
        />
      </label>
      {template.carousel.length > 0 ? (
        <div className="rounded-lg border border-[rgba(32,48,80,0.1)] p-2">
          <p className="mb-1 text-[11px] font-semibold text-[var(--brand-deep)]">
            Carousel cards ({template.carousel.length})
          </p>
          <ul className="space-y-1 text-[11px] text-[var(--muted)]">
            {template.carousel.map((c) => (
              <li key={c.id}>
                · {c.headerFormat}: {c.body.slice(0, 80)}
                {c.body.length > 80 ? "…" : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {!readOnly ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-lg bg-[var(--brand-deep)] px-3 py-2 text-[11px] font-semibold text-white"
            onClick={() =>
              onSave(
                {
                  body,
                  localFallbackBody: fallback,
                  metaName,
                  footer,
                  buttons: buildButtons(),
                },
                "Template saved",
              )
            }
          >
            Save local edits
          </button>
          <button
            type="button"
            disabled={!canSubmit || submitting}
            className="rounded-lg bg-[#0f766e] px-3 py-2 text-[11px] font-semibold text-white disabled:opacity-50"
            onClick={() => {
              onSave(
                {
                  body,
                  localFallbackBody: fallback,
                  metaName,
                  footer,
                  buttons: buildButtons(),
                },
                undefined,
              );
              onSubmitMeta();
            }}
          >
            {submitting
              ? "Submitting…"
              : template.status === "pending"
                ? "Re-submit to Meta"
                : "Submit to Meta for approval"}
          </button>
          <button
            type="button"
            className="rounded-lg border border-[rgba(32,48,80,0.2)] px-3 py-2 text-[11px] font-semibold"
            onClick={() =>
              onSave(
                { paused: !template.paused },
                template.paused ? "Template resumed" : "Template paused",
              )
            }
          >
            {template.paused ? "Resume" : "Pause"}
          </button>
        </div>
      ) : null}
      {template.status === "pending" ? (
        <p className="text-[10px] text-amber-800">
          Pending Meta review — click Sync from Meta or wait for webhook. Usually
          minutes to 24 hours.
        </p>
      ) : null}
    </div>
  );
}
