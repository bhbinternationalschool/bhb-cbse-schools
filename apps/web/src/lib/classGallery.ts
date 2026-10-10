/**
 * Class gallery (director, 10 Oct 2026).
 *
 * A class teacher takes photos and videos in the staff app, or picks them
 * from the phone's gallery, under an event ("Sports day", "Diwali"). Each
 * event is an album of that class; the files go to the private
 * `class-gallery` bucket and a copy to the school's Drive under
 * Class gallery / <year> / <class> / <event>. Only the families of that class
 * see it in the parent app; staff see every class.
 *
 * Nothing reaches parents unchecked: each item is 'pending' until an AI
 * check makes it 'ok', or 'held' for the principal, who approves or removes
 * it. An AI that cannot answer never passes an item — after a few tries it
 * is held for a person.
 *
 * Pure rules: who may see an album, which files are accepted, where they go.
 */

import type { GalleryAlbum } from "@/lib/schoolComms";

export const CLASS_GALLERY_BUCKET = "class-gallery";

const MB = 1024 * 1024;

/** Five minutes of phone video (director, 10 Oct 2026). */
export const VIDEO_MAX_MINUTES = 5;
export const VIDEO_MAX_BYTES = 500 * MB;

/** What the bucket accepts (kept in step with migration 20261010230000_class_gallery_bucket). */
export const CLASS_GALLERY_TYPES: Record<string, { ext: string; kind: "photo" | "video"; maxBytes: number }> = {
  "image/jpeg": { ext: "jpg", kind: "photo", maxBytes: 15 * MB },
  "image/png": { ext: "png", kind: "photo", maxBytes: 15 * MB },
  "image/webp": { ext: "webp", kind: "photo", maxBytes: 15 * MB },
  "image/heic": { ext: "heic", kind: "photo", maxBytes: 15 * MB },
  "video/mp4": { ext: "mp4", kind: "video", maxBytes: VIDEO_MAX_BYTES },
  "video/quicktime": { ext: "mov", kind: "video", maxBytes: VIDEO_MAX_BYTES },
  "video/webm": { ext: "webm", kind: "video", maxBytes: VIDEO_MAX_BYTES },
  "video/3gpp": { ext: "3gp", kind: "video", maxBytes: VIDEO_MAX_BYTES },
};

/** The content type for a picked file, from its declared type or its name. */
export function classGalleryType(contentType: string, fileName: string): string {
  const ct = String(contentType || "").toLowerCase().trim();
  if (CLASS_GALLERY_TYPES[ct]) return ct;
  const ext = String(fileName || "").toLowerCase().split(".").pop() || "";
  const byExt: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    heic: "image/heic",
    mp4: "video/mp4",
    mov: "video/quicktime",
    webm: "video/webm",
    "3gp": "video/3gpp",
  };
  return byExt[ext] ?? "";
}

/** "Too big" / "not a photo or video" for a picked file ("" = fine). */
export function classGalleryFileProblem(contentType: string, bytes: number): string {
  const t = CLASS_GALLERY_TYPES[contentType];
  if (!t) return "Only photos (JPG, PNG, WebP, HEIC) and videos (MP4, MOV, WebM, 3GP) can be added.";
  if (!(bytes > 0)) return "The file is empty.";
  if (bytes > t.maxBytes) {
    return t.kind === "video"
      ? `This video is ${Math.round(bytes / MB)} MB — the limit is 500 MB (about 5 minutes). Trim it or record a shorter clip.`
      : `This photo is ${Math.round(bytes / MB)} MB — the limit is 15 MB.`;
  }
  return "";
}

export const sectionKey = (classId: string, sectionId: string) => `${classId}|${sectionId}`;

/**
 * May this viewer see this album? A school-wide album (no sections): yes.
 * A class album: staff yes; a parent only if one of their children on roll
 * is in one of its sections.
 */
export function albumVisibleTo(
  album: Pick<GalleryAlbum, "sectionIds">,
  viewer: { staff: true } | { staff: false; sections: ReadonlySet<string> },
): boolean {
  const secs = album.sectionIds ?? [];
  if (!secs.length) return true;
  if (viewer.staff) return true;
  return secs.some((s) => viewer.sections.has(s));
}

/** An event name as a title and a folder name: trimmed, no slashes, not empty. */
export function cleanEventName(raw: string): string {
  return String(raw ?? "")
    .replace(/[\\/]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

/** Where a file goes in the bucket: <class|section>/<album>/<photo>.<ext>, safe characters only. */
export function classGalleryPath(section: string, albumId: string, photoId: string, ext: string): string {
  const safe = (s: string) => String(s).replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${safe(section)}/${safe(albumId)}/${safe(photoId)}.${safe(ext)}`;
}

/** Drive: Class gallery / 2026-27 / Class III-A / Sports day. */
export function classGalleryDriveFolder(academicYear: string, classLabel: string, eventName: string): string[] {
  return ["Class gallery", academicYear || "No year", classLabel || "Class", cleanEventName(eventName) || "Event"];
}

/** The ERP route a class-gallery item is served from (it checks the viewer). */
export const classMediaUrl = (photoId: string) => `/api/v1/gallery/media/${encodeURIComponent(photoId)}`;

export type ReviewStatus = "pending" | "ok" | "held" | "removed";

export function reviewStatusOf(v: unknown): ReviewStatus {
  return v === "pending" || v === "held" || v === "removed" ? v : "ok";
}

/** Tries before an item the AI could not check is held for a person. */
export const REVIEW_MAX_ATTEMPTS = 3;

/** May a parent see this item? Only once it has passed. */
export const parentMaySee = (p: { reviewStatus?: ReviewStatus }) => (p.reviewStatus ?? "ok") === "ok";

export const MODERATION_SYSTEM = [
  "You check photos and videos a class teacher took at an Indian school before they are shown to the parents of that class in the school app.",
  "Most are ordinary school moments — classroom work, assemblies, sports, festivals, prize giving, trips, group photos — and those are fine.",
  "Hold an item if it shows ANY of: a child undressed or partly dressed (changing clothes, bathing, toilet), nudity or sexual content;",
  "an injury, blood or a child being hurt; fighting, bullying, physical punishment or a child being scolded or humiliated;",
  "a child visibly crying or distressed as the subject; weapons, alcohol, tobacco or drugs; rude gestures or offensive words;",
  "a readable personal document or record (Aadhaar, report card, mark sheet, fee receipt, register, phone numbers, addresses);",
  "a screenshot, meme or anything that is not a school moment; or anything else a careful principal would not send to all parents.",
  "When unsure, hold. Do not hold an item only because it shows children's faces, uniforms or the school.",
].join(" ");

export const MODERATION_PROMPT =
  'Reply as JSON: {"verdict":"ok"|"hold","reason":"<under 15 words, for the principal; empty if ok>"}';

/** The model's reply as a verdict; anything unreadable is not a pass. */
export function parseModerationVerdict(text: string): { verdict: "ok" | "hold"; reason: string } | null {
  let raw: unknown;
  try {
    raw = JSON.parse(String(text ?? "").trim());
  } catch {
    return null;
  }
  const r = (raw ?? {}) as { verdict?: unknown; reason?: unknown };
  const reason = String(r.reason ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
  if (r.verdict === "ok") return { verdict: "ok", reason: "" };
  if (r.verdict === "hold") return { verdict: "hold", reason: reason || "Flagged by the AI check" };
  return null;
}

/** Days an item stays in the bucket; after that it is served from Drive (director, 10 Oct 2026). */
export const CLASS_GALLERY_KEEP_DAYS = 30;

/** Is this item's bucket copy due to go? Only a passed item, only once its Drive copy is confirmed. */
export function bucketCopyDue(
  item: { reviewStatus?: ReviewStatus; uploadedAt: string; storageEvicted?: boolean },
  driveCopied: boolean,
  nowMs: number,
): boolean {
  if (!driveCopied || item.storageEvicted || (item.reviewStatus ?? "ok") !== "ok") return false;
  const t = Date.parse(item.uploadedAt);
  return Number.isFinite(t) && nowMs - t >= CLASS_GALLERY_KEEP_DAYS * 86_400_000;
}
