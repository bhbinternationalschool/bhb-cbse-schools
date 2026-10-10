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
 * Pure rules: who may see an album, which files are accepted, where they go.
 */

import type { GalleryAlbum } from "@/lib/schoolComms";

export const CLASS_GALLERY_BUCKET = "class-gallery";

const MB = 1024 * 1024;

/** What the bucket accepts (kept in step with migration 20261010210000_class_gallery_bucket). */
export const CLASS_GALLERY_TYPES: Record<string, { ext: string; kind: "photo" | "video"; maxBytes: number }> = {
  "image/jpeg": { ext: "jpg", kind: "photo", maxBytes: 15 * MB },
  "image/png": { ext: "png", kind: "photo", maxBytes: 15 * MB },
  "image/webp": { ext: "webp", kind: "photo", maxBytes: 15 * MB },
  "image/heic": { ext: "heic", kind: "photo", maxBytes: 15 * MB },
  "video/mp4": { ext: "mp4", kind: "video", maxBytes: 100 * MB },
  "video/quicktime": { ext: "mov", kind: "video", maxBytes: 100 * MB },
  "video/webm": { ext: "webm", kind: "video", maxBytes: 100 * MB },
  "video/3gpp": { ext: "3gp", kind: "video", maxBytes: 100 * MB },
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
      ? `This video is ${Math.round(bytes / MB)} MB — the limit is 100 MB (about 1–2 minutes). Trim it or record a shorter clip.`
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
