"use client";

import { useEffect, useState } from "react";
import { BookOpen, FileText, Link2, PlayCircle, Trash2 } from "lucide-react";
import type { ResourceKind, ResourceLink } from "@/lib/teaching";
import { bookcaseCode } from "@/lib/library";

const KIND_ICON = {
  ebook: BookOpen,
  pdf: FileText,
  video: PlayCircle,
  link: Link2,
} as const;

const KIND_LABEL: Record<ResourceKind, string> = {
  ebook: "E-book",
  pdf: "PDF",
  video: "Video",
  link: "Link",
};

/**
 * Read-only list of content links.
 *
 * Every anchor carries rel="noopener noreferrer": these URLs are typed in
 * by staff, and without `noopener` the opened page gets a handle on this
 * window via `window.opener`.
 */
export function ResourceList({
  resources,
  onRemove,
}: {
  resources: ResourceLink[];
  onRemove?: (id: string) => void;
}) {
  if (resources.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1">
      {resources.map((r) => {
        const Icon = KIND_ICON[r.kind];
        return (
          <li key={r.id} className="flex items-center gap-2 text-xs">
            <Icon className="h-3.5 w-3.5 shrink-0 text-[var(--muted)]" />
            <a
              href={r.url}
              target="_blank"
              rel="noopener noreferrer"
              className="truncate font-medium text-[var(--info)] underline"
            >
              {r.title}
            </a>
            {r.locator ? (
              <span className="shrink-0 text-[var(--muted)]">· {r.locator}</span>
            ) : null}
            <span className="shrink-0 rounded-full bg-[var(--surface-sunken)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--muted)]">
              {KIND_LABEL[r.kind]}
            </span>
            {onRemove ? (
              <button
                type="button"
                onClick={() => onRemove(r.id)}
                aria-label={`Remove ${r.title}`}
                className="shrink-0 text-[var(--danger)]"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** Inline "paste an e-book link" form. */
export function AddResourceForm({
  onAdd,
  compact = false,
}: {
  onAdd: (input: {
    kind: ResourceKind;
    title: string;
    url: string;
    locator: string;
  }) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ResourceKind>("ebook");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [locator, setLocator] = useState("");
  /**
   * The school's own shelf, offered as a picker so a teacher attaches the
   * class e-book without hunting for its link. Read from the library desk
   * (hydrated on demand) rather than the keyed reader API: the picker needs
   * titles and links, never the pass keys. Books whose reading link is the
   * shelf front page (blank url) are skipped — there is nothing chapter-
   * specific to attach for those.
   */
  const [shelf, setShelf] = useState<
    { id: string; title: string; subject: string; classLabels: string[]; url: string }[]
  >([]);
  useEffect(() => {
    if (!open) return;
    let live = true;
    void (async () => {
      try {
        const { ensureLibraryHydrated } = await import("@/lib/libraryPersistence");
        await ensureLibraryHydrated();
      } catch {
        // Fall through to whatever is cached.
      }
      const { loadLibrary } = await import("@/lib/library");
      if (!live) return;
      setShelf(
        loadLibrary()
          .ebooks.filter((b) => b.isActive && b.url.trim() !== "")
          .map((b) => ({
            id: b.id,
            title: b.title,
            subject: b.subject,
            classLabels: b.classLabels,
            url: b.url,
          }))
          .sort(
            (a, b) =>
              a.subject.localeCompare(b.subject) ||
              a.title.localeCompare(b.title),
          ),
      );
    })();
    return () => {
      live = false;
    };
  }, [open]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 text-xs font-semibold text-[var(--brand-deep)] underline"
      >
        + Add e-book / content link
      </button>
    );
  }

  function submit() {
    onAdd({ kind, title, url, locator });
    setTitle("");
    setUrl("");
    setLocator("");
    setOpen(false);
  }

  return (
    <div
      className={`mt-2 flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-[var(--border)] px-3 py-2 ${
        compact ? "text-xs" : ""
      }`}
    >
      <label className="text-[11px] font-semibold text-[var(--muted)]">
        Type
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as ResourceKind)}
          className="mt-1 block rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-xs"
        >
          <option value="ebook">E-book</option>
          <option value="pdf">PDF</option>
          <option value="video">Video</option>
          <option value="link">Link</option>
        </select>
      </label>
      {kind === "ebook" && shelf.length > 0 ? (
        <label className="text-[11px] font-semibold text-[var(--muted)]">
          From school shelf
          <select
            value=""
            onChange={(e) => {
              const b = shelf.find((x) => x.id === e.target.value);
              if (!b) return;
              setTitle(b.title || `Shelf ${bookcaseCode(b.url)}`);
              setUrl(b.url);
            }}
            className="mt-1 block w-56 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-xs"
          >
            <option value="">Pick a book…</option>
            {shelf.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title || `Untitled shelf (${bookcaseCode(b.url) || "?"})`}
                {b.classLabels.length > 0 ? ` (${b.classLabels.join(", ")})` : ""}
                {b.subject ? ` · ${b.subject}` : ""}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="text-[11px] font-semibold text-[var(--muted)]">
        Title
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Class VIII Maths e-book"
          className="mt-1 block w-52 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-xs"
        />
      </label>
      <label className="text-[11px] font-semibold text-[var(--muted)]">
        Link
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…"
          className="mt-1 block w-64 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-xs"
        />
      </label>
      <label className="text-[11px] font-semibold text-[var(--muted)]">
        Page / ref
        <input
          value={locator}
          onChange={(e) => setLocator(e.target.value)}
          placeholder="p. 42"
          className="mt-1 block w-24 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-xs"
        />
      </label>
      <button
        type="button"
        onClick={submit}
        className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-[var(--primary-foreground)]"
      >
        Add
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="px-2 py-1.5 text-xs font-semibold text-[var(--muted)]"
      >
        Cancel
      </button>
    </div>
  );
}
