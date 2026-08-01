"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Megaphone, Newspaper, Images, Bell, MessagesSquare } from "lucide-react";
import { useDemoSession } from "@/components/shell/SessionContext";
import { ModuleTabs, type ModuleTabItem } from "@/components/ui/ModuleTabs";
import { ClassChannelsPanel } from "@/components/comms/ClassChannelsPanel";
import { WaChatHubPanel } from "@/components/comms/WaChatHubPanel";
import {
  addGalleryPhoto,
  audienceLabel,
  listAlbums,
  listNews,
  listNotices,
  loadSchoolComms,
  photosForAlbum,
  seedSchoolCommsDemo,
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
import { TENANT } from "@/lib/types";

type CommsTab = "notices" | "news" | "gallery" | "inbox" | "channels" | "wa_hub";

const TABS: ModuleTabItem[] = [
  { id: "notices", label: "Notices", tone: "navy" },
  { id: "news", label: "News", tone: "teal" },
  { id: "gallery", label: "Gallery", tone: "amber" },
  { id: "channels", label: "Class WA", tone: "violet" },
  { id: "wa_hub", label: "WhatsApp hub", tone: "teal" },
  { id: "inbox", label: "Inbox", tone: "slate" },
];

const field =
  "w-full rounded-lg border border-[rgba(32,48,80,0.15)] bg-white px-2.5 py-1.5 text-sm text-[var(--brand-deep)]";
const btn =
  "rounded-lg bg-[var(--brand-deep)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50";
const btnOutline =
  "rounded-lg border border-[rgba(32,48,80,0.2)] bg-white px-3 py-1.5 text-sm text-[var(--brand-deep)]";

function tabFromSearch(raw: string | null, path: string): CommsTab {
  if (path.startsWith("/news")) return "news";
  if (path.startsWith("/gallery")) return "gallery";
  if (path.startsWith("/notices")) return "notices";
  if (
    raw === "news" ||
    raw === "gallery" ||
    raw === "inbox" ||
    raw === "notices" ||
    raw === "channels" ||
    raw === "wa_hub"
  ) {
    return raw;
  }
  return "notices";
}

export function CommsWorkspace() {
  const session = useDemoSession();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = tabFromSearch(searchParams.get("tab"), pathname || "/comms");

  const [comms, setComms] = useState<SchoolCommsState | null>(null);
  const [inbox, setInbox] = useState<NotificationsState | null>(null);
  const [noticeMsg, setNoticeMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Notice form
  const [nTitle, setNTitle] = useState("");
  const [nBody, setNBody] = useState("");
  const [nAudience, setNAudience] = useState<CommsAudience>("all");
  const [nPinned, setNPinned] = useState(false);
  const [editNoticeId, setEditNoticeId] = useState<string | null>(null);

  // News form
  const [wTitle, setWTitle] = useState("");
  const [wSummary, setWSummary] = useState("");
  const [wBody, setWBody] = useState("");
  const [wCover, setWCover] = useState("");
  const [editNewsId, setEditNewsId] = useState<string | null>(null);

  // Gallery
  const [aTitle, setATitle] = useState("");
  const [aDesc, setADesc] = useState("");
  const [activeAlbumId, setActiveAlbumId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const actor = session.fullName || "Office";
  const recipientKey = currentStaffRecipientKey();

  function flash(msg: string) {
    setNoticeMsg(msg);
    setError(null);
    window.setTimeout(() => setNoticeMsg(null), 2800);
  }

  function reload() {
    seedSchoolCommsDemo(actor);
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
    function onNf() {
      setInbox(loadNotifications());
    }
    window.addEventListener("bhb-notifications", onNf);
    return () => {
      cancelled = true;
      window.removeEventListener("bhb-notifications", onNf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount hydrate
  }, []);

  function setTab(next: CommsTab) {
    const url = new URL(window.location.href);
    url.pathname = "/comms";
    url.searchParams.set("tab", next);
    router.replace(`${url.pathname}?${url.searchParams.toString()}`);
  }

  const notices = useMemo(
    () => (comms ? listNotices(comms) : []),
    [comms],
  );
  const news = useMemo(() => (comms ? listNews(comms) : []), [comms]);
  const albums = useMemo(() => (comms ? listAlbums(comms) : []), [comms]);
  const albumPhotos = useMemo(
    () =>
      activeAlbumId && comms ? photosForAlbum(activeAlbumId, comms) : [],
    [activeAlbumId, comms],
  );
  const notifications = useMemo(
    () =>
      inbox
        ? listNotificationsFor(recipientKey, "staff", inbox)
        : [],
    [inbox, recipientKey],
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
  }

  function createAlbum(publish: boolean) {
    const res = upsertAlbum({
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
    setATitle("");
    setADesc("");
    flash(publish ? "Album published" : "Album created");
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

  const headerIcon =
    tab === "news" ? (
      <Newspaper className="h-5 w-5" />
    ) : tab === "gallery" ? (
      <Images className="h-5 w-5" />
    ) : tab === "inbox" ? (
      <Bell className="h-5 w-5" />
    ) : tab === "channels" ? (
      <MessagesSquare className="h-5 w-5" />
    ) : (
      <Megaphone className="h-5 w-5" />
    );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
            School communications
          </p>
          <h1 className="font-display mt-1 flex items-center gap-2 text-2xl font-semibold text-[var(--brand-deep)]">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[rgba(32,48,80,0.1)] text-[var(--brand-deep)]">
              {headerIcon}
            </span>
            Notices · News · Gallery
          </h1>
          <p className="mt-1 max-w-xl text-sm text-[var(--muted)]">
            Publish circulars and campus updates to staff and the parent portal.
            Publishing also pushes an in-app notification.
          </p>
        </div>
      </div>

      <ModuleTabs items={TABS} value={tab} onChange={(id) => setTab(id as CommsTab)} />

      {noticeMsg ? (
        <p className="rounded-lg bg-[rgba(22,163,74,0.12)] px-3 py-2 text-sm text-[#15803d]">
          {noticeMsg}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-lg bg-[rgba(180,35,24,0.1)] px-3 py-2 text-sm text-[#b42318]">
          {error}
        </p>
      ) : null}

      {tab === "notices" ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <section className="space-y-3 rounded-2xl border border-[rgba(32,48,80,0.1)] bg-white p-4">
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
            <div className="flex flex-wrap gap-2">
              <button type="button" className={btnOutline} onClick={() => saveNotice(false)}>
                Save draft
              </button>
              <button type="button" className={btn} onClick={() => saveNotice(true)}>
                Publish
              </button>
              {editNoticeId ? (
                <button type="button" className={btnOutline} onClick={resetNoticeForm}>
                  Cancel
                </button>
              ) : null}
            </div>
          </section>
          <section className="space-y-2">
            {notices.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">No notices yet.</p>
            ) : (
              notices.map((n) => (
                <article
                  key={n.id}
                  className="rounded-xl border border-[rgba(32,48,80,0.1)] bg-white p-3"
                >
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
                      <button
                        type="button"
                        className="text-[11px] font-semibold text-[var(--brand-deep)]"
                        onClick={() => beginEditNotice(n)}
                      >
                        Edit
                      </button>
                      {n.status !== "published" ? (
                        <button
                          type="button"
                          className="text-[11px] font-semibold text-[#0f766e]"
                          onClick={() => {
                            const r = setNoticeStatus(n.id, "published");
                            if (r.ok) {
                              setComms(r.state);
                              flash("Published");
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
                    </div>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--brand-deep)]">
                    {n.body}
                  </p>
                </article>
              ))
            )}
          </section>
        </div>
      ) : null}

      {tab === "news" ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <section className="space-y-3 rounded-2xl border border-[rgba(32,48,80,0.1)] bg-white p-4">
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
            <div className="flex flex-wrap gap-2">
              <button type="button" className={btnOutline} onClick={() => saveNews(false)}>
                Save draft
              </button>
              <button type="button" className={btn} onClick={() => saveNews(true)}>
                Publish
              </button>
              {editNewsId ? (
                <button type="button" className={btnOutline} onClick={resetNewsForm}>
                  Cancel
                </button>
              ) : null}
            </div>
          </section>
          <section className="space-y-2">
            {news.map((n) => (
              <article
                key={n.id}
                className="overflow-hidden rounded-xl border border-[rgba(32,48,80,0.1)] bg-white"
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
                      <button
                        type="button"
                        className="text-[11px] font-semibold"
                        onClick={() => beginEditNews(n)}
                      >
                        Edit
                      </button>
                      {n.status !== "published" ? (
                        <button
                          type="button"
                          className="text-[11px] font-semibold text-[#0f766e]"
                          onClick={() => {
                            const r = setNewsStatus(n.id, "published");
                            if (r.ok) {
                              setComms(r.state);
                              flash("Published");
                            } else setError(r.error);
                          }}
                        >
                          Publish
                        </button>
                      ) : null}
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
            ))}
          </section>
        </div>
      ) : null}

      {tab === "gallery" ? (
        <div className="space-y-5">
          <section className="flex flex-wrap items-end gap-3 rounded-2xl border border-[rgba(32,48,80,0.1)] bg-white p-4">
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
            <button type="button" className={btnOutline} onClick={() => createAlbum(false)}>
              Create draft
            </button>
            <button type="button" className={btn} onClick={() => createAlbum(true)}>
              Create & publish
            </button>
          </section>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {albums.map((a: GalleryAlbum) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setActiveAlbumId(a.id)}
                className={`overflow-hidden rounded-xl border text-left transition ${
                  activeAlbumId === a.id
                    ? "border-[var(--brand-deep)] ring-2 ring-[var(--brand-gold)]"
                    : "border-[rgba(32,48,80,0.1)]"
                } bg-white`}
              >
                <div className="flex h-28 items-center justify-center bg-[rgba(32,48,80,0.06)]">
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
            ))}
          </div>

          {activeAlbumId ? (
            <section className="space-y-3 rounded-2xl border border-[rgba(32,48,80,0.1)] bg-white p-4">
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
                    <figure key={p.id} className="overflow-hidden rounded-lg bg-[rgba(32,48,80,0.05)]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.url} alt={p.caption} className="aspect-square w-full object-cover" />
                      {p.caption ? (
                        <figcaption className="truncate px-1.5 py-1 text-[10px] text-[var(--muted)]">
                          {p.caption}
                        </figcaption>
                      ) : null}
                    </figure>
                  ))}
                </div>
              )}
            </section>
          ) : null}
        </div>
      ) : null}

      {tab === "channels" ? <ClassChannelsPanel /> : null}

      {tab === "wa_hub" ? (
        <WaChatHubPanel by={session.fullName} canEdit />
      ) : null}

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
          {notifications.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">
              No notifications for {TENANT.nameDisplay} staff yet.
            </p>
          ) : (
            notifications.map((n: AppNotification) => {
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
                      : "border-[rgba(32,48,80,0.1)] bg-white"
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
    </div>
  );
}
