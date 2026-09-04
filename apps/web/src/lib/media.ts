/**
 * What may be uploaded, where it lands, and what a stored reference to it
 * looks like. Shared by the browser and by `/api/upload`, so a file the
 * picker accepts is never one the server then rejects.
 *
 * Two buckets, two different questions:
 *
 *   site-media    public   the crest, the favicon, website photographs and
 *                          video. Anyone may fetch these; that is the point,
 *                          and it is why they can be cached for a year.
 *   school-files  private  student photos, staff signatures, payroll
 *                          challans. Reached only through `/api/file`, which
 *                          checks a staff session first.
 *
 * The rule that matters most is at the bottom: a stored value must be a URL,
 * never the image itself. See `sanitizeStoredMediaUrl`.
 */

export type MediaBucket = "site-media" | "school-files";
export type MediaVisibility = "public" | "private";

const MB = 1024 * 1024;

type BucketRules = {
  visibility: MediaVisibility;
  /** extension -> the content type we will store it as. */
  types: Record<string, string>;
  /** Cap for stills and documents. */
  maxBytes: number;
  /** Cap for video, which is legitimately larger. 0 = video not allowed. */
  maxVideoBytes: number;
};

const IMAGE_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
};

/**
 * Kept in step with the bucket rows themselves (migration
 * 20260830100000_site_media_bucket). Storage enforces its own allowlist, so a
 * type added here and not there fails at upload with a confusing message.
 */
export const MEDIA_BUCKETS: Record<MediaBucket, BucketRules> = {
  "site-media": {
    visibility: "public",
    types: {
      ...IMAGE_TYPES,
      mp4: "video/mp4",
      webm: "video/webm",
      pdf: "application/pdf",
    },
    maxBytes: 15 * MB,
    maxVideoBytes: 50 * MB,
  },
  "school-files": {
    visibility: "private",
    types: {
      ...IMAGE_TYPES,
      pdf: "application/pdf",
    },
    maxBytes: 10 * MB,
    maxVideoBytes: 0,
  },
};

export function bucketFor(visibility: MediaVisibility): MediaBucket {
  return visibility === "public" ? "site-media" : "school-files";
}

/**
 * Strip anything that could climb out of the tenant's folder or confuse a
 * storage key. Deliberately strict — a rejected character becomes `_`, it
 * does not become a path separator.
 */
export function sanitizeMediaPath(path: string): string {
  // Order matters: strip `..` before collapsing slashes, and collapse before
  // trimming the leading one — otherwise `../../etc/passwd` leaves via the
  // slash that removing `..` puts back at the front.
  return path
    .replace(/\.\./g, "")
    .replace(/[^a-zA-Z0-9._\-/]/g, "_")
    .replace(/\/{2,}/g, "/")
    .replace(/^\/+/, "");
}

export function extensionOf(path: string): string {
  const name = path.split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

/** The content type we will store this file as, or null if it is not allowed. */
export function contentTypeFor(
  bucket: MediaBucket,
  path: string,
): string | null {
  return MEDIA_BUCKETS[bucket].types[extensionOf(path)] ?? null;
}

export function maxBytesFor(bucket: MediaBucket, contentType: string): number {
  const rules = MEDIA_BUCKETS[bucket];
  return contentType.startsWith("video/") ? rules.maxVideoBytes : rules.maxBytes;
}

export function describeLimit(bytes: number): string {
  return `${Math.round(bytes / MB)} MB`;
}

/** Every extension the picker should offer for this bucket, as an accept list. */
export function acceptFor(bucket: MediaBucket, kind?: "image"): string {
  const types = new Set(
    Object.entries(MEDIA_BUCKETS[bucket].types)
      .filter(([, ct]) => (kind === "image" ? ct.startsWith("image/") : true))
      .map(([, ct]) => ct),
  );
  return [...types].join(",");
}

/**
 * Where a public file is served from. Built from the Supabase URL rather than
 * asking the client for it, so a server route and a browser agree on the
 * string that goes into the database.
 */
export function publicMediaUrl(supabaseUrl: string, path: string): string {
  const base = supabaseUrl.replace(/\/+$/, "");
  return `${base}/storage/v1/object/public/site-media/${sanitizeMediaPath(path)}`;
}

/**
 * Where a private file is served from — our own route, not Supabase.
 *
 * A Supabase signed URL expires (ours lasted seven days), so storing one on a
 * staff record means the photo works for a week and then silently 400s. This
 * path never expires; the access check happens per request instead.
 */
export function privateMediaUrl(path: string): string {
  return `/api/file/${sanitizeMediaPath(path)}`;
}

/**
 * Keep the image out of the row that points at it.
 *
 * A `data:` URL is not a reference to a picture, it *is* the picture —
 * roughly 200 KB of base64 for one compressed photo, carried by every read
 * and every write of whatever record holds it. On 2026-08-10 that kind of
 * payload filled the director's browser storage and cost him his admissions
 * saves; as of today a 45 kB favicon is sitting in the masters row for the
 * same reason.
 *
 * The check lives at the boundary rather than in each caller, because the way
 * this goes wrong is a caller that never thought about it. Returns "" for
 * anything that is the file itself, so an absent image is absent rather than
 * corrupt.
 */
export function sanitizeStoredMediaUrl(
  value: string | null | undefined,
  context = "media",
): string {
  const url = (value ?? "").trim();
  if (!url) return "";
  if (/^data:/i.test(url)) {
    console.warn(
      `[${context}] refusing to store a data: URL ` +
        `(${Math.round(url.length / 1024)} KB). Upload the file and store its URL.`,
    );
    return "";
  }
  if (/^blob:/i.test(url)) {
    console.warn(
      `[${context}] refusing to store a blob: URL — it is only valid inside ` +
        `the tab that made it.`,
    );
    return "";
  }
  return url;
}

/** True when this value is a reference we can persist. */
export function isStoredMediaUrl(value: string | null | undefined): boolean {
  return sanitizeStoredMediaUrl(value, "check") !== "";
}
