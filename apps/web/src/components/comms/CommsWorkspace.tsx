"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Images, Megaphone } from "lucide-react";
import { useDemoSession, useSessionReadOnly } from "@/components/shell/SessionContext";
import { ModuleTabs, type ModuleTabItem } from "@/components/ui/ModuleTabs";
import { CommsReportsRunner } from "@/components/reports/ModuleReportRunners";
import { ErpTableShell } from "@/components/ui/erp-roster";
import { ErpWorkspaceShell } from "@/components/ui/erp-workspace-shell";
import { ClassChannelsPanel } from "@/components/comms/ClassChannelsPanel";
import { SocialCredentialsPanel } from "@/components/comms/SocialCredentialsPanel";
import { SocialCrossPostPrefsPanel } from "@/components/comms/SocialCrossPostPanel";
import { WaChatHubPanel } from "@/components/comms/WaChatHubPanel";
import { HouseholdMessageLogPanel } from "@/components/comms/HouseholdMessageLogPanel";
import {
  addGalleryPhoto,
  audienceLabel,
  deleteAlbum,
  deleteGalleryPhoto,
  deleteNews,
  deleteNotice,
  listAlbums,
  listNews,
  listNotices,
  listScheduledComms,
  loadSchoolComms,
  photosForAlbum,
  setAlbumStatus,
  setNoticeStatus,
  setNewsStatus,
  upsertAlbum,
  upsertNews,
  upsertNotice,
  type CommsAudience,
  type GalleryAlbum,
  type SchoolCommsState,
  type SchoolNewsItem,
  type SchoolNotice,
} from "@/lib/schoolComms";
import {
  currentStaffRecipientKey,
  listNotificationsFor,
  loadNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  pruneNotifications,
  type AppNotification,
  type NotificationsState,
} from "@/lib/notifications";
import { uploadSchoolObject } from "@/lib/objectStorage";
import { publicPortalOrigin } from "@/lib/admissions";
import {
  buildCrossPostPayload,
  loadSocialCrossPostPrefs,
  requestSocialCrossPost,
  summarizeCrossPostResult,
  type SocialCrossPostLogEntry,
} from "@/lib/socialCrossPost";
import { TENANT } from "@/lib/types";
import { btn, btnOutline, field } from "@/components/ui/erp-ui";
import { DeskListActions } from "@/components/ui/desk-list-actions";
import { ModuleDashboardHost } from "@/components/dashboard/ModuleDashboardHost";

type CommsTab =
  | "dashboard"
  | "notices"
  | "news"
  | "gallery"
  | "social"
  | "inbox"
  | "channels"
  | "wa_hub"
  | "household_log"
  | "reports";

const TABS: ModuleTabItem[] = [
  { id: "dashboard", label: "Dashboard", tone: "navy" },
  { id: "notices", label: "Notices", tone: "navy" },
  { id: "news", label: "News", tone: "teal" },
  { id: "gallery", label: "Gallery", tone: "amber" },
  { id: "social", label: "Social", tone: "rose" },
  { id: "channels", label: "Class WA", tone: "violet" },
  { id: "wa_hub", label: "WhatsApp hub", tone: "teal" },
  { id: "household_log", label: "Household log", tone: "slate" },
  { id: "inbox", label: "Inbox", tone: "slate" },
  { id: "reports", label: "Reports", tone: "coral" },
];

function tabFromSearch(raw: string | null, path: string): CommsTab {
  if (path.startsWith("/news")) return "news";
  if (path.startsWith("/gallery")) return "gallery";
  if (path.startsWith("/notices")) return "notices";
  if (
    raw === "dashboard" ||
    raw === "news" ||
    raw === "gallery" ||
    raw === "social" ||
    raw === "inbox" ||
    raw === "notices" ||
    raw === "channels" ||
    raw === "wa_hub" ||
    raw === "household_log" ||
    raw === "reports"
  ) {
    return raw;
  }
  return "notices";
}

export function CommsWorkspace() {
  const session = useDemoSession();
  const readOnly = useSessionReadOnly();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = tabFromSearch(searchParams.get("tab"), pathname || "/comms");

  const [comms, setComms] = useState<SchoolCommsState | null>(() =>
    typeof window !== "undefined" ? loadSchoolComms() : null,
  );
  const [inbox, setInbox] = useState<NotificationsState | null>(() =>
    typeof window !== "undefined" ? loadNotifications() : null,
  );
  const [noticeMsg, setNoticeMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [listQuery, setListQuery] = useState("");
  const [kbStats, setKbStats] = useState<{
    chunkCount: number;
    embeddingsConfigured: boolean;
  } | null>(null);
  const [kbSyncBusy, setKbSyncBusy] = useState(false);
  const [kbSyncMsg, setKbSyncMsg] = useState<string | null>(null);

  const refreshKbStats = useCallback(() => {
    fetch("/api/ai/kb-sync")
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (json?.ok) {
          setKbStats({
            chunkCount: json.chunkCount,
            embeddingsConfigured: json.embeddingsConfigured,
          });
        }
      })
      .catch(() => null);
  }, []);

  useEffect(() => {
    refreshKbStats();
  }, [refreshKbStats]);

  async function syncKb() {
    setKbSyncBusy(true);
    setKbSyncMsg(null);
    try {
      const res = await fetch("/api/ai/kb-sync", { method: "POST" });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        indexed?: number;
        skipped?: number;
        removed?: number;
      };
      if (!res.ok || !json.ok) {
        setKbSyncMsg(json.error || "Sync failed");
        return;
      }
      setKbSyncMsg(
        `Synced ${json.indexed} notice(s)${json.skipped ? `, ${json.skipped} skipped` : ""}${json.removed ? `, ${json.removed} removed` : ""}.`,
      );
      refreshKbStats();
    } catch (e) {
      setKbSyncMsg(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setKbSyncBusy(false);
    }
  }

  // Notice form
  const [nTitle, setNTitle] = useState("");
  const [nBody, setNBody] = useState("");
  const [nAudience, setNAudience] = useState<CommsAudience>("all");
  const [nPinned, setNPinned] = useState(false);
  const [nScheduleAt, setNScheduleAt] = useState("");
  const [editNoticeId, setEditNoticeId] = useState<string | null>(null);

  // News form
  const [wTitle, setWTitle] = useState("");
  const [wSummary, setWSummary] = useState("");
  const [wBody, setWBody] = useState("");
  const [wCover, setWCover] = useState("");
  const [wScheduleAt, setWScheduleAt] = useState("");
  const [editNewsId, setEditNewsId] = useState<string | null>(null);

  // Gallery
  const [aTitle, setATitle] = useState("");
  const [aDesc, setADesc] = useState("");
  const [aScheduleAt, setAScheduleAt] = useState("");
  const [editAlbumId, setEditAlbumId] = useState<string | null>(null);
  const [activeAlbumId, setActiveAlbumId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [socialLogs, setSocialLogs] = useState<SocialCrossPostLogEntry[]>([]);
  const [socialBusy, setSocialBusy] = useState(false);

  const actor = session.fullName || "Office";
  const recipientKey = currentStaffRecipientKey();

  function flash(msg: string) {
    setNoticeMsg(msg);
    setError(null);
    window.setTimeout(() => setNoticeMsg(null), 2800);
  }

  function reloadSocialLogs() {
    void fetch("/api/integrations/social/cross-post?limit=40")
      .then((r) => (r.ok ? r.json() : { logs: [] }))
      .then((j: { logs?: SocialCrossPostLogEntry[] }) =>
        setSocialLogs(j.logs ?? []),
      )
      .catch(() => setSocialLogs([]));
  }

  async function runCrossPost(
    payload: Parameters<typeof buildCrossPostPayload>[0],
    opts?: { force?: boolean },
  ) {
    const prefs = loadSocialCrossPostPrefs();
    if (!prefs.enabled && !opts?.force) return;
    if (!prefs.platforms.length && !opts?.force) return;

    setSocialBusy(true);
    try {
      const result = await requestSocialCrossPost(
        buildCrossPostPayload({ ...payload, force: opts?.force }),
      );
      const summary = summarizeCrossPostResult(result);
      if (result.ok || result.results.some((r) => r.skipped)) {
        flash(`Social: ${summary}`);
      } else {
        setError(`Social cross-post: ${summary}`);
      }
      reloadSocialLogs();
    } finally {
      setSocialBusy(false);
    }
  }

  function crossPostNotice(notice: SchoolNotice, force = false) {
    if (notice.audience !== "all" && notice.audience !== "parents") return;
    void runCrossPost(
      {
        kind: "notice",
        contentId: notice.id,
        title: notice.title,
        body: notice.body,
        linkUrl: `${publicPortalOrigin()}/parent?tab=notices`,
      },
      { force },
    );
  }

  function crossPostNewsItem(item: SchoolNewsItem, force = false) {
    void runCrossPost(
      {
        kind: "news",
        contentId: item.id,
        title: item.title,
        body: item.body,
        summary: item.summary,
        imageUrl: item.coverUrl,
        linkUrl: `${publicPortalOrigin()}/parent?tab=news`,
      },
      { force },
    );
  }

  function crossPostAlbum(album: GalleryAlbum, state: SchoolCommsState, force = false) {
    const photos = photosForAlbum(album.id, state)
      .map((p) => p.url)
      .filter(Boolean);
    void runCrossPost(
      {
        kind: "gallery",
        contentId: album.id,
        title: album.title,
        body: album.description || album.title,
        summary: album.description,
        imageUrl: album.coverUrl || photos[0],
        imageUrls: photos.slice(0, 10),
        linkUrl: `${publicPortalOrigin()}/parent?tab=gallery`,
      },
      { force },
    );
  }

  function reload() {
    setComms(loadSchoolComms());
    setInbox(loadNotifications());
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [{ ensureSchoolCommsHydrated }, { ensureNotificationsHydrated }] =
        await Promise.all([
          import("@/lib/schoolCommsPersistence"),
          import("@/lib/notificationsPersistence"),
        ]);
      await Promise.all([
        ensureSchoolCommsHydrated(),
        ensureNotificationsHydrated(),
      ]);
      if (!cancelled) reload();
    })();
    reloadSocialLogs();
    function onNf() {
      setInbox(loadNotifications());
    }
    window.addEventListener("bhb-notifications", onNf);
    return () => {
      cancelled = true;
      window.removeEventListener("bhb-notifications", onNf);
    };

  }, []);

  // Deep-link from Events "View photos" — auto-select the album named in
  // ?album= instead of leaving the parent to hunt through the album list.
  useEffect(() => {
    const albumParam = searchParams.get("album");
    if (albumParam) setActiveAlbumId(albumParam);
  }, [searchParams]);

  function setTab(next: CommsTab) {
    const url = new URL(window.location.href);
    url.pathname = "/comms";
    url.searchParams.set("tab", next);
    router.replace(`${url.pathname}?${url.searchParams.toString()}`);
    setListQuery("");
  }

  function matchesListQuery(blob: string, q: string): boolean {
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    return blob.toLowerCase().includes(needle);
  }

  const notices = useMemo(
    () => (comms ? listNotices(comms) : []),
    [comms],
  );
  const noticesFiltered = useMemo(
    () =>
      notices.filter((n) =>
        matchesListQuery(
          `${n.title} ${n.body} ${n.status} ${audienceLabel(n.audience)}`,
          listQuery,
        ),
      ),
    [notices, listQuery],
  );
  const news = useMemo(() => (comms ? listNews(comms) : []), [comms]);
  const newsFiltered = useMemo(
    () =>
      news.filter((n) =>
        matchesListQuery(`${n.title} ${n.summary} ${n.body} ${n.status}`, listQuery),
      ),
    [news, listQuery],
  );
  const albums = useMemo(() => (comms ? listAlbums(comms) : []), [comms]);
  const albumsFiltered = useMemo(
    () =>
      albums.filter((a) =>
        matchesListQuery(`${a.title} ${a.description} ${a.status}`, listQuery),
      ),
    [albums, listQuery],
  );
  const albumPhotos = useMemo(
    () =>
      activeAlbumId && comms ? photosForAlbum(activeAlbumId, comms) : [],
    [activeAlbumId, comms],
  );
  const scheduledItems = useMemo(
    () => (comms ? listScheduledComms(comms) : []),
    [comms],
  );
  const notifications = useMemo(
    () =>
      inbox
        ? listNotificationsFor(recipientKey, "staff", inbox)
        : [],
    [inbox, recipientKey],
  );
  const notificationsFiltered = useMemo(
    () =>
      notifications.filter((n) =>
        matchesListQuery(`${n.title} ${n.body} ${n.kind}`, listQuery),
      ),
    [notifications, listQuery],
  );

  function beginEditNotice(n: SchoolNotice) {
    setEditNoticeId(n.id);
    setNTitle(n.title);
    setNBody(n.body);
    setNAudience(n.audience);
    setNPinned(n.pinned);
  }

  function resetNoticeForm() {
    setEditNoticeId(null);
    setNTitle("");
    setNBody("");
    setNAudience("all");
    setNPinned(false);
  }

  function saveNotice(publish: boolean) {
    const res = upsertNotice({
      id: editNoticeId || undefined,
      title: nTitle,
      body: nBody,
      audience: nAudience,
      pinned: nPinned,
      createdBy: actor,
      publish,
      academicYearCode: session.academicYearCode,
    });
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setComms(res.state);
    resetNoticeForm();
    flash(publish ? "Notice published" : "Notice saved");
    if (publish) crossPostNotice(res.notice);
  }

  function scheduleNotice() {
    if (!nScheduleAt) {
      setError("Pick a publish date & time");
      return;
    }
    const res = upsertNotice({
      id: editNoticeId || undefined,
      title: nTitle,
      body: nBody,
      audience: nAudience,
      pinned: nPinned,
      createdBy: actor,
      schedule: true,
      scheduledPublishAt: nScheduleAt,
      academicYearCode: session.academicYearCode,
    });
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setComms(res.state);
    resetNoticeForm();
    setNScheduleAt("");
    flash(`Scheduled for ${new Date(res.notice.scheduledPublishAt).toLocaleString()}`);
  }

  function beginEditNews(n: SchoolNewsItem) {
    setEditNewsId(n.id);
    setWTitle(n.title);
    setWSummary(n.summary);
    setWBody(n.body);
    setWCover(n.coverUrl);
  }

  function resetNewsForm() {
    setEditNewsId(null);
    setWTitle("");
    setWSummary("");
    setWBody("");
    setWCover("");
  }

  function saveNews(publish: boolean) {
    const res = upsertNews({
      id: editNewsId || undefined,
      title: wTitle,
      summary: wSummary,
      body: wBody,
      coverUrl: wCover,
      createdBy: actor,
      publish,
      academicYearCode: session.academicYearCode,
    });
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setComms(res.state);
    resetNewsForm();
    flash(publish ? "News published" : "News saved");
    if (publish) crossPostNewsItem(res.item);
  }

  function scheduleNews() {
    if (!wScheduleAt) {
      setError("Pick a publish date & time");
      return;
    }
    const res = upsertNews({
      id: editNewsId || undefined,
      title: wTitle,
      summary: wSummary,
      body: wBody,
      coverUrl: wCover,
      createdBy: actor,
      schedule: true,
      scheduledPublishAt: wScheduleAt,
      academicYearCode: session.academicYearCode,
    });
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setComms(res.state);
    resetNewsForm();
    setWScheduleAt("");
    flash(`Scheduled for ${new Date(res.item.scheduledPublishAt).toLocaleString()}`);
  }

  function createAlbum(publish: boolean) {
    const wasEdit = !!editAlbumId;
    const res = upsertAlbum({
      id: editAlbumId || undefined,
      title: aTitle,
      description: aDesc,
      createdBy: actor,
      publish,
      academicYearCode: session.academicYearCode,
    });
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setComms(res.state);
    setActiveAlbumId(res.album.id);
    setEditAlbumId(null);
    setATitle("");
    setADesc("");
    flash(
      publish
        ? "Album published"
        : wasEdit
          ? "Album updated"
          : "Album created",
    );
    if (publish) crossPostAlbum(res.album, res.state);
  }

  function beginEditAlbum(a: GalleryAlbum) {
    setEditAlbumId(a.id);
    setATitle(a.title);
    setADesc(a.description);
    setActiveAlbumId(a.id);
  }

  function resetAlbumForm() {
    setEditAlbumId(null);
    setATitle("");
    setADesc("");
    setAScheduleAt("");
  }

  function scheduleAlbum() {
    if (!aScheduleAt) {
      setError("Pick a publish date & time");
      return;
    }
    const res = upsertAlbum({
      id: editAlbumId || undefined,
      title: aTitle,
      description: aDesc,
      createdBy: actor,
      schedule: true,
      scheduledPublishAt: aScheduleAt,
      academicYearCode: session.academicYearCode,
    });
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setComms(res.state);
    setActiveAlbumId(res.album.id);
    resetAlbumForm();
    flash(`Album scheduled for ${new Date(res.album.scheduledPublishAt).toLocaleString()}`);
  }

  async function onPhotoFiles(files: FileList | null) {
    if (!files?.length || !activeAlbumId) return;
    setUploading(true);
    setError(null);
    try {
      let state = loadSchoolComms();
      for (const file of Array.from(files)) {
        const path = `gallery/${activeAlbumId}/${Date.now()}_${file.name.replace(/\s+/g, "_")}`;
        const up = await uploadSchoolObject({
          path,
          blob: file,
          contentType: file.type,
        });
        if (!up.ok) {
          setError(up.error || "Upload failed");
          break;
        }
        const res = addGalleryPhoto({
          albumId: activeAlbumId,
          url: up.url,
          caption: file.name,
          uploadedBy: actor,
        });
        if (!res.ok) {
          setError(res.error);
          break;
        }
        state = res.state;
      }
      setComms(state);
      flash("Photo(s) added");
    } finally {
      setUploading(false);
    }
  }

  return (
    <ErpWorkspaceShell
      title="Notices · News · Gallery"
      subtitle="Publish circulars and campus updates to staff and the parent portal. Publishing can also cross-post to Facebook, Instagram, and Telegram."
      icon={<Megaphone className="size-6" aria-hidden />}
      error={error}
      notice={noticeMsg}
    >
      <ModuleTabs items={TABS} value={tab} onChange={(id) => setTab(id as CommsTab)} />

      {tab === "dashboard" ? (
        <div className="mt-6">
          <ModuleDashboardHost moduleId="comms" onNavigateTab={(t) => setTab(t as CommsTab)} />
        </div>
      ) : null}

      {tab === "notices" ||
      tab === "news" ||
      tab === "gallery" ||
      tab === "inbox" ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            className={`${field} max-w-md`}
            placeholder="Search title, body, status…"
            value={listQuery}
            onChange={(e) => setListQuery(e.target.value)}
          />
          {listQuery ? (
            <button
              type="button"
              className={btnOutline}
              onClick={() => setListQuery("")}
            >
              Clear
            </button>
          ) : null}
        </div>
      ) : null}

      {tab === "notices" ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <section className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
            <h2 className="text-sm font-semibold text-[var(--brand-deep)]">
              {editNoticeId ? "Edit notice" : "New notice"}
            </h2>
            <input
              className={field}
              placeholder="Title"
              value={nTitle}
              onChange={(e) => setNTitle(e.target.value)}
            />
            <textarea
              className={`${field} min-h-[120px]`}
              placeholder="Body"
              value={nBody}
              onChange={(e) => setNBody(e.target.value)}
            />
            <div className="flex flex-wrap gap-3">
              <label className="text-xs text-[var(--muted)]">
                Audience
                <select
                  className={`${field} mt-1`}
                  value={nAudience}
                  onChange={(e) =>
                    setNAudience(e.target.value as CommsAudience)
                  }
                >
                  <option value="all">Everyone</option>
                  <option value="staff">Staff</option>
                  <option value="parents">Parents</option>
                  <option value="students">Students</option>
                </select>
              </label>
              <label className="mt-5 flex items-center gap-2 text-sm text-[var(--brand-deep)]">
                <input
                  type="checkbox"
                  checked={nPinned}
                  onChange={(e) => setNPinned(e.target.checked)}
                />
                Pin
              </label>
            </div>
            <SocialCrossPostPrefsPanel compact />
            <label className="block text-xs text-[var(--muted)]">
              Publish at (schedule)
              <input
                type="datetime-local"
                className={`${field} mt-1`}
                value={nScheduleAt}
                onChange={(e) => setNScheduleAt(e.target.value)}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={btnOutline} onClick={() => saveNotice(false)}>
                Save draft
              </button>
              <button type="button" className={btnOutline} onClick={scheduleNotice}>
                Schedule
              </button>
              <button type="button" className={btn} onClick={() => saveNotice(true)}>
                Publish now
              </button>
              {editNoticeId ? (
                <button type="button" className={btnOutline} onClick={resetNoticeForm}>
                  Cancel
                </button>
              ) : null}
            </div>
          </section>
          <section className="space-y-2">
            {!readOnly ? (
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-[11px] text-[var(--muted)]">
                <span>
                  AI knowledge base — {kbStats ? `${kbStats.chunkCount} notice(s) indexed` : "…"}
                  {kbStats && !kbStats.embeddingsConfigured
                    ? " (OPENAI_API_KEY not configured)"
                    : ""}
                  {" — grounds the parent WhatsApp bot & AI assistant on published notices."}
                </span>
                <button
                  type="button"
                  disabled={kbSyncBusy || (kbStats ? !kbStats.embeddingsConfigured : false)}
                  className="rounded-lg border border-[var(--border)] px-2 py-1 font-semibold text-[var(--brand-deep)] disabled:opacity-50"
                  onClick={() => void syncKb()}
                >
                  {kbSyncBusy ? "Syncing…" : "Sync published notices to AI"}
                </button>
                {kbSyncMsg ? <span>{kbSyncMsg}</span> : null}
              </div>
            ) : null}
            {noticesFiltered.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">
                {listQuery ? "No notices match your search." : "No notices yet."}
              </p>
            ) : (
              <ErpTableShell>
                <ul className="divide-y divide-[var(--border)]">
                {noticesFiltered.map((n) => (
                  <li key={n.id} className="p-3">
                <article>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-semibold text-[var(--brand-deep)]">
                        {n.pinned ? "📌 " : ""}
                        {n.title}
                      </h3>
                      <p className="mt-0.5 text-[11px] text-[var(--muted)]">
                        {audienceLabel(n.audience)} · {n.status}
                        {n.publishedAt
                          ? ` · ${new Date(n.publishedAt).toLocaleString()}`
                          : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <DeskListActions
                        readOnly={readOnly}
                        onEdit={() => beginEditNotice(n)}
                        onDelete={() => {
                          const r = deleteNotice(n.id);
                          if (r.ok) {
                            setComms(r.state);
                            if (editNoticeId === n.id) resetNoticeForm();
                            flash("Notice deleted");
                          } else setError(r.error);
                        }}
                        deleteConfirm={`Delete notice "${n.title}"?`}
                      />
                      {!readOnly && n.status !== "published" ? (
                        <button
                          type="button"
                          className="text-[11px] font-semibold text-[#0f766e]"
                          onClick={() => {
                            const r = setNoticeStatus(n.id, "published");
                            if (r.ok) {
                              setComms(r.state);
                              flash("Published");
                              const notice = r.state.notices.find((x) => x.id === n.id);
                              if (notice) crossPostNotice(notice);
                            } else setError(r.error);
                          }}
                        >
                          Publish
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="text-[11px] font-semibold text-[var(--muted)]"
                          onClick={() => {
                            const r = setNoticeStatus(n.id, "archived");
                            if (r.ok) {
                              setComms(r.state);
                              flash("Archived");
                            } else setError(r.error);
                          }}
                        >
                          Archive
                        </button>
                      )}
                      {n.status === "published" &&
                      (n.audience === "all" || n.audience === "parents") ? (
                        <button
                          type="button"
                          className="text-[11px] font-semibold text-[#7c3aed]"
                          disabled={socialBusy}
                          onClick={() => crossPostNotice(n, true)}
                        >
                          Post to social
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--brand-deep)]">
                    {n.body}
                  </p>
                </article>
                  </li>
                ))}
                </ul>
              </ErpTableShell>
            )}
          </section>
        </div>
      ) : null}

      {tab === "news" ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <section className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
            <h2 className="text-sm font-semibold text-[var(--brand-deep)]">
              {editNewsId ? "Edit news" : "New story"}
            </h2>
            <input
              className={field}
              placeholder="Headline"
              value={wTitle}
              onChange={(e) => setWTitle(e.target.value)}
            />
            <input
              className={field}
              placeholder="Short summary"
              value={wSummary}
              onChange={(e) => setWSummary(e.target.value)}
            />
            <textarea
              className={`${field} min-h-[120px]`}
              placeholder="Full story"
              value={wBody}
              onChange={(e) => setWBody(e.target.value)}
            />
            <input
              className={field}
              placeholder="Cover image URL (optional)"
              value={wCover}
              onChange={(e) => setWCover(e.target.value)}
            />
            <SocialCrossPostPrefsPanel compact />
            <label className="block text-xs text-[var(--muted)]">
              Publish at (schedule)
              <input
                type="datetime-local"
                className={`${field} mt-1`}
                value={wScheduleAt}
                onChange={(e) => setWScheduleAt(e.target.value)}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={btnOutline} onClick={() => saveNews(false)}>
                Save draft
              </button>
              <button type="button" className={btnOutline} onClick={scheduleNews}>
                Schedule
              </button>
              <button type="button" className={btn} onClick={() => saveNews(true)}>
                Publish now
              </button>
              {editNewsId ? (
                <button type="button" className={btnOutline} onClick={resetNewsForm}>
                  Cancel
                </button>
              ) : null}
            </div>
          </section>
          <section className="space-y-2">
            {newsFiltered.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">
                {listQuery ? "No news matches your search." : "No news yet."}
              </p>
            ) : (
              <ErpTableShell>
                <ul className="divide-y divide-[var(--border)]">
                {newsFiltered.map((n) => (
                  <li key={n.id}>
                <article
                  className="overflow-hidden"
                >
                {n.coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={n.coverUrl}
                    alt=""
                    className="h-36 w-full object-cover"
                  />
                ) : null}
                <div className="p-3">
                  <div className="flex justify-between gap-2">
                    <h3 className="text-sm font-semibold text-[var(--brand-deep)]">
                      {n.title}
                    </h3>
                    <div className="flex gap-2">
                      <DeskListActions
                        readOnly={readOnly}
                        onEdit={() => beginEditNews(n)}
                        onDelete={() => {
                          const r = deleteNews(n.id);
                          if (r.ok) {
                            setComms(r.state);
                            if (editNewsId === n.id) resetNewsForm();
                            flash("News deleted");
                          } else setError(r.error);
                        }}
                        deleteConfirm={`Delete story "${n.title}"?`}
                      />
                      {!readOnly && n.status !== "published" ? (
                        <button
                          type="button"
                          className="text-[11px] font-semibold text-[#0f766e]"
                          onClick={() => {
                            const r = setNewsStatus(n.id, "published");
                            if (r.ok) {
                              setComms(r.state);
                              flash("Published");
                              const item = r.state.news.find((x) => x.id === n.id);
                              if (item) crossPostNewsItem(item);
                            } else setError(r.error);
                          }}
                        >
                          Publish
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="text-[11px] font-semibold text-[#7c3aed]"
                          disabled={socialBusy}
                          onClick={() => crossPostNewsItem(n, true)}
                        >
                          Post to social
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="mt-1 text-[11px] text-[var(--muted)]">{n.status}</p>
                  {n.summary ? (
                    <p className="mt-2 text-sm text-[var(--muted)]">{n.summary}</p>
                  ) : null}
                  <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--brand-deep)]">
                    {n.body}
                  </p>
                </div>
              </article>
                  </li>
                ))}
                </ul>
              </ErpTableShell>
            )}
          </section>
        </div>
      ) : null}

      {tab === "gallery" ? (
        <div className="space-y-5">
          <section className="flex flex-wrap items-end gap-3 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
            <p className="w-full text-sm font-semibold text-[var(--brand-deep)]">
              {editAlbumId ? "Edit album" : "New album"}
            </p>
            <label className="min-w-[180px] flex-1 text-xs text-[var(--muted)]">
              Album title
              <input
                className={`${field} mt-1`}
                value={aTitle}
                onChange={(e) => setATitle(e.target.value)}
                placeholder="Annual day 2026"
              />
            </label>
            <label className="min-w-[220px] flex-[2] text-xs text-[var(--muted)]">
              Description
              <input
                className={`${field} mt-1`}
                value={aDesc}
                onChange={(e) => setADesc(e.target.value)}
              />
            </label>
            <label className="min-w-[200px] text-xs text-[var(--muted)]">
              Publish at
              <input
                type="datetime-local"
                className={`${field} mt-1`}
                value={aScheduleAt}
                onChange={(e) => setAScheduleAt(e.target.value)}
              />
            </label>
            <button type="button" className={btnOutline} onClick={() => createAlbum(false)}>
              Create draft
            </button>
            <button type="button" className={btnOutline} onClick={scheduleAlbum}>
              Schedule
            </button>
            <button type="button" className={btn} onClick={() => createAlbum(true)}>
              Publish now
            </button>
            {editAlbumId ? (
              <button type="button" className={btnOutline} onClick={resetAlbumForm}>
                Cancel
              </button>
            ) : null}
          </section>
          <SocialCrossPostPrefsPanel compact />

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {albumsFiltered.length === 0 ? (
              <p className="text-sm text-[var(--muted)] sm:col-span-2 lg:col-span-3">
                {listQuery ? "No albums match your search." : "No albums yet."}
              </p>
            ) : (
            albumsFiltered.map((a: GalleryAlbum) => (
              <div
                key={a.id}
                className={`overflow-hidden rounded-xl border text-left transition ${
                  activeAlbumId === a.id
                    ? "border-[var(--brand-deep)] ring-2 ring-[var(--brand-gold)]"
                    : "border-[var(--border)]"
                } bg-[var(--card)]`}
              >
                <button
                  type="button"
                  onClick={() => setActiveAlbumId(a.id)}
                  className="w-full text-left"
                >
                  <div className="flex h-28 items-center justify-center bg-[var(--surface-sunken)]">
                    {a.coverUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={a.coverUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <Images className="h-8 w-8 text-[var(--muted)]" />
                    )}
                  </div>
                  <div className="p-3">
                    <p className="text-sm font-semibold text-[var(--brand-deep)]">{a.title}</p>
                    <p className="text-[11px] text-[var(--muted)]">{a.status}</p>
                  </div>
                </button>
                <div className="px-3 pb-3">
                  <DeskListActions
                    readOnly={readOnly}
                    onEdit={() => beginEditAlbum(a)}
                    onDelete={() => {
                      const r = deleteAlbum(a.id);
                      if (r.ok) {
                        setComms(r.state);
                        if (activeAlbumId === a.id) setActiveAlbumId(null);
                        if (editAlbumId === a.id) resetAlbumForm();
                        flash("Album deleted");
                      } else setError(r.error);
                    }}
                    deleteConfirm={`Delete album "${a.title}" and all its photos?`}
                  />
                </div>
              </div>
            ))
            )}
          </div>

          {activeAlbumId ? (
            <section className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-[var(--brand-deep)]">
                  Album photos
                </h2>
                <div className="flex flex-wrap gap-2">
                  <label className={`${btnOutline} cursor-pointer`}>
                    {uploading ? "Uploading…" : "Add photos"}
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      disabled={uploading}
                      onChange={(e) => {
                        void onPhotoFiles(e.target.files);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  {albums.find((a) => a.id === activeAlbumId)?.status !==
                  "published" ? (
                    <button
                      type="button"
                      className={btn}
                      onClick={() => {
                        const r = setAlbumStatus(activeAlbumId, "published");
                        if (r.ok) {
                          setComms(r.state);
                          flash("Album published");
                          const album = r.state.albums.find(
                            (x) => x.id === activeAlbumId,
                          );
                          if (album) crossPostAlbum(album, r.state);
                        } else setError(r.error);
                      }}
                    >
                      Publish album
                    </button>
                  ) : null}
                </div>
              </div>
              {albumPhotos.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">No photos yet.</p>
              ) : (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                  {albumPhotos.map((p) => (
                    <figure key={p.id} className="relative overflow-hidden rounded-lg bg-[var(--surface-sunken)]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.url} alt={p.caption} className="aspect-square w-full object-cover" />
                      {p.caption ? (
                        <figcaption className="truncate px-1.5 py-1 text-[10px] text-[var(--muted)]">
                          {p.caption}
                        </figcaption>
                      ) : null}
                      {!readOnly ? (
                        <button
                          type="button"
                          className="absolute right-1 top-1 rounded bg-[var(--card)]/90 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--danger)]"
                          onClick={() => {
                            if (!window.confirm("Remove this photo?")) return;
                            const r = deleteGalleryPhoto(p.id);
                            if (r.ok) {
                              setComms(r.state);
                              flash("Photo removed");
                            } else setError(r.error);
                          }}
                        >
                          Delete
                        </button>
                      ) : null}
                    </figure>
                  ))}
                </div>
              )}
            </section>
          ) : null}
        </div>
      ) : null}

      {tab === "social" ? (
        <div className="space-y-5">
          <SocialCredentialsPanel onSaved={reloadSocialLogs} />
          <SocialCrossPostPrefsPanel />
          <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
            <h2 className="text-sm font-semibold text-[var(--brand-deep)]">
              Scheduled queue
            </h2>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Scheduled items publish automatically when their time arrives.
            </p>
            {scheduledItems.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--muted)]">No scheduled posts.</p>
            ) : (
              <ErpTableShell className="mt-3">
                <ul className="divide-y divide-[var(--border)]">
                {scheduledItems.map((item) => (
                  <li
                    key={`${item.kind}-${item.id}`}
                    className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm"
                  >
                    <span className="font-medium text-[var(--brand-deep)]">
                      {item.title}
                    </span>
                    <span className="text-[11px] text-[var(--muted)]">
                      {item.kind} ·{" "}
                      {new Date(item.scheduledPublishAt).toLocaleString()}
                    </span>
                  </li>
                ))}
                </ul>
              </ErpTableShell>
            )}
          </section>
          <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-[var(--brand-deep)]">
                Recent cross-posts
              </h2>
              <button type="button" className={btnOutline} onClick={reloadSocialLogs}>
                Refresh
              </button>
            </div>
            {socialLogs.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">
                No cross-posts yet. Publish news or gallery with social enabled.
              </p>
            ) : (
              <ErpTableShell>
                <ul className="divide-y divide-[var(--border)]">
                {socialLogs.map((log) => (
                  <li
                    key={`${log.contentId}-${log.platform}-${log.postedAt}`}
                    className="px-4 py-2.5 text-sm"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium text-[var(--brand-deep)]">
                        {log.title || log.contentId}
                      </span>
                      <span className="text-[11px] text-[var(--muted)]">
                        {log.platform} · {log.status} ·{" "}
                        {new Date(log.postedAt).toLocaleString()}
                      </span>
                    </div>
                    {log.postUrl ? (
                      <a
                        href={log.postUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-block text-[11px] text-[#0f766e]"
                      >
                        View post
                      </a>
                    ) : null}
                    {log.error ? (
                      <p className="mt-1 text-[11px] text-[var(--danger)]">{log.error}</p>
                    ) : null}
                  </li>
                ))}
                </ul>
              </ErpTableShell>
            )}
          </section>
        </div>
      ) : null}

      {tab === "channels" ? <ClassChannelsPanel /> : null}

      {tab === "wa_hub" ? (
        <WaChatHubPanel by={session.fullName} canEdit={!readOnly} />
      ) : null}

      {tab === "household_log" ? <HouseholdMessageLogPanel /> : null}

      {tab === "inbox" ? (
        <section className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={btnOutline}
              onClick={() => {
                setInbox(markAllNotificationsRead(recipientKey, "staff"));
                flash("All marked read");
              }}
            >
              Mark all read
            </button>
            <button
              type="button"
              className={btnOutline}
              onClick={() => {
                setInbox(pruneNotifications());
                flash("Pruned older notifications");
              }}
            >
              Prune inbox
            </button>
          </div>
          {notificationsFiltered.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">
              {listQuery
                ? "No notifications match your search."
                : `No notifications for ${TENANT.nameDisplay} staff yet.`}
            </p>
          ) : (
            notificationsFiltered.map((n: AppNotification) => {
              const unread = !n.readBy.includes(recipientKey);
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => {
                    markNotificationRead(n.id, recipientKey);
                    setInbox(loadNotifications());
                    if (n.href) router.push(n.href);
                  }}
                  className={`block w-full rounded-xl border px-3 py-2.5 text-left ${
                    unread
                      ? "border-[rgba(197,160,40,0.4)] bg-[rgba(197,160,40,0.08)]"
                      : "border-[var(--border)] bg-[var(--card)]"
                  }`}
                >
                  <div className="flex justify-between gap-2">
                    <p className="text-sm font-semibold text-[var(--brand-deep)]">
                      {n.title}
                    </p>
                    <span className="text-[10px] text-[var(--muted)]">
                      {new Date(n.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-[var(--muted)]">{n.body}</p>
                  <p className="mt-1 text-[10px] uppercase tracking-wide text-[var(--muted)]">
                    {n.kind}
                  </p>
                </button>
              );
            })
          )}
        </section>
      ) : null}

      {tab === "reports" ? (
        <div className="mt-2">
          <CommsReportsRunner />
        </div>
      ) : null}
    </ErpWorkspaceShell>
  );
}
