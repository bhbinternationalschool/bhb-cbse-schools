"use client";

/**
 * The Website desk — Phase 1: the page list.
 *
 * Reads and writes `site_pages` through the generic data API, which means
 * every change is a stated per-record op carrying the revision the browser
 * believed it was editing. There is deliberately no localStorage mirror: the
 * public site is read by people with no browser storage of ours, and a stale
 * tab pushing a whole-module state is what emptied the Transport desk.
 *
 * Blocks, media and the public renderer arrive in Phases 2 and 3. What is
 * here is the part they all hang off: a page can be made, named, addressed
 * and removed, and only staff whose role includes Website can do it.
 */

import {
  Globe,
  Globe2,
  Image as ImageIcon,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ErpWorkspaceShell } from "@/components/ui/erp-workspace-shell";
import { MediaLibrary } from "@/components/website/MediaLibrary";
import { PageEditor } from "@/components/website/PageEditor";
import { Publications } from "@/components/website/Publications";
import {
  ErpTable,
  ErpTableBody,
  ErpTableHead,
  ErpTableShell,
} from "@/components/ui/erp-roster";
import { readAll } from "@/lib/data/client/query";
import { writeRecords } from "@/lib/data/client/mutate";
import { getSessionActor } from "@/lib/sessionActor";
import { hasPermission } from "@/lib/rbac";
import { useDemoSession } from "@/components/shell/SessionContext";
import {
  HOME_SLUG,
  LANGUAGES,
  PAGE_STATUSES,
  newSiteId,
  normalizeSlug,
  pageStatusLabel,
  pageToRow,
  publicPathFor,
  rowToPage,
  slugProblem,
  type PageStatus,
  type SiteLang,
  type SitePage,
} from "@/lib/website";
import { RowActionMenu } from "@/components/ui/erp-grid";

type Filter = PageStatus | "all";
type Tab = "pages" | "media" | "publish";

const STATUS_TONE: Record<PageStatus, string> = {
  draft: "bg-[var(--surface-sunken)] text-[var(--muted)]",
  scheduled: "bg-[rgba(197,160,40,0.14)] text-[var(--warning,#8a6d1f)]",
  published: "bg-[rgba(44,98,71,0.13)] text-[var(--success)]",
  archived: "bg-[var(--surface-sunken)] text-[var(--muted)]",
};

export function WebsiteWorkspace() {
  const [pages, setPages] = useState<SitePage[]>([]);
  const [loading, setLoading] = useState(true);
  /**
   * Author drafts, director approves. The server refuses a publish without
   * `website:approve` regardless of what this says — this only decides
   * whether someone is shown a button that would fail, or told why.
   */
  const session = useDemoSession();
  const canPublish = hasPermission(session, null, "website", "approve");

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [tab, setTab] = useState<Tab>("pages");
  const [busy, setBusy] = useState(false);

  // The site ships English; the picker exists so a Hindi twin can be made
  // the day the office wants one, without a migration.
  const [lang, setLang] = useState<SiteLang>("en");

  // Which page is open in the block editor, if any.
  const [editingId, setEditingId] = useState<string | null>(null);

  // The front page is addressed by the empty slug, so it has to be chosen
  // deliberately rather than reached by clearing the address field.
  const [isHome, setIsHome] = useState(false);

  const [newTitle, setNewTitle] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await readAll<Record<string, unknown>>("site.pages", {
      maxPages: 5,
    });
    if (!res.ok) {
      // Say which failure it was. "Could not load" sends someone to the wrong
      // place when the real answer is that their role lacks the module.
      setError(
        res.code === "auth"
          ? "Your role does not include the Website module. Ask an admin to add it under Roles & permissions."
          : `Could not load pages: ${res.error}`,
      );
      setPages([]);
      setLoading(false);
      return;
    }
    setError(
      res.complete
        ? null
        : "Showing the first pages only — there are more than this desk reads in one go.",
    );
    setPages(res.rows.map(rowToPage).filter((p) => !p.deletedAt));
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Only pages in the SAME language can clash: /about and /hi/about are
  // different addresses, and refusing the second would be a bug.
  const liveSlugs = useMemo(
    () => pages.filter((p) => p.lang === lang).map((p) => p.slug),
    [pages, lang],
  );
  const suggestedSlug = isHome
    ? HOME_SLUG
    : slugTouched
      ? newSlug
      : normalizeSlug(newTitle);
  const newSlugProblem =
    newTitle.trim() || suggestedSlug || isHome
      ? slugProblem(suggestedSlug, {
          existingSlugs: liveSlugs,
          lang,
          allowHome: isHome,
        })
      : null;

  const shown = useMemo(
    () =>
      pages
        .filter((p) => filter === "all" || p.status === filter)
        .sort((a, b) => a.slug.localeCompare(b.slug)),
    [pages, filter],
  );

  const editingPage = useMemo(
    () => pages.find((p) => p.id === editingId) ?? null,
    [pages, editingId],
  );

  const counts = useMemo(() => {
    const map = new Map<Filter, number>([["all", pages.length]]);
    for (const s of PAGE_STATUSES) {
      map.set(s.id, pages.filter((p) => p.status === s.id).length);
    }
    return map;
  }, [pages]);

  async function createPage() {
    const title = newTitle.trim();
    const slug = isHome ? HOME_SLUG : normalizeSlug(suggestedSlug);
    const problem = slugProblem(slug, {
      existingSlugs: liveSlugs,
      lang,
      allowHome: isHome,
    });
    if (!title) {
      setError("Give the page a title.");
      return;
    }
    if (problem) {
      setError(problem);
      return;
    }

    setBusy(true);
    setError(null);
    const actor = getSessionActor();
    const id = newSiteId("pg");
    const res = await writeRecords("site.pages", [
      {
        op: "upsert",
        id,
        base: null,
        row: pageToRow({
          slug,
          lang,
          title,
          status: "draft",
          navGroup: "",
          createdBy: actor?.fullName || "",
          updatedBy: actor?.fullName || "",
        }),
      },
    ]);
    setBusy(false);

    if (!res.ok) {
      setError(
        res.kind === "auth"
          ? "Your role cannot create website pages."
          : `The page was not saved: ${res.message}`,
      );
      return;
    }
    setNewTitle("");
    setNewSlug("");
    setSlugTouched(false);
    setIsHome(false);
    setNotice(`“${title}” created as a draft.`);
    await load();
  }

  async function removePage(page: SitePage) {
    if (
      !window.confirm(
        `Remove “${page.title || page.slug}”?\n\nIt comes off the site and out of this list. The page is kept on file, so it can be restored.`,
      )
    ) {
      return;
    }
    setBusy(true);
    const res = await writeRecords("site.pages", [
      { op: "delete", id: page.id, base: page.updatedAt || null },
    ]);
    setBusy(false);
    if (!res.ok) {
      setError(`The page was not removed: ${res.message}`);
      return;
    }
    setNotice(`“${page.title || page.slug}” removed.`);
    await load();
  }

  return (
    <ErpWorkspaceShell
      title="Website"
      subtitle="Pages on bhbinternational.school, and what the public can see."
      icon={<Globe className="h-5 w-5" />}
      error={error}
      notice={notice}
    >
      <div className="flex gap-2 border-b border-[var(--border)]">
        {(
          [
            { id: "pages", label: "Pages", icon: Globe },
            { id: "media", label: "Pictures & files", icon: ImageIcon },
            { id: "publish", label: "Show on website", icon: Globe2 },
          ] as const
        ).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-semibold ${
              tab === id
                ? "border-[var(--brand-deep)] text-[var(--brand-deep)]"
                : "border-transparent text-[var(--muted)]"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {tab === "media" ? (
        <MediaLibrary onError={setError} onNotice={setNotice} />
      ) : tab === "publish" ? (
        <Publications onError={setError} onNotice={setNotice} />
      ) : editingPage ? (
        <PageEditor
          page={editingPage}
          canPublish={canPublish}
          onClose={() => setEditingId(null)}
          onChanged={() => void load()}
          onError={setError}
          onNotice={setNotice}
        />
      ) : (
        <div className="space-y-4">
          <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-[var(--shadow-1)]">
            <h2 className="text-sm font-bold text-[var(--brand-deep)]">
              Add a page
            </h2>
            <p className="mt-1 text-[11px] text-[var(--muted)]">
              New pages start as drafts. Nothing is public until it is
              published.
            </p>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <label className="min-w-[14rem] flex-1 text-[11px] text-[var(--muted)]">
                Page title
                <input
                  className="mt-0.5 w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-2.5 py-2 text-sm text-[var(--brand-deep)]"
                  value={newTitle}
                  placeholder="Admissions"
                  onChange={(e) => setNewTitle(e.target.value)}
                />
              </label>
              <label className="min-w-[14rem] flex-1 text-[11px] text-[var(--muted)]">
                Address
                <div className="mt-0.5 flex items-center rounded-lg border border-[var(--border)] bg-[var(--card)] pl-2.5">
                  <span className="shrink-0 text-xs text-[var(--muted)]">
                    bhbinternational.school{lang === "en" ? "/" : "/hi/"}
                  </span>
                  <input
                    className="w-full bg-transparent px-1 py-2 text-sm text-[var(--brand-deep)] outline-none"
                    value={suggestedSlug}
                    disabled={isHome}
                    placeholder={
                      isHome ? "the front page itself" : "admissions"
                    }
                    onChange={(e) => {
                      setSlugTouched(true);
                      setNewSlug(e.target.value);
                    }}
                  />
                </div>
              </label>
              <label className="flex items-center gap-1.5 pb-2 text-[11px] text-[var(--muted)]">
                <input
                  type="checkbox"
                  checked={isHome}
                  onChange={(e) => setIsHome(e.target.checked)}
                />
                Front page
              </label>
              <label className="text-[11px] text-[var(--muted)]">
                Language
                <select
                  className="mt-0.5 block rounded-lg border border-[var(--border)] bg-[var(--card)] px-2.5 py-2 text-sm text-[var(--brand-deep)]"
                  value={lang}
                  onChange={(e) => setLang(e.target.value as SiteLang)}
                >
                  {LANGUAGES.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--brand-deep)] px-3.5 py-2 text-xs font-bold text-white disabled:opacity-60"
                disabled={busy || !newTitle.trim() || !!newSlugProblem}
                onClick={() => void createPage()}
              >
                <Plus className="h-3.5 w-3.5" />
                {busy ? "Saving…" : "Add page"}
              </button>
            </div>
            {newSlugProblem ? (
              <p className="mt-2 text-[11px] font-semibold text-[var(--danger)]">
                {newSlugProblem}
              </p>
            ) : null}
          </section>

          <div className="flex flex-wrap gap-2">
            {(["all", ...PAGE_STATUSES.map((s) => s.id)] as Filter[]).map(
              (id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setFilter(id)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                    filter === id
                      ? "bg-[var(--brand-deep)] text-white"
                      : "border border-[var(--border)] text-[var(--muted)]"
                  }`}
                >
                  {id === "all" ? "All" : pageStatusLabel(id as PageStatus)}
                  <span className="ml-1.5 opacity-70">
                    {counts.get(id) ?? 0}
                  </span>
                </button>
              ),
            )}
          </div>

          <ErpTableShell exportAs="website_pages" exportTitle="Website pages">
            {loading ? (
              <p className="p-6 text-sm text-[var(--muted)]">Loading pages…</p>
            ) : shown.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-sm font-semibold text-[var(--brand-deep)]">
                  {pages.length === 0
                    ? "No pages yet"
                    : "No pages with that status"}
                </p>
                <p className="mx-auto mt-1 max-w-md text-xs text-[var(--muted)]">
                  {pages.length === 0
                    ? "Add the first one above. Home, About, Academics and Admissions are the four most parents look for."
                    : "Change the filter to see the rest."}
                </p>
              </div>
            ) : (
              <ErpTable minWidth="min-w-[640px]">
                <ErpTableHead>
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">Page</th>
                    <th className="px-4 py-2.5 font-semibold">Address</th>
                    <th className="px-4 py-2.5 font-semibold">In menu</th>
                    <th className="px-4 py-2.5 font-semibold">Status</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </ErpTableHead>
                <ErpTableBody hoverable>
                  {shown.map((page) => (
                    <tr key={page.id}>
                      <td className="px-4 py-2.5 font-semibold text-[var(--brand-deep)]">
                        {page.title || "Untitled"}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-[var(--muted)]">
                        {publicPathFor(page.slug, page.lang)}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-[var(--muted)]">
                        {page.navGroup === "header"
                          ? "Top menu"
                          : page.navGroup === "footer"
                            ? "Footer"
                            : "Not listed"}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${STATUS_TONE[page.status]}`}
                        >
                          {pageStatusLabel(page.status)}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <RowActionMenu
                          row={page}
                          label={`Actions for ${page.title}`}
                          actions={[
                            { id: "edit", label: "Edit page", icon: <Pencil />, onSelect: (p) => setEditingId(p.id) },
                            {
                              id: "open",
                              label: "Open on the site",
                              onSelect: (p) => window.open(`/${p.slug}`.replace(/\/+/g, "/"), "_blank", "noopener"),
                            },
                            {
                              id: "remove",
                              label: "Remove page",
                              icon: <Trash2 />,
                              tone: "danger",
                              separatorAbove: true,
                              disabled: () => busy,
                              onSelect: (p) => void removePage(p),
                            },
                          ]}
                        />
                      </td>
                    </tr>
                  ))}
                </ErpTableBody>
              </ErpTable>
            )}
          </ErpTableShell>

          <p className="text-[11px] leading-relaxed text-[var(--muted)]">
            Edit a page to build it out of blocks, then publish it. A published
            page is live immediately at the address shown; a draft is not
            readable by anyone, even with the address.
          </p>
        </div>
      )}
    </ErpWorkspaceShell>
  );
}
