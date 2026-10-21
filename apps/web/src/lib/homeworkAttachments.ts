/**
 * Homework attachments — where the file lives, what a post may point at, and
 * how a parent is handed one. Shared by the web composer, the staff app's
 * upload route, the post route, the feed and the serve route, so a file one
 * of them accepts is never one another refuses.
 *
 * Storage: the private `school-files` bucket (lib/media.ts), under
 * `homework/<classId>/<sectionId>/`, referenced on the post as
 * `/api/file/<path>` — the same reference shape every other private upload
 * uses. The folder carries the section, so the post route can check that a
 * reference belongs to the section being posted to: a teacher cannot attach
 * another section's worksheet, or any other private file (a payslip, a
 * signature) by pasting its path.
 *
 * Reading: `/api/file` is staff-only, and a parent must see the worksheet. So
 * parents (and the app) never get the stored reference; they get
 * `/api/v1/homework/attachment?postId=&attId=`, which checks that the reader
 * has a child in the post's section (or teaches it) and streams the file.
 * Older web posts stored the file inline as a `data:` URL; the same route
 * serves those, so every attachment reaches a parent the same way.
 */

import { MEDIA_BUCKETS, extensionOf, privateMediaUrl } from "@/lib/media";

/** One post carries at most this many files (a multi-page scan included). */
export const HOMEWORK_MAX_ATTACHMENTS = 10;

/** Per file — the private bucket's own cap, so storage never disagrees. */
export const HOMEWORK_ATTACHMENT_MAX_BYTES = MEDIA_BUCKETS["school-files"].maxBytes;

/** What a homework attachment may be: a photo/scan of a page, or a PDF. */
export const HOMEWORK_ATTACHMENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  pdf: "application/pdf",
};

const EXT_FOR_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

/** The extension a file of this content type is stored under, or null if not allowed. */
export function homeworkAttachmentExt(contentType: string, fileName = ""): string | null {
  const byType = EXT_FOR_TYPE[(contentType || "").toLowerCase().split(";")[0]!.trim()];
  if (byType) return byType;
  const ext = extensionOf(fileName);
  return HOMEWORK_ATTACHMENT_TYPES[ext] ? (ext === "jpeg" ? "jpg" : ext) : null;
}

function safeSegment(id: string): string {
  return (id || "").replace(/[^A-Za-z0-9_-]/g, "_");
}

/** The section's folder in `school-files`. */
export function homeworkAttachmentFolder(classId: string, sectionId: string): string {
  return `homework/${safeSegment(classId)}/${safeSegment(sectionId)}`;
}

/** A fresh storage key per upload (files are cached for a year). */
export function homeworkAttachmentPath(
  classId: string,
  sectionId: string,
  ext: string,
  now = new Date(),
  rand = Math.random().toString(36).slice(2, 10),
): string {
  const stamp = now.toISOString().slice(0, 10);
  return `${homeworkAttachmentFolder(classId, sectionId)}/${stamp}-${rand}.${ext}`;
}

export type HomeworkAttachmentRef = { id: string; label: string; url: string };

/**
 * The attachments a post may carry when it is created through the API, or an
 * error. Each must be a file uploaded into THIS section's homework folder —
 * nothing else, not even another private file of the school's.
 */
export function validateHomeworkAttachmentRefs(
  raw: unknown,
  classId: string,
  sectionId: string,
): { ok: true; attachments: HomeworkAttachmentRef[] } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, attachments: [] };
  if (!Array.isArray(raw)) return { ok: false, error: "attachments must be a list" };
  if (raw.length > HOMEWORK_MAX_ATTACHMENTS) {
    return { ok: false, error: `At most ${HOMEWORK_MAX_ATTACHMENTS} files on one homework` };
  }
  const prefix = `${privateMediaUrl(homeworkAttachmentFolder(classId, sectionId))}/`;
  const out: HomeworkAttachmentRef[] = [];
  const seen = new Set<string>();
  for (const [i, item] of raw.entries()) {
    const a = (item ?? {}) as Partial<HomeworkAttachmentRef>;
    const url = typeof a.url === "string" ? a.url.trim() : "";
    const name = url.slice(prefix.length);
    if (
      !url.startsWith(prefix) ||
      !/^[A-Za-z0-9._-]+$/.test(name) ||
      name.includes("..") ||
      !HOMEWORK_ATTACHMENT_TYPES[extensionOf(name)]
    ) {
      return { ok: false, error: `File ${i + 1} was not uploaded for this class — attach it again` };
    }
    if (seen.has(url)) continue;
    seen.add(url);
    const label = (typeof a.label === "string" ? a.label : "").trim().slice(0, 80) || `Attachment ${out.length + 1}`;
    const id = typeof a.id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(a.id) ? a.id : `att_${name.replace(/\.[^.]+$/, "")}`;
    out.push({ id, label, url });
  }
  return { ok: true, attachments: out };
}

export type HomeworkAttachmentKind = "image" | "pdf" | "link";

/** What a stored attachment actually is, and where its bytes come from. */
export type HomeworkAttachmentSource =
  | { kind: "storage"; path: string; contentType: string }
  | { kind: "inline"; contentType: string; base64: string }
  | { kind: "link"; url: string }
  | { kind: "none" };

/**
 * Resolve a stored attachment URL. Storage files are served only from the
 * homework folder, so a post can never be used to read another private file.
 */
export function homeworkAttachmentSource(url: string): HomeworkAttachmentSource {
  const u = (url || "").trim();
  if (u.startsWith("/api/file/homework/")) {
    const path = u.slice("/api/file/".length);
    if (path.includes("..")) return { kind: "none" };
    const contentType = HOMEWORK_ATTACHMENT_TYPES[extensionOf(path)];
    return contentType ? { kind: "storage", path, contentType } : { kind: "none" };
  }
  const m = /^data:([a-z0-9.+/-]+);base64,([\s\S]*)$/i.exec(u);
  if (m) {
    const contentType = m[1]!.toLowerCase();
    if (!EXT_FOR_TYPE[contentType]) return { kind: "none" };
    return { kind: "inline", contentType, base64: m[2]! };
  }
  if (/^https?:\/\//i.test(u)) return { kind: "link", url: u };
  return { kind: "none" };
}

export function homeworkAttachmentKind(url: string): HomeworkAttachmentKind | null {
  const src = homeworkAttachmentSource(url);
  if (src.kind === "link") return "link";
  if (src.kind === "none") return null;
  return src.contentType === "application/pdf" ? "pdf" : "image";
}

/** The URL a reader (parent or staff) opens — never the stored reference. */
export function homeworkAttachmentReadUrl(postId: string, attId: string): string {
  return `/api/v1/homework/attachment?postId=${encodeURIComponent(postId)}&attId=${encodeURIComponent(attId)}`;
}

/**
 * A post's attachments as the feed, the parent portal and the app show them.
 * The same for an app upload and an older inline web one; a pasted web link
 * opens as itself; anything unreadable is left out rather than shown broken.
 */
export function homeworkAttachmentsForReaders(post: {
  id: string;
  attachments: { id: string; label: string; url: string }[];
}): { id: string; label: string; kind: HomeworkAttachmentKind; url: string }[] {
  const out: { id: string; label: string; kind: HomeworkAttachmentKind; url: string }[] = [];
  for (const a of post.attachments || []) {
    const kind = homeworkAttachmentKind(a.url);
    if (!kind) continue;
    out.push({
      id: a.id,
      label: a.label || "Attachment",
      kind,
      url: kind === "link" ? a.url.trim() : homeworkAttachmentReadUrl(post.id, a.id),
    });
  }
  return out;
}
