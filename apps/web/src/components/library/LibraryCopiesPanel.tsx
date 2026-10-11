"use client";

import { useMemo, useState } from "react";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import type { BulkAction, RowAction } from "@/components/ui/erp-grid";
import { btn, btnOutline, field } from "@/components/ui/erp-ui";
import {
  copyLocation,
  listActiveTitles,
  searchCopies,
  type LibraryCopy,
  type LibraryState,
} from "@/lib/library";
import { LIBRARY_COPY_SOURCES } from "@/lib/libraryCounter";
import { libraryApi } from "@/lib/libraryCounterClient";
import { downloadLibraryLabelsPdf, type LibraryLabel } from "@/lib/libraryLabelsPdf";

const STATUS_LABEL: Record<string, string> = {
  available: "On shelf",
  issued: "On loan",
  damaged: "Damaged",
  lost: "Lost",
  reserved: "Reserved",
};

/**
 * Every physical copy: its accession number, where it sits, whether it is
 * in. Add copies (the server hands out the next accession numbers), move
 * them, mark them lost or damaged, and print QR labels for the spines.
 */
export function LibraryCopiesPanel({
  state,
  readOnly,
  onChanged,
  onError,
}: {
  state: LibraryState;
  readOnly: boolean;
  onChanged: (msg: string) => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState("");
  const [status, setStatus] = useState("");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lastAdded, setLastAdded] = useState<string[]>([]);
  const titles = listActiveTitles(state);
  const [form, setForm] = useState({ titleId: "", count: "1", location: "", source: "purchase", acquiredOn: "", procurementDocId: "" });

  const titleById = useMemo(() => new Map(state.titles.map((t) => [t.id, t])), [state.titles]);
  const locations = useMemo(
    () => [...new Set(state.copies.map((c) => copyLocation(c, state)).filter(Boolean))].sort(),
    [state],
  );
  const rows = useMemo(
    () => searchCopies(state, query, location).filter((c) => !status || c.status === status),
    [state, query, location, status],
  );

  function labelFor(c: LibraryCopy): LibraryLabel {
    return { accessionNo: c.accessionNo, title: titleById.get(c.titleId)?.title || "", location: copyLocation(c, state) };
  }

  async function printLabels(copies: LibraryCopy[]) {
    const raw = window.prompt("Labels already used on the first sheet (0–23)? Enter 0 for a fresh sheet.", "0");
    if (raw === null) return;
    try {
      await downloadLibraryLabelsPdf(copies.map(labelFor), Number(raw) || 0);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Labels could not be made");
    }
  }

  async function addCopies() {
    if (!form.titleId) return onError("Choose a title");
    setBusy(true);
    const r = await libraryApi.addCopies({
      titleId: form.titleId,
      count: Number(form.count),
      location: form.location,
      source: form.source,
      acquiredOn: form.acquiredOn || undefined,
      procurementDocId: form.procurementDocId,
    });
    setBusy(false);
    if (!r.ok) return onError(r.error);
    setLastAdded(r.copies.map((c) => c.id));
    setAdding(false);
    await onChanged(`${r.copies.length} copy(ies) added: ${r.copies.map((c) => c.accessionNo).join(", ")}`);
  }

  async function setCopy(c: LibraryCopy, patch: { location?: string; status?: string }, msg: string) {
    const r = await libraryApi.updateCopy({ copyId: c.id, ...patch });
    if (!r.ok) return onError(r.error);
    await onChanged(msg);
  }

  const columns: DataTableColumn<LibraryCopy>[] = [
    {
      key: "accession",
      header: "Accession",
      value: (c) => c.accessionNo,
      render: (c) => <span className="font-mono text-xs font-semibold">{c.accessionNo}</span>,
      sortable: true,
    },
    { key: "title", header: "Title", value: (c) => titleById.get(c.titleId)?.title || "—", sortable: true },
    { key: "author", header: "Author", value: (c) => titleById.get(c.titleId)?.author || "", sortable: true },
    { key: "location", header: "Location", value: (c) => copyLocation(c, state) || "—", sortable: true },
    { key: "status", header: "Status", value: (c) => STATUS_LABEL[c.status] ?? c.status, sortable: true },
    {
      key: "source",
      header: "Source",
      value: (c) => LIBRARY_COPY_SOURCES.find((s) => s.id === c.source)?.label ?? "Purchased",
      sortable: true,
    },
    { key: "acquired", header: "Acquired", value: (c) => c.acquiredOn || "", sortable: true },
  ];

  const rowActions: RowAction<LibraryCopy>[] = [
    { id: "label", label: "Print label", onSelect: (c) => void printLabels([c]) },
    {
      id: "move",
      label: "Move to another shelf…",
      hidden: () => readOnly,
      onSelect: (c) => {
        const to = window.prompt(`New location for ${c.accessionNo}`, copyLocation(c, state));
        if (to !== null) void setCopy(c, { location: to }, `${c.accessionNo} moved to ${to || "(no location)"}`);
      },
    },
    {
      id: "back",
      label: "Back on the shelf",
      hidden: (c) => readOnly || c.status === "available" || c.status === "issued",
      onSelect: (c) => void setCopy(c, { status: "available" }, `${c.accessionNo} is back on the shelf`),
    },
    {
      id: "damaged",
      label: "Mark damaged",
      hidden: (c) => readOnly || c.status === "damaged" || c.status === "issued",
      onSelect: (c) => void setCopy(c, { status: "damaged" }, `${c.accessionNo} marked damaged`),
    },
    {
      id: "lost",
      label: "Mark lost",
      tone: "danger",
      separatorAbove: true,
      hidden: (c) => readOnly || c.status === "lost" || c.status === "issued",
      onSelect: (c) => {
        if (window.confirm(`Mark ${c.accessionNo} as lost?`)) void setCopy(c, { status: "lost" }, `${c.accessionNo} marked lost`);
      },
    },
  ];

  const bulkActions: BulkAction[] = [
    {
      id: "labels",
      label: "Print labels",
      onRun: (keys) => void printLabels(state.copies.filter((c) => keys.includes(c.id))),
    },
  ];

  const lastAddedCopies = state.copies.filter((c) => lastAdded.includes(c.id));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        {[
          { label: "Copies", value: state.copies.length },
          { label: "On shelf", value: state.copies.filter((c) => c.status === "available").length },
          { label: "On loan", value: state.copies.filter((c) => c.status === "issued").length },
          { label: "Lost / damaged", value: state.copies.filter((c) => c.status === "lost" || c.status === "damaged").length },
        ].map((m) => (
          <div key={m.label} className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <p className="text-xs text-[var(--muted)]">{m.label}</p>
            <p className="mt-1 text-2xl font-bold text-[var(--brand-deep)]">{m.value}</p>
          </div>
        ))}
      </div>

      {!readOnly ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          {adding ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block text-xs text-[var(--muted)] sm:col-span-2">
                Title
                <select
                  value={form.titleId}
                  onChange={(e) => {
                    const t = titleById.get(e.target.value);
                    setForm((f) => ({ ...f, titleId: e.target.value, location: f.location || t?.shelf || "" }));
                  }}
                  className={`${field} mt-1`}
                >
                  <option value="">Choose…</option>
                  {titles
                    .slice()
                    .sort((a, b) => a.title.localeCompare(b.title))
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title}
                        {t.author ? ` — ${t.author}` : ""}
                      </option>
                    ))}
                </select>
              </label>
              <label className="block text-xs text-[var(--muted)]">
                How many copies
                <input type="number" min={1} max={200} value={form.count} onChange={(e) => setForm((f) => ({ ...f, count: e.target.value }))} className={`${field} mt-1`} />
              </label>
              <label className="block text-xs text-[var(--muted)]">
                Location (rack / shelf)
                <input value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} className={`${field} mt-1`} placeholder="e.g. Rack 3 · Shelf B" list="lib-locations" />
                <datalist id="lib-locations">
                  {locations.map((l) => (
                    <option key={l} value={l} />
                  ))}
                </datalist>
              </label>
              <label className="block text-xs text-[var(--muted)]">
                Source
                <select value={form.source} onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))} className={`${field} mt-1`}>
                  {LIBRARY_COPY_SOURCES.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs text-[var(--muted)]">
                Acquired on
                <input type="date" value={form.acquiredOn} onChange={(e) => setForm((f) => ({ ...f, acquiredOn: e.target.value }))} className={`${field} mt-1`} />
              </label>
              {form.source === "purchase" && state.procurementDocs.length ? (
                <label className="block text-xs text-[var(--muted)] sm:col-span-2">
                  Purchase bill (optional)
                  <select value={form.procurementDocId} onChange={(e) => setForm((f) => ({ ...f, procurementDocId: e.target.value }))} className={`${field} mt-1`}>
                    <option value="">—</option>
                    {state.procurementDocs.map((d) => (
                      <option key={d.id} value={d.id}>
                        {[d.vendor, d.billNo, d.purchaseDate].filter(Boolean).join(" · ") || d.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <div className="flex gap-2 sm:col-span-3">
                <button type="button" className={btn} disabled={busy} onClick={() => void addCopies()}>
                  {busy ? "Adding…" : "Add copies"}
                </button>
                <button type="button" className={btnOutline} onClick={() => setAdding(false)}>
                  Cancel
                </button>
              </div>
              <p className="text-xs text-[var(--muted)] sm:col-span-3">
                Accession numbers are handed out by the server, in order, so two people adding books at once never get the same number.
              </p>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={btn} onClick={() => setAdding(true)}>
                Add copies
              </button>
              {lastAddedCopies.length ? (
                <button type="button" className={btnOutline} onClick={() => void printLabels(lastAddedCopies)}>
                  Print labels for the {lastAddedCopies.length} just added
                </button>
              ) : null}
            </div>
          )}
        </div>
      ) : null}

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(c) => c.id}
        rowActions={rowActions}
        bulkActions={bulkActions}
        selectionNoun="copy"
        exportFileBaseName="library_copies"
        exportTitle="Library copies"
        emptyTitle={state.copies.length ? "No copy matches" : "No copies yet"}
        emptyDescription={state.copies.length ? "Try another word or location." : "Add a title in Catalogue, then add its copies here."}
        toolbar={
          <>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className={`${field} max-w-xs`}
              placeholder="Title, author, accession no., location…"
              aria-label="Search copies"
            />
            <select value={location} onChange={(e) => setLocation(e.target.value)} className={`${field} w-auto`} aria-label="Location">
              <option value="">All locations</option>
              {locations.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={`${field} w-auto`} aria-label="Status">
              <option value="">Any status</option>
              {Object.entries(STATUS_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </>
        }
      />
    </div>
  );
}
