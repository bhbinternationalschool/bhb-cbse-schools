"use client";

import { useMemo, useState } from "react";
import {
  moduleLabel,
  statusTone,
  type WaTemplate,
  type WaTemplateLanguage,
  type WaTemplateModule,
  type WaTemplatesState,
} from "@/lib/waTemplates";
import {
  MastersEmptyRow,
  MastersTableCard,
} from "@/components/masters/MastersLayout";
import { waBtnOutline, waBtnPrimary, waInp } from "./waTemplateUi";

type ListTab = "approved" | "drafts";

function matchesTab(t: WaTemplate, tab: ListTab): boolean {
  if (tab === "approved") {
    return t.status === "approved";
  }
  return (
    t.status === "draft" ||
    t.status === "pending" ||
    t.status === "rejected" ||
    t.status === "paused"
  );
}

export function WaTemplatesListView({
  state,
  readOnly,
  notice,
  syncing,
  onSyncMeta,
  onCreate,
  onEdit,
}: {
  state: WaTemplatesState;
  readOnly: boolean;
  notice: string | null;
  syncing: boolean;
  onSyncMeta: () => void;
  onCreate: () => void;
  onEdit: (id: string) => void;
}) {
  const [tab, setTab] = useState<ListTab>("approved");
  const [moduleFilter, setModuleFilter] = useState<WaTemplateModule | "all">(
    "all",
  );
  const [langFilter, setLangFilter] = useState<WaTemplateLanguage | "all">(
    "all",
  );
  const [q, setQ] = useState("");

  const modules = useMemo(() => {
    return [...new Set(state.templates.map((t) => t.module))].sort();
  }, [state]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return state.templates.filter((t) => {
      if (!matchesTab(t, tab)) return false;
      if (moduleFilter !== "all" && t.module !== moduleFilter) return false;
      if (langFilter !== "all" && t.language !== langFilter) return false;
      if (!needle) return true;
      return (
        t.name.toLowerCase().includes(needle) ||
        t.metaName.toLowerCase().includes(needle)
      );
    });
  }, [state, tab, moduleFilter, langFilter, q]);

  const approvedCount = state.templates.filter(
    (t) => t.status === "approved",
  ).length;
  const draftsCount = state.templates.filter((t) => matchesTab(t, "drafts"))
    .length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-[var(--brand-deep)]">
            WhatsApp templates
          </h2>
          <p className="mt-1 max-w-2xl text-[12px] text-[var(--muted)]">
            Approved templates are ready for campaigns. Drafts and pending items
            can be edited and submitted to Meta. Last sync:{" "}
            {state.lastMetaSyncAt || "never"}
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
            className={waBtnTeal}
            onClick={onCreate}
          >
            + New template
          </button>
          <button
            type="button"
            disabled={syncing || readOnly}
            className={waBtnPrimary}
            onClick={onSyncMeta}
          >
            {syncing ? "Syncing…" : "Sync from Meta"}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-[rgba(32,48,80,0.1)] pb-2">
        <button
          type="button"
          className={`rounded-lg px-4 py-2 text-[12px] font-semibold ${
            tab === "approved"
              ? "bg-[var(--brand-deep)] text-white"
              : "bg-[rgba(32,48,80,0.06)] text-[var(--brand-deep)]"
          }`}
          onClick={() => setTab("approved")}
        >
          Approved ({approvedCount})
        </button>
        <button
          type="button"
          className={`rounded-lg px-4 py-2 text-[12px] font-semibold ${
            tab === "drafts"
              ? "bg-[var(--brand-deep)] text-white"
              : "bg-[rgba(32,48,80,0.06)] text-[var(--brand-deep)]"
          }`}
          onClick={() => setTab("drafts")}
        >
          Drafts & pending ({draftsCount})
        </button>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <label className="block text-[11px] font-semibold text-[var(--muted)]">
          Search
          <input
            className={`${waInp} mt-1`}
            placeholder="Name or meta name…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <label className="block text-[11px] font-semibold text-[var(--muted)]">
          Module
          <select
            className={`${waInp} mt-1`}
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
            className={`${waInp} mt-1`}
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

      <MastersTableCard
        title={
          tab === "approved"
            ? `Approved templates (${filtered.length})`
            : `Drafts & pending (${filtered.length})`
        }
      >
        {filtered.length === 0 ? (
          <MastersEmptyRow
            label={
              tab === "approved"
                ? "No approved templates yet. Create one and submit to Meta."
                : "No drafts or pending templates."
            }
          />
        ) : (
          <ul className="divide-y divide-[rgba(32,48,80,0.08)]">
            {filtered.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left hover:bg-[rgba(32,48,80,0.04)]"
                  onClick={() => onEdit(t.id)}
                >
                  <div className="min-w-0 flex-1">
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
                    <p className="mt-0.5 truncate text-[11px] text-[var(--muted)]">
                      {moduleLabel(t.module)} · {t.category} · {t.metaName}
                    </p>
                  </div>
                  <span className={waBtnOutline}>Open</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </MastersTableCard>
    </div>
  );
}

const waBtnTeal =
  "rounded-lg bg-[#0f766e] px-4 py-2 text-[12px] font-semibold text-white disabled:opacity-50";
