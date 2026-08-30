/**
 * The website module — pages, blocks, media, menu, and the publish bridge.
 *
 * Everything here is server truth (tables `site_*`, migration
 * 20260830200000), reached through the generic data API. There is no
 * localStorage mirror and no whole-state push: a website that a stale tab can
 * blank is not a website, and that is exactly how the Transport desk was
 * emptied on 2026-08-21.
 *
 * This file holds the shapes and the pure rules. Anything that talks to the
 * network lives in the desk components.
 */

import { asRevision, type Revision } from "@/lib/data/types";

/* ─── Records ─────────────────────────────────────────────────────────── */

export type PageStatus = "draft" | "scheduled" | "published" | "archived";
export type NavGroup = "" | "header" | "footer";

export type SitePage = {
  id: string;
  slug: string;
  title: string;
  navGroup: NavGroup;
  navOrder: number;
  status: PageStatus;
  scheduledPublishAt: string | null;
  publishedAt: string | null;
  seoTitle: string;
  seoDescription: string;
  ogMediaId: string;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  /**
   * The revision to send back when saving this page.
   *
   * Branded, so it cannot be confused with "the time I clicked save" — that
   * substitution once made masters unsavable, 16 refusals to 2 acceptances in
   * an evening. `rowToPage` is the server boundary for this module and the
   * only place it is minted.
   */
  updatedAt: Revision;
  deletedAt: string | null;
};

export type BlockKind =
  | "prose"
  | "image"
  | "gallery"
  | "video"
  | "cards"
  | "stats"
  | "people"
  | "downloads"
  | "feed"
  | "calendar"
  | "faq"
  | "enquiry";

export type SiteBlock = {
  id: string;
  pageId: string;
  ord: number;
  kind: BlockKind;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type ConsentStatus = "not_required" | "pending" | "granted" | "withdrawn";

export type SiteMedia = {
  id: string;
  bucket: string;
  storagePath: string;
  url: string;
  mime: string;
  bytes: number;
  width: number;
  height: number;
  alt: string;
  caption: string;
  credit: string;
  consentStatus: ConsentStatus;
  consentHouseholdId: string;
  consentNote: string;
  contentHash: string;
  uploadedBy: string;
  createdAt: string;
  updatedAt: string;
};

/* ─── The block palette ───────────────────────────────────────────────── */

export const BLOCK_KINDS: {
  id: BlockKind;
  label: string;
  blurb: string;
  /** True when the block reads live from the ERP instead of storing a copy. */
  live: boolean;
}[] = [
  { id: "prose", label: "Text", blurb: "Headed paragraphs and lists", live: false },
  { id: "image", label: "Image", blurb: "One picture with a caption", live: false },
  { id: "gallery", label: "Gallery", blurb: "Points at an existing album", live: true },
  { id: "video", label: "Video", blurb: "An embed, or a short uploaded clip", live: false },
  { id: "cards", label: "Cards", blurb: "Three or four linked tiles", live: false },
  { id: "stats", label: "Numbers", blurb: "Figures with labels", live: false },
  { id: "people", label: "People", blurb: "Faculty, from the Staff desk", live: true },
  { id: "downloads", label: "Downloads", blurb: "PDFs from the Vault", live: true },
  { id: "feed", label: "Latest news", blurb: "Recent notices or news", live: true },
  { id: "calendar", label: "Calendar", blurb: "Upcoming events", live: true },
  { id: "faq", label: "Questions", blurb: "Question and answer pairs", live: false },
  { id: "enquiry", label: "Enquiry form", blurb: "Admission enquiry form", live: true },
];

export function blockLabel(kind: BlockKind): string {
  return BLOCK_KINDS.find((b) => b.id === kind)?.label ?? kind;
}

/* ─── Slugs ───────────────────────────────────────────────────────────── */

/**
 * Every URL the app already answers on, at the top level.
 *
 * The public site will resolve unknown paths through a catch-all route, and a
 * catch-all loses to a real one. So a page saved as `fees` or `login` would
 * be reachable by nothing, appear to have published, and quietly show the ERP
 * instead. Refusing the slug up front is the only version of this the office
 * can act on.
 *
 * Generated from apps/web/src/app on 2026-08-30 — both the public routes and
 * the ERP desks, which occupy the same namespace. Add to it when a route is
 * added, or that route becomes un-shadowable.
 */
export const RESERVED_SLUGS: readonly string[] = [
  "about", "accounts", "admissions", "alumni", "api", "apply", "attendance",
  "budget", "canteen", "cbse-loc", "certificates", "comms", "complaints",
  "contact", "discipline", "documents", "download", "events", "exams",
  "fee-structure", "fees", "fest", "field", "gallery", "health", "home",
  "homework", "hostel", "id-cards", "inventory", "library", "login", "masters",
  "modules", "mpd", "news", "notices", "parent", "pay", "payroll", "privacy",
  "ptm", "purchase", "pwa", "question-bank", "receipt", "refund",
  "refund-policy", "register", "registration", "reports", "rte", "scholarships",
  "sports", "staff", "store", "student-leave", "students", "teaching", "terms",
  "timetable", "transport", "trust", "vault", "visit", "visitors",
  // Reserved for the site itself.
  "sitemap.xml", "robots.txt", "website",
];

/**
 * Tidy what someone typed into something that can be a URL.
 *
 * Lowercase, spaces to hyphens, nothing but letters, digits, hyphen and the
 * slash that separates a section from its page. Leading and trailing slashes
 * are dropped so `/about/` and `about` are the same page rather than two.
 */
export function normalizeSlug(input: string): string {
  return (input ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/\/{2,}/g, "/")
    .replace(/^[-/]+|[-/]+$/g, "")
    .replace(/-?\/-?/g, "/");
}

/**
 * Why this slug cannot be used, or null if it can.
 *
 * Returns a sentence for the office to read, not a code — the person hitting
 * this is choosing a page address, and "reserved" alone tells them nothing
 * about what to do next.
 */
export function slugProblem(
  slug: string,
  opts: { existingSlugs?: readonly string[]; selfId?: string } = {},
): string | null {
  const s = normalizeSlug(slug);
  if (!s) return "Give the page an address, for example about-us.";
  if (s.length > 120) return "That address is too long — keep it under 120 characters.";

  const [head] = s.split("/");
  if (RESERVED_SLUGS.includes(s) || RESERVED_SLUGS.includes(head)) {
    return `“${head}” is already used by another part of the site, so a page there would never be reached. Choose a different address.`;
  }
  if (opts.existingSlugs?.some((other) => normalizeSlug(other) === s)) {
    return "Another page already uses that address.";
  }
  return null;
}

/** The URL a published page is reachable at. */
export function publicPathFor(slug: string): string {
  const s = normalizeSlug(slug);
  return s ? `/${s}` : "/";
}

/* ─── Status ──────────────────────────────────────────────────────────── */

export const PAGE_STATUSES: { id: PageStatus; label: string; blurb: string }[] = [
  { id: "draft", label: "Draft", blurb: "Only staff can see it" },
  { id: "scheduled", label: "Scheduled", blurb: "Goes live at a set time" },
  { id: "published", label: "Live", blurb: "Anyone can read it" },
  { id: "archived", label: "Archived", blurb: "Taken down, kept on file" },
];

export function pageStatusLabel(status: PageStatus): string {
  return PAGE_STATUSES.find((s) => s.id === status)?.label ?? status;
}

/**
 * Is this page visible to the public right now?
 *
 * Status alone is not the answer. A page marked published with a future
 * `publishedAt`, or one that is scheduled and whose time has come, both need
 * the clock — and a deleted page is never live whatever its status says.
 */
export function isPageLive(
  page: Pick<SitePage, "status" | "publishedAt" | "scheduledPublishAt" | "deletedAt">,
  now: Date = new Date(),
): boolean {
  if (page.deletedAt) return false;
  const at = (v: string | null) => (v ? new Date(v).getTime() : null);

  if (page.status === "published") {
    const from = at(page.publishedAt);
    // No timestamp means it was published without one; treat it as live
    // rather than inventing a date it went up.
    return from === null || from <= now.getTime();
  }
  if (page.status === "scheduled") {
    const from = at(page.scheduledPublishAt);
    return from !== null && from <= now.getTime();
  }
  return false;
}

/**
 * May this image be rendered on a public page?
 *
 * A photograph of an identifiable child is that child's personal data, so the
 * default is no. `not_required` is for a building, a certificate, a crest —
 * pictures with no one in them. Anything else has to be granted, and a
 * withdrawn consent takes the photo down everywhere it appears.
 */
export function mayPublishMedia(
  media: Pick<SiteMedia, "consentStatus">,
): boolean {
  return (
    media.consentStatus === "not_required" || media.consentStatus === "granted"
  );
}

/* ─── Row mapping ─────────────────────────────────────────────────────── */

type Row = Record<string, unknown>;

const str = (v: unknown, fallback = "") =>
  typeof v === "string" ? v : fallback;
const num = (v: unknown, fallback = 0) =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;
const nullableStr = (v: unknown) => (typeof v === "string" && v ? v : null);

export function rowToPage(row: Row): SitePage {
  const status = str(row.status, "draft");
  const navGroup = str(row.nav_group, "");
  return {
    id: str(row.id),
    slug: str(row.slug),
    title: str(row.title),
    navGroup: (navGroup === "header" || navGroup === "footer" ? navGroup : "") as NavGroup,
    navOrder: num(row.nav_order),
    status: (PAGE_STATUSES.some((s) => s.id === status)
      ? status
      : "draft") as PageStatus,
    scheduledPublishAt: nullableStr(row.scheduled_publish_at),
    publishedAt: nullableStr(row.published_at),
    seoTitle: str(row.seo_title),
    seoDescription: str(row.seo_description),
    ogMediaId: str(row.og_media_id),
    createdBy: str(row.created_by),
    updatedBy: str(row.updated_by),
    createdAt: str(row.created_at),
    updatedAt: asRevision(str(row.updated_at)),
    deletedAt: nullableStr(row.deleted_at),
  };
}

/** The columns a page write sends. Absent keys keep their stored value. */
export function pageToRow(page: Partial<SitePage>): Row {
  const row: Row = {};
  if (page.slug !== undefined) row.slug = normalizeSlug(page.slug);
  if (page.title !== undefined) row.title = page.title;
  if (page.navGroup !== undefined) row.nav_group = page.navGroup;
  if (page.navOrder !== undefined) row.nav_order = page.navOrder;
  if (page.status !== undefined) row.status = page.status;
  if (page.scheduledPublishAt !== undefined)
    row.scheduled_publish_at = page.scheduledPublishAt;
  if (page.publishedAt !== undefined) row.published_at = page.publishedAt;
  if (page.seoTitle !== undefined) row.seo_title = page.seoTitle;
  if (page.seoDescription !== undefined) row.seo_description = page.seoDescription;
  if (page.ogMediaId !== undefined) row.og_media_id = page.ogMediaId;
  if (page.createdBy !== undefined) row.created_by = page.createdBy;
  if (page.updatedBy !== undefined) row.updated_by = page.updatedBy;
  // updated_at is deliberately absent: the server stamps it, and a client
  // that could set its own revision could overwrite someone else's edit.
  return row;
}

/** Ids are generated here so a new page can be written in one op. */
export function newSiteId(prefix: string): string {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${stamp}${rand}`;
}
