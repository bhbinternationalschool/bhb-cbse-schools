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

/**
 * The site ships English only; the structure for Hindi is in place so that
 * adding it later is content entry rather than a migration.
 *
 * A translation is a separate page row sharing its twin's slug — (en,'about')
 * at /about and (hi,'about') at /hi/about — so the two are linked by the
 * address they already share and cannot drift apart.
 */
export type SiteLang = "en" | "hi";

export const LANGUAGES: { id: SiteLang; label: string; pathPrefix: string }[] = [
  { id: "en", label: "English", pathPrefix: "" },
  { id: "hi", label: "हिन्दी", pathPrefix: "hi" },
];

export type SitePage = {
  id: string;
  slug: string;
  lang: SiteLang;
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
  /** Branded for the same reason as the page revision. See `SitePage`. */
  updatedAt: Revision;
  deletedAt: string | null;
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
  /** The name the file arrived with. Storage keys are generated, so this is
   * the only record of it — and the only thing the alt-text guard can
   * compare against. */
  originalFilename: string;
  uploadedBy: string;
  createdAt: string;
  /** Branded for the same reason as the page revision. See `SitePage`. */
  updatedAt: Revision;
  deletedAt: string | null;
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
  opts: {
    existingSlugs?: readonly string[];
    selfId?: string;
    /** Compared against pages in the SAME language; /hi/about and /about
     * are different addresses and may share a slug. */
    lang?: SiteLang;
    /** Permit the empty slug, which addresses the front page itself.
     * Off by default so a page cannot become the home page by accident. */
    allowHome?: boolean;
  } = {},
): string | null {
  const s = normalizeSlug(slug);
  if (!s) {
    // The empty slug IS the front page. The unique index on (tenant, lang,
    // slug) already guarantees there can only be one of them per language.
    if (opts.allowHome) {
      return opts.existingSlugs?.some((other) => normalizeSlug(other) === "")
        ? "There is already a front page in this language."
        : null;
    }
    return "Give the page an address, for example about-us.";
  }
  if (s.length > 120) return "That address is too long — keep it under 120 characters.";

  const [head] = s.split("/");
  // Only root-level pages can be shadowed by a real app route. A Hindi page
  // sits behind /hi, where nothing of ours answers, so `fees` is free there.
  const canBeShadowed = (opts.lang ?? "en") === "en";
  if (canBeShadowed && (RESERVED_SLUGS.includes(s) || RESERVED_SLUGS.includes(head))) {
    return `“${head}” is already used by another part of the site, so a page there would never be reached. Choose a different address.`;
  }
  if (opts.existingSlugs?.some((other) => normalizeSlug(other) === s)) {
    return "Another page already uses that address.";
  }
  return null;
}

/**
 * The URL a published page is reachable at.
 *
 * English sits at the root and Hindi under /hi, so the English address never
 * changes when a translation is added — a link printed on a prospectus or
 * given to Cashfree stays valid.
 */
export function publicPathFor(slug: string, lang: SiteLang = "en"): string {
  const s = normalizeSlug(slug);
  const prefix = LANGUAGES.find((l) => l.id === lang)?.pathPrefix ?? "";
  if (!prefix) return s ? `/${s}` : "/";
  return s ? `/${prefix}/${s}` : `/${prefix}`;
}

/** The front page's slug. Empty is not a missing value here; it is the address. */
export const HOME_SLUG = "";

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
    lang: (str(row.lang, "en") === "hi" ? "hi" : "en") as SiteLang,
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
  if (page.lang !== undefined) row.lang = page.lang;
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

/* ─── Media ───────────────────────────────────────────────────────────── */

export const CONSENT_STATUSES: {
  id: ConsentStatus;
  label: string;
  blurb: string;
}[] = [
  {
    id: "not_required",
    label: "No one in it",
    blurb: "A building, a crest, a certificate — nobody identifiable",
  },
  {
    id: "granted",
    label: "Covered by admission terms",
    blurb: "The normal case for a photograph of pupils",
  },
  {
    id: "withdrawn",
    label: "Family has objected",
    blurb: "Never shown publicly, anywhere it appears",
  },
  {
    id: "pending",
    label: "Not yet decided",
    blurb: "Held back until someone chooses",
  },
];

export function consentLabel(status: ConsentStatus): string {
  return CONSENT_STATUSES.find((c) => c.id === status)?.label ?? status;
}

/**
 * Alt text is what a blind visitor hears and what a search engine reads, so
 * an image without it is refused a place on a page — not merely flagged.
 *
 * The filename is rejected too. "IMG_2049.JPG" as alt text is worse than
 * nothing: it passes an automated check while telling a screen-reader user
 * precisely nothing.
 */
export function altProblem(alt: string, filename = ""): string | null {
  const a = alt.trim();
  if (!a) return "Describe the picture, so a blind visitor knows what is in it.";
  if (a.length < 4) return "That is too short to describe the picture.";
  if (a.length > 300) return "Keep the description under 300 characters.";

  // Compare loosely. Someone retyping the file name rarely reproduces its
  // punctuation — "prize day", "prize-day" and "prize_day" are the same
  // non-description, and an exact match would catch none of them.
  const loosen = (v: string) =>
    v
      .replace(/\.[^.]+$/, "")
      .toLowerCase()
      .replace(/[\s_+-]+/g, " ")
      .trim();

  const bare = loosen(filename);
  if (bare && loosen(a) === bare) {
    return "That is the file name, not a description. Say what is in the picture.";
  }
  if (/^(img|dsc|dscn|pxl|screenshot|photo|image)[\s_-]*\d*$/i.test(a)) {
    return "That is a camera file name, not a description.";
  }
  return null;
}

/** Everything that must be true before an image may be placed on a page. */
export function mediaReadyForPage(
  media: Pick<SiteMedia, "consentStatus" | "alt" | "mime">,
): { ready: boolean; reason: string | null } {
  if (!mayPublishMedia(media)) {
    return {
      ready: false,
      reason:
        media.consentStatus === "withdrawn"
          ? "The family has objected to this picture being shown."
          : "Consent for this picture has not been settled.",
    };
  }
  if (media.mime.startsWith("image/") && altProblem(media.alt)) {
    return { ready: false, reason: "It still needs a description." };
  }
  return { ready: true, reason: null };
}

export function describeBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * A fingerprint of the file the office chose, used to catch the same
 * photograph being uploaded twice.
 *
 * Deliberately hashes the ORIGINAL bytes rather than what we store. The
 * upload path re-encodes large images through a canvas, and two browsers do
 * not produce byte-identical output from one photograph — so hashing the
 * stored copy would let the same picture in twice from two machines, which
 * is exactly the case this is meant to catch.
 */
export async function sha256Hex(file: Blob): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function rowToMedia(row: Row): SiteMedia {
  const consent = str(row.consent_status, "not_required");
  return {
    id: str(row.id),
    bucket: str(row.bucket, "site-media"),
    storagePath: str(row.storage_path),
    url: str(row.url),
    mime: str(row.mime),
    bytes: num(row.bytes),
    width: num(row.width),
    height: num(row.height),
    alt: str(row.alt),
    caption: str(row.caption),
    credit: str(row.credit),
    consentStatus: (CONSENT_STATUSES.some((c) => c.id === consent)
      ? consent
      : "not_required") as ConsentStatus,
    consentHouseholdId: str(row.consent_household_id),
    consentNote: str(row.consent_note),
    contentHash: str(row.content_hash),
    originalFilename: str(row.original_filename),
    uploadedBy: str(row.uploaded_by),
    createdAt: str(row.created_at),
    updatedAt: asRevision(str(row.updated_at)),
    deletedAt: nullableStr(row.deleted_at),
  };
}

/** The columns a media write sends. Absent keys keep their stored value. */
export function mediaToRow(media: Partial<SiteMedia>): Row {
  const row: Row = {};
  if (media.bucket !== undefined) row.bucket = media.bucket;
  if (media.storagePath !== undefined) row.storage_path = media.storagePath;
  if (media.url !== undefined) row.url = media.url;
  if (media.mime !== undefined) row.mime = media.mime;
  if (media.bytes !== undefined) row.bytes = media.bytes;
  if (media.width !== undefined) row.width = media.width;
  if (media.height !== undefined) row.height = media.height;
  if (media.alt !== undefined) row.alt = media.alt;
  if (media.caption !== undefined) row.caption = media.caption;
  if (media.credit !== undefined) row.credit = media.credit;
  if (media.consentStatus !== undefined) row.consent_status = media.consentStatus;
  if (media.consentHouseholdId !== undefined)
    row.consent_household_id = media.consentHouseholdId;
  if (media.consentNote !== undefined) row.consent_note = media.consentNote;
  if (media.contentHash !== undefined) row.content_hash = media.contentHash;
  if (media.originalFilename !== undefined)
    row.original_filename = media.originalFilename;
  if (media.uploadedBy !== undefined) row.uploaded_by = media.uploadedBy;
  // updated_at is the server's to stamp. See `pageToRow`.
  return row;
}

/* ─── Block content ───────────────────────────────────────────────────────
 *
 * Every block that stores its own content is described here once, and both
 * the editor and the renderer read that description. A new field is added in
 * one place, not three, and the two can never disagree about what a block
 * holds.
 *
 * Blocks marked `live` in BLOCK_KINDS are absent on purpose: they read from
 * another desk rather than storing a copy, and wiring them is Phase 4.
 */

export type FieldType = "line" | "text" | "media" | "url" | "youtube";

export type BlockField = {
  key: string;
  label: string;
  type: FieldType;
  help?: string;
  optional?: boolean;
  placeholder?: string;
};

/** A block kind whose content is a repeating list of small records. */
export type BlockList = {
  key: string;
  /** Singular, for the "Add another ___" button. */
  noun: string;
  fields: BlockField[];
  min: number;
  max: number;
};

export type BlockShape = {
  fields: BlockField[];
  list?: BlockList;
};

export const BLOCK_SHAPES: Partial<Record<BlockKind, BlockShape>> = {
  prose: {
    fields: [
      { key: "heading", label: "Heading", type: "line", optional: true },
      {
        key: "body",
        label: "Text",
        type: "text",
        help: "A blank line starts a new paragraph. A line beginning with - becomes a bullet.",
        placeholder:
          "The school was founded in 1998...\n\n- Nursery to Class VIII\n- State recognised",
      },
    ],
  },
  image: {
    fields: [
      { key: "mediaId", label: "Picture", type: "media" },
      { key: "caption", label: "Caption", type: "line", optional: true },
    ],
  },
  video: {
    fields: [
      {
        key: "youtube",
        label: "YouTube link",
        type: "youtube",
        help: "Paste the address from the browser. Videos are embedded, never uploaded — a 50 MB clip watched 500 times would cost 25 GB of traffic and would stutter on a village connection.",
        placeholder: "https://www.youtube.com/watch?v=...",
      },
      { key: "title", label: "Title", type: "line", optional: true },
    ],
  },
  cards: {
    fields: [{ key: "heading", label: "Heading", type: "line", optional: true }],
    list: {
      key: "items",
      noun: "card",
      min: 1,
      max: 8,
      fields: [
        { key: "title", label: "Title", type: "line" },
        { key: "body", label: "Text", type: "text", optional: true },
        { key: "href", label: "Links to", type: "url", optional: true },
      ],
    },
  },
  stats: {
    fields: [{ key: "heading", label: "Heading", type: "line", optional: true }],
    list: {
      key: "items",
      noun: "figure",
      min: 1,
      max: 6,
      fields: [
        { key: "value", label: "Figure", type: "line", placeholder: "480" },
        { key: "label", label: "What it counts", type: "line", placeholder: "Pupils" },
      ],
    },
  },
  faq: {
    fields: [{ key: "heading", label: "Heading", type: "line", optional: true }],
    list: {
      key: "items",
      noun: "question",
      min: 1,
      max: 30,
      fields: [
        { key: "q", label: "Question", type: "line" },
        { key: "a", label: "Answer", type: "text" },
      ],
    },
  },
};

/** Kinds this phase can actually put on a page. */
export function isBuildableKind(kind: BlockKind): boolean {
  return BLOCK_SHAPES[kind] !== undefined;
}

/**
 * The video id from anything the office is likely to paste.
 *
 * Returns null rather than guessing. A wrong id renders a grey box with no
 * error, which is the kind of failure nobody reports and nobody notices.
 */
export function youtubeId(input: string): string | null {
  const v = input.trim();
  if (!v) return null;
  // A bare id, already extracted.
  if (/^[\w-]{11}$/.test(v)) return v;
  let url: URL;
  try {
    url = new URL(v.startsWith("http") ? v : `https://${v}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, "");
  if (host === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0];
    return /^[\w-]{11}$/.test(id) ? id : null;
  }
  if (host !== "youtube.com" && host !== "m.youtube.com") return null;
  const q = url.searchParams.get("v");
  if (q && /^[\w-]{11}$/.test(q)) return q;
  // /embed/ID and /shorts/ID
  const m = url.pathname.match(/^\/(embed|shorts|v)\/([\w-]{11})/);
  return m ? m[2] : null;
}

/** What is still missing before this block can be shown to the public. */
export function blockProblem(block: Pick<SiteBlock, "kind" | "payload">): string | null {
  const shape = BLOCK_SHAPES[block.kind];
  if (!shape) return "This kind of block is not ready yet.";
  const p = block.payload;

  for (const f of shape.fields) {
    const raw = typeof p[f.key] === "string" ? (p[f.key] as string).trim() : "";
    if (!raw) {
      if (f.optional) continue;
      return `${f.label} is empty.`;
    }
    if (f.type === "youtube" && !youtubeId(raw)) {
      return "That is not a YouTube address I recognise.";
    }
  }

  if (shape.list) {
    const items = Array.isArray(p[shape.list.key])
      ? (p[shape.list.key] as Record<string, unknown>[])
      : [];
    if (items.length < shape.list.min) {
      return `Add at least one ${shape.list.noun}.`;
    }
    for (const [i, item] of items.entries()) {
      for (const f of shape.list.fields) {
        if (f.optional) continue;
        const raw = typeof item[f.key] === "string" ? (item[f.key] as string).trim() : "";
        if (!raw) return `${shape.list.noun} ${i + 1}: ${f.label} is empty.`;
      }
    }
  }
  return null;
}

/** A fresh payload with every field present, so the editor has no undefineds. */
export function emptyPayload(kind: BlockKind): Record<string, unknown> {
  const shape = BLOCK_SHAPES[kind];
  if (!shape) return {};
  const out: Record<string, unknown> = {};
  for (const f of shape.fields) out[f.key] = "";
  if (shape.list) {
    const row: Record<string, unknown> = {};
    for (const f of shape.list.fields) row[f.key] = "";
    out[shape.list.key] = [row];
  }
  return out;
}

/**
 * Plain text to paragraphs and bullet runs.
 *
 * The store is deliberately not HTML — the office cannot paste in broken
 * markup or a tracking pixel, and every page inherits the site's typography
 * whatever was typed.
 */
export type ProseNode =
  | { type: "p"; text: string }
  | { type: "ul"; items: string[] };

export function parseProse(body: string): ProseNode[] {
  const out: ProseNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length) {
      out.push({ type: "ul", items: bullets });
      bullets = [];
    }
  };
  for (const rawLine of body.replace(/\r\n/g, "\n").split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      flush();
      continue;
    }
    const bullet = line.match(/^[-•*]\s+(.*)$/);
    if (bullet) {
      bullets.push(bullet[1].trim());
      continue;
    }
    flush();
    out.push({ type: "p", text: line });
  }
  flush();
  return out;
}

export function rowToBlock(row: Row): SiteBlock {
  const kind = str(row.kind, "prose");
  return {
    id: str(row.id),
    pageId: str(row.page_id),
    ord: num(row.ord),
    kind: (BLOCK_KINDS.some((k) => k.id === kind) ? kind : "prose") as BlockKind,
    payload:
      row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
        ? (row.payload as Record<string, unknown>)
        : {},
    createdAt: str(row.created_at),
    updatedAt: asRevision(str(row.updated_at)),
    deletedAt: nullableStr(row.deleted_at),
  };
}

export function blockToRow(block: Partial<SiteBlock>): Row {
  const row: Row = {};
  if (block.pageId !== undefined) row.page_id = block.pageId;
  if (block.ord !== undefined) row.ord = block.ord;
  if (block.kind !== undefined) row.kind = block.kind;
  if (block.payload !== undefined) row.payload = block.payload;
  // updated_at is the server's to stamp. See `pageToRow`.
  return row;
}
