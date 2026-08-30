"use client";

/**
 * Building one page out of blocks — Website Phase 3.
 *
 * The editor is generated from `BLOCK_SHAPES` rather than hand-written per
 * block kind. Adding a field means editing one description, and the editor
 * and the public renderer cannot drift apart about what a block holds.
 *
 * Two rules the office cannot step around:
 *
 *   - A page will not publish while any block is half-filled. The check
 *     names the block and the field, because "something is wrong" sends
 *     someone hunting through a long page.
 *
 *   - Publishing drops the public cache. If that call fails the page is
 *     reported as published-but-still-showing-the-old-text, rather than
 *     letting the office conclude the save silently failed.
 */

import {
  ArrowDown,
  ArrowUp,
  ExternalLink,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { readAll } from "@/lib/data/client/query";
import { writeRecords } from "@/lib/data/client/mutate";
import { getSessionActor } from "@/lib/sessionActor";
import {
  BLOCK_KINDS,
  BLOCK_SHAPES,
  blockProblem,
  blockToRow,
  emptyPayload,
  isBuildableKind,
  mediaReadyForPage,
  newSiteId,
  pageToRow,
  publicPathFor,
  rowToBlock,
  rowToMedia,
  type BlockField,
  type BlockKind,
  type SiteBlock,
  type SiteMedia,
  type SitePage,
} from "@/lib/website";

function fieldValue(payload: Record<string, unknown>, key: string): string {
  const v = payload[key];
  return typeof v === "string" ? v : "";
}

function listOf(
  payload: Record<string, unknown>,
  key: string,
): Record<string, unknown>[] {
  const v = payload[key];
  return Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
}

export function PageEditor({
  page,
  onClose,
  onChanged,
  onError,
  onNotice,
}: {
  page: SitePage;
  onClose: () => void;
  onChanged: () => void;
  onError: (msg: string | null) => void;
  onNotice: (msg: string | null) => void;
}) {
  const [blocks, setBlocks] = useState<SiteBlock[]>([]);
  const [media, setMedia] = useState<SiteMedia[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    const [blockRes, mediaRes] = await Promise.all([
      readAll<Record<string, unknown>>("site.blocks", { maxPages: 5 }),
      readAll<Record<string, unknown>>("site.media", { maxPages: 5 }),
    ]);
    if (!blockRes.ok) {
      onError(`Could not load the page's content: ${blockRes.error}`);
      setLoading(false);
      return;
    }
    setBlocks(
      blockRes.rows
        .map(rowToBlock)
        .filter((b) => b.pageId === page.id && !b.deletedAt)
        .sort((a, b) => a.ord - b.ord),
    );
    if (mediaRes.ok) {
      setMedia(mediaRes.rows.map(rowToMedia).filter((m) => !m.deletedAt));
    }
    setDirty(new Set());
    setLoading(false);
  }, [page.id, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const usableMedia = useMemo(
    () => media.filter((m) => mediaReadyForPage(m).ready),
    [media],
  );

  /** Every reason this page cannot go live, named block by block. */
  const problems = useMemo(() => {
    const out: string[] = [];
    blocks.forEach((b, i) => {
      const problem = blockProblem(b);
      if (problem) {
        const label = BLOCK_KINDS.find((k) => k.id === b.kind)?.label ?? b.kind;
        out.push(`Block ${i + 1} (${label}): ${problem}`);
      }
    });
    return out;
  }, [blocks]);

  function edit(id: string, mutate: (p: Record<string, unknown>) => void) {
    setBlocks((prev) =>
      prev.map((b) => {
        if (b.id !== id) return b;
        const payload = structuredClone(b.payload);
        mutate(payload);
        return { ...b, payload };
      }),
    );
    setDirty((d) => new Set(d).add(id));
  }

  async function addBlock(kind: BlockKind) {
    setBusy(true);
    onError(null);
    if (!(await flushDirty())) {
      setBusy(false);
      return;
    }
    const id = newSiteId("blk");
    const ord = blocks.length ? Math.max(...blocks.map((b) => b.ord)) + 10 : 10;
    const res = await writeRecords("site.blocks", [
      {
        op: "upsert",
        id,
        base: null,
        row: blockToRow({
          pageId: page.id,
          ord,
          kind,
          payload: emptyPayload(kind),
        }),
      },
    ]);
    setBusy(false);
    if (!res.ok) {
      onError(`The block was not added: ${res.message}`);
      return;
    }
    await load();
  }

  async function saveBlock(block: SiteBlock) {
    const res = await writeRecords("site.blocks", [
      {
        op: "upsert",
        id: block.id,
        base: block.updatedAt,
        row: blockToRow({ payload: block.payload, ord: block.ord }),
      },
    ]);
    if (!res.ok) {
      onError(`Block not saved: ${res.message}`);
      return false;
    }
    return true;
  }

  /**
   * Write out every edited block.
   *
   * Everything that reloads from the database has to call this first.
   * Adding, moving or removing a block re-reads the page, and without a
   * flush that read overwrites whatever is still only in the browser — so
   * typing a paragraph and then adding a second block silently discarded
   * the paragraph, with no warning and nothing to undo.
   */
  async function flushDirty(): Promise<boolean> {
    for (const b of blocks) {
      if (!dirty.has(b.id)) continue;
      if (!(await saveBlock(b))) return false;
    }
    return true;
  }

  async function saveAll() {
    setBusy(true);
    onError(null);
    const ok = await flushDirty();
    setBusy(false);
    if (ok) {
      onNotice("Saved.");
      await load();
      onChanged();
    }
  }

  async function move(block: SiteBlock, direction: -1 | 1) {
    const index = blocks.findIndex((b) => b.id === block.id);
    const swapWith = blocks[index + direction];
    if (!swapWith) return;
    setBusy(true);
    if (!(await flushDirty())) {
      setBusy(false);
      return;
    }
    // Swap the two ords rather than renumbering the page: two writes, and
    // an interrupted move leaves the order intact rather than collapsed.
    const res = await writeRecords("site.blocks", [
      {
        op: "upsert",
        id: block.id,
        base: block.updatedAt,
        row: blockToRow({ ord: swapWith.ord }),
      },
      {
        op: "upsert",
        id: swapWith.id,
        base: swapWith.updatedAt,
        row: blockToRow({ ord: block.ord }),
      },
    ]);
    setBusy(false);
    if (!res.ok) {
      onError(`The order was not changed: ${res.message}`);
      return;
    }
    await load();
  }

  async function removeBlock(block: SiteBlock) {
    if (!window.confirm("Remove this block from the page?")) return;
    setBusy(true);
    // The removed block is about to go, but the others' edits must not.
    if (!(await flushDirty())) {
      setBusy(false);
      return;
    }
    const res = await writeRecords("site.blocks", [
      { op: "delete", id: block.id, base: block.updatedAt },
    ]);
    setBusy(false);
    if (!res.ok) {
      onError(`The block was not removed: ${res.message}`);
      return;
    }
    await load();
  }

  async function dropCache() {
    try {
      const res = await fetch("/api/website/revalidate", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lang: page.lang, slug: page.slug }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async function setStatus(status: "published" | "draft") {
    if (status === "published" && problems.length > 0) {
      onError(
        `This page is not ready: ${problems[0]}${problems.length > 1 ? ` (and ${problems.length - 1} more)` : ""}`,
      );
      return;
    }
    setBusy(true);
    onError(null);

    // Unsaved edits first, or the office publishes yesterday's text.
    if (!(await flushDirty())) {
      setBusy(false);
      return;
    }

    const actor = getSessionActor();
    const res = await writeRecords("site.pages", [
      {
        op: "upsert",
        id: page.id,
        base: page.updatedAt,
        row: pageToRow({
          status,
          publishedAt: status === "published" ? new Date().toISOString() : null,
          updatedBy: actor?.fullName || "",
        }),
      },
    ]);
    if (!res.ok) {
      setBusy(false);
      onError(
        `The page was not ${status === "published" ? "published" : "unpublished"}: ${res.message}`,
      );
      return;
    }

    const cacheDropped = await dropCache();
    setBusy(false);

    if (status === "published") {
      onNotice(
        cacheDropped
          ? `Published. It is live at ${publicPathFor(page.slug, page.lang)}.`
          : `Published, but the public copy could not be refreshed — visitors may see the previous version for up to five minutes.`,
      );
    } else {
      onNotice("Taken off the public site.");
    }
    await load();
    onChanged();
  }

  function renderField(
    block: SiteBlock,
    field: BlockField,
    value: string,
    set: (v: string) => void,
  ) {
    const label = (
      <span className="text-[11px] font-medium text-[var(--muted)]">
        {field.label}
        {field.optional ? " (optional)" : ""}
      </span>
    );
    const common =
      "mt-0.5 w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-2.5 py-2 text-sm text-[var(--brand-deep)]";

    if (field.type === "media") {
      return (
        <label key={field.key} className="block">
          {label}
          <select
            className={common}
            value={value}
            onChange={(e) => set(e.target.value)}
          >
            <option value="">Choose a picture…</option>
            {usableMedia.map((m) => (
              <option key={m.id} value={m.id}>
                {m.alt || m.originalFilename || m.id}
              </option>
            ))}
          </select>
          {usableMedia.length === 0 && (
            <span className="mt-1 block text-[10px] text-[var(--muted)]">
              Nothing in the library can be used yet — a picture needs a
              description, and consent must not have been withdrawn.
            </span>
          )}
        </label>
      );
    }

    return (
      <label key={field.key} className="block">
        {label}
        {field.type === "text" ? (
          <textarea
            className={`${common} min-h-[7rem] font-normal`}
            value={value}
            placeholder={field.placeholder}
            onChange={(e) => set(e.target.value)}
          />
        ) : (
          <input
            className={common}
            value={value}
            placeholder={field.placeholder}
            onChange={(e) => set(e.target.value)}
          />
        )}
        {field.help && (
          <span className="mt-1 block text-[10px] leading-relaxed text-[var(--muted)]">
            {field.help}
          </span>
        )}
      </label>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-[var(--shadow-1)]">
        <div>
          <h2 className="text-sm font-bold text-[var(--brand-deep)]">
            {page.title || "Untitled"}
          </h2>
          <p className="mt-0.5 font-mono text-[11px] text-[var(--muted)]">
            {publicPathFor(page.slug, page.lang)}
            {page.slug === "" ? "  (the front page)" : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {page.status === "published" && (
            <a
              href={publicPathFor(page.slug, page.lang)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--muted)]"
            >
              <ExternalLink className="h-3 w-3" />
              View
            </a>
          )}
          <button
            type="button"
            disabled={busy || dirty.size === 0}
            onClick={() => void saveAll()}
            className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--brand-deep)] disabled:opacity-40"
          >
            {dirty.size > 0
              ? `Save ${dirty.size} change${dirty.size === 1 ? "" : "s"}`
              : "Saved"}
          </button>
          {page.status === "published" ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void setStatus("draft")}
              className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--muted)] disabled:opacity-40"
            >
              Take off the site
            </button>
          ) : (
            <button
              type="button"
              disabled={busy || blocks.length === 0}
              onClick={() => void setStatus("published")}
              className="rounded-lg bg-[var(--brand-deep)] px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-40"
            >
              Publish
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            title="Close"
            className="rounded-lg border border-[var(--border)] p-1.5 text-[var(--muted)]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {problems.length > 0 && (
        <div className="rounded-xl border border-[rgba(197,160,40,0.4)] bg-[rgba(197,160,40,0.08)] px-3 py-2.5">
          <p className="text-[11px] font-semibold text-[var(--brand-deep)]">
            Not ready to publish:
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] text-[var(--brand-deep)]">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      {loading ? (
        <p className="p-6 text-sm text-[var(--muted)]">Loading…</p>
      ) : (
        <div className="space-y-3">
          {blocks.map((block, i) => {
            const shape = BLOCK_SHAPES[block.kind];
            const kindLabel =
              BLOCK_KINDS.find((k) => k.id === block.kind)?.label ?? block.kind;
            return (
              <section
                key={block.id}
                className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-[var(--shadow-1)]"
              >
                <div className="mb-3 flex items-center justify-between gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">
                    {i + 1}. {kindLabel}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={busy || i === 0}
                      onClick={() => void move(block, -1)}
                      title="Move up"
                      className="rounded-lg border border-[var(--border)] p-1 text-[var(--muted)] disabled:opacity-30"
                    >
                      <ArrowUp className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      disabled={busy || i === blocks.length - 1}
                      onClick={() => void move(block, 1)}
                      title="Move down"
                      className="rounded-lg border border-[var(--border)] p-1 text-[var(--muted)] disabled:opacity-30"
                    >
                      <ArrowDown className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void removeBlock(block)}
                      title="Remove block"
                      className="rounded-lg border border-[var(--border)] p-1 text-[var(--muted)] disabled:opacity-30"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>

                {!shape ? (
                  <p className="text-[11px] text-[var(--muted)]">
                    This block reads from another desk and is wired up in the
                    next phase.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {shape.fields.map((f) =>
                      renderField(
                        block,
                        f,
                        fieldValue(block.payload, f.key),
                        (v) =>
                          edit(block.id, (p) => {
                            p[f.key] = v;
                          }),
                      ),
                    )}

                    {shape.list && (
                      <div className="space-y-2 rounded-xl border border-dashed border-[var(--border)] p-3">
                        {listOf(block.payload, shape.list.key).map(
                          (item, idx) => (
                            <div
                              key={idx}
                              className="flex flex-wrap items-end gap-2 border-b border-[var(--border)] pb-2 last:border-0 last:pb-0"
                            >
                              {shape.list!.fields.map((f) => (
                                <div
                                  key={f.key}
                                  className="min-w-[10rem] flex-1"
                                >
                                  {renderField(
                                    block,
                                    f,
                                    typeof item[f.key] === "string"
                                      ? (item[f.key] as string)
                                      : "",
                                    (v) =>
                                      edit(block.id, (p) => {
                                        const list = [
                                          ...(p[shape.list!.key] as Record<
                                            string,
                                            unknown
                                          >[]),
                                        ];
                                        list[idx] = {
                                          ...list[idx],
                                          [f.key]: v,
                                        };
                                        p[shape.list!.key] = list;
                                      }),
                                  )}
                                </div>
                              ))}
                              <button
                                type="button"
                                title={`Remove this ${shape.list!.noun}`}
                                disabled={
                                  listOf(block.payload, shape.list!.key)
                                    .length <= shape.list!.min
                                }
                                onClick={() =>
                                  edit(block.id, (p) => {
                                    const list = [
                                      ...(p[shape.list!.key] as Record<
                                        string,
                                        unknown
                                      >[]),
                                    ];
                                    list.splice(idx, 1);
                                    p[shape.list!.key] = list;
                                  })
                                }
                                className="rounded-lg border border-[var(--border)] p-1.5 text-[var(--muted)] disabled:opacity-30"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          ),
                        )}
                        <button
                          type="button"
                          disabled={
                            listOf(block.payload, shape.list.key).length >=
                            shape.list.max
                          }
                          onClick={() =>
                            edit(block.id, (p) => {
                              const blank: Record<string, unknown> = {};
                              for (const f of shape.list!.fields)
                                blank[f.key] = "";
                              p[shape.list!.key] = [
                                ...(p[shape.list!.key] as Record<
                                  string,
                                  unknown
                                >[]),
                                blank,
                              ];
                            })
                          }
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--brand-deep)] disabled:opacity-40"
                        >
                          <Plus className="h-3 w-3" />
                          Add another {shape.list.noun}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </section>
            );
          })}

          <section className="rounded-2xl border border-dashed border-[var(--border)] p-4">
            <p className="text-[11px] font-semibold text-[var(--muted)]">
              Add a block
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {BLOCK_KINDS.filter((k) => isBuildableKind(k.id)).map((k) => (
                <button
                  key={k.id}
                  type="button"
                  disabled={busy}
                  onClick={() => void addBlock(k.id)}
                  title={k.blurb}
                  className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--brand-deep)] disabled:opacity-40"
                >
                  {k.label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[10px] text-[var(--muted)]">
              Galleries, news, the calendar, staff lists and the enquiry form
              read from the other desks and are wired up in the next phase.
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
