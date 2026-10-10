/**
 * Server side of the class gallery (lib/classGallery).
 */

import { randomBytes } from "node:crypto";
import type { ApiAuthContext } from "@/lib/api/v1/auth";
import { ApiError } from "@/lib/api/v1/errors";
import { staffSectionScope } from "@/lib/api/v1/staffScope";
import { childrenOnRoll } from "@/lib/appPopups";
import type { MastersState } from "@/lib/masters";
import type { GalleryAlbum } from "@/lib/schoolComms";
import { albumToRow, photoToRow, rowToAlbum, rowToPhoto, touchCommsMeta } from "@/lib/schoolCommsNormalized.server";
import { getServerTenantContext } from "@/lib/serverTenant";
import type { SisStudent } from "@/lib/sis";
import {
  CLASS_GALLERY_BUCKET,
  CLASS_GALLERY_TYPES,
  classGalleryFileProblem,
  classGalleryPath,
  classGalleryType,
  classMediaUrl,
  cleanEventName,
  reviewStatusOf,
  sectionKey,
  type ReviewStatus,
} from "@/lib/classGallery";

const id = (prefix: string) => `${prefix}_${randomBytes(6).toString("base64url")}`;

export function classLabelFor(masters: MastersState, section: string): string {
  const [classId, sectionId] = section.split("|");
  const c = masters.classes.find((x) => x.id === classId);
  const s = masters.sections.find((x) => x.id === sectionId);
  return `Class ${[c?.name || classId, s?.name || ""].filter(Boolean).join("-")}`;
}

/** The sections this staff member may post to: their class(es) as class teacher; leadership any. */
export async function postableSections(ctx: ApiAuthContext): Promise<{ unrestricted: boolean; sections: string[] }> {
  const scope = await staffSectionScope(ctx);
  return { unrestricted: scope.unrestricted, sections: [...scope.classTeacherOf] };
}

export async function assertMaySection(ctx: ApiAuthContext, section: string): Promise<void> {
  const p = await postableSections(ctx);
  if (!p.unrestricted && !p.sections.includes(section)) {
    throw new ApiError("forbidden", "Only the class teacher of this class can add to its gallery.", 403);
  }
}

async function db() {
  const ctx = await getServerTenantContext();
  if (!ctx) throw new ApiError("server_error", "Database unavailable — try again", 503);
  return ctx;
}

/** A class's events (albums), newest first, with how many items each holds. */
export async function listClassEvents(section: string) {
  const { sb, tenantId } = await db();
  const { data, error } = await sb
    .from("school_comms_desk_albums")
    .select("*")
    .eq("tenant_id", tenantId)
    .contains("section_ids", [section])
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new ApiError("server_error", "Could not read the class gallery — try again", 503);
  const albums = (data ?? []).map((r) => rowToAlbum(r as Record<string, unknown>));
  type Count = { photos: number; videos: number; checking: number; held: number; cover: string };
  const counts = new Map<string, Count>();
  if (albums.length) {
    const { data: ph, error: pe } = await sb
      .from("school_comms_desk_photos")
      .select("id, album_id, media_kind, review_status")
      .eq("tenant_id", tenantId)
      .in("album_id", albums.map((a) => a.id))
      .neq("review_status", "removed")
      .limit(5000);
    if (pe) throw new ApiError("server_error", "Could not read the class gallery — try again", 503);
    for (const p of ph ?? []) {
      const c = counts.get(String(p.album_id)) ?? { photos: 0, videos: 0, checking: 0, held: 0, cover: "" };
      const status = reviewStatusOf(p.review_status);
      if (status === "pending") c.checking += 1;
      else if (status === "held") c.held += 1;
      else if (p.media_kind === "video") c.videos += 1;
      else {
        c.photos += 1;
        if (!c.cover) c.cover = classMediaUrl(String(p.id));
      }
      counts.set(String(p.album_id), c);
    }
  }
  return albums.map((a) => ({
    id: a.id,
    title: a.title,
    createdAt: a.createdAt,
    createdBy: a.createdBy,
    photos: counts.get(a.id)?.photos ?? 0,
    videos: counts.get(a.id)?.videos ?? 0,
    checking: counts.get(a.id)?.checking ?? 0,
    held: counts.get(a.id)?.held ?? 0,
    coverUrl: counts.get(a.id)?.cover ?? "",
  }));
}

/** An event of this class with this name, made if it does not exist yet. */
export async function ensureClassEvent(opts: {
  section: string;
  name: string;
  classLabel: string;
  academicYear: string;
  by: string;
}): Promise<GalleryAlbum> {
  const title = cleanEventName(opts.name);
  if (!title) throw new ApiError("bad_request", "Give the event a name (e.g. Sports day).", 400);
  const { sb, tenantId } = await db();
  const existing = (await listClassEvents(opts.section)).find((e) => e.title.toLowerCase() === title.toLowerCase());
  const now = new Date().toISOString();
  if (existing) {
    const { data } = await sb.from("school_comms_desk_albums").select("*").eq("tenant_id", tenantId).eq("id", existing.id).maybeSingle();
    if (data) return rowToAlbum(data as Record<string, unknown>);
  }
  const album: GalleryAlbum = {
    id: id("alb"),
    title,
    description: opts.classLabel,
    coverUrl: "",
    status: "published",
    academicYearCode: opts.academicYear,
    publishedAt: now,
    scheduledPublishAt: "",
    createdAt: now,
    createdBy: opts.by,
    updatedAt: now,
    sectionIds: [opts.section],
    classLabel: opts.classLabel,
  };
  const { error } = await sb.from("school_comms_desk_albums").insert(albumToRow(tenantId, album));
  if (error) throw new ApiError("server_error", "Could not create the event — try again", 503);
  await touchCommsMeta(sb, tenantId, now).catch(() => undefined);
  return album;
}

async function albumOf(albumId: string): Promise<GalleryAlbum> {
  const { sb, tenantId } = await db();
  const { data, error } = await sb.from("school_comms_desk_albums").select("*").eq("tenant_id", tenantId).eq("id", albumId).maybeSingle();
  if (error) throw new ApiError("server_error", "Could not read the event — try again", 503);
  if (!data) throw new ApiError("not_found", "Event not found", 404);
  const album = rowToAlbum(data as Record<string, unknown>);
  if (!album.sectionIds?.length) throw new ApiError("bad_request", "This is not a class gallery event", 400);
  return album;
}

/**
 * A signed upload URL for one file: the phone sends it straight to storage
 * (a video does not fit through the server). Nothing is recorded until
 * finishClassUpload confirms the file arrived.
 */
export async function startClassUpload(ctx: ApiAuthContext, opts: { albumId: string; fileName: string; contentType: string; bytes: number }) {
  const album = await albumOf(opts.albumId);
  await assertMaySection(ctx, album.sectionIds![0]!);
  const type = classGalleryType(opts.contentType, opts.fileName);
  const problem = classGalleryFileProblem(type, opts.bytes);
  if (problem) throw new ApiError("bad_request", problem, 400);
  const photoId = id("pho");
  const path = classGalleryPath(album.sectionIds![0]!, album.id, photoId, CLASS_GALLERY_TYPES[type]!.ext);
  const { sb } = await db();
  const { data, error } = await sb.storage.from(CLASS_GALLERY_BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new ApiError("server_error", "Could not start the upload — try again", 503);
  return { photoId, path, uploadUrl: data.signedUrl, contentType: type, kind: CLASS_GALLERY_TYPES[type]!.kind };
}

/**
 * After the phone's upload: record the item as "pending", then run the AI
 * check (lib/classGalleryReview) — parents see it only once it passes, and
 * only a passed item is copied to Drive. A check that does not finish in
 * time is finished by the scheduled tick.
 */
export async function finishClassUpload(
  ctx: ApiAuthContext,
  opts: { albumId: string; photoId: string; path: string; caption: string },
  deadline: number,
) {
  const album = await albumOf(opts.albumId);
  await assertMaySection(ctx, album.sectionIds![0]!);
  // Only the path this album would have issued — never one the phone made up.
  const ext = opts.path.split(".").pop() || "";
  if (opts.path !== classGalleryPath(album.sectionIds![0]!, album.id, opts.photoId, ext)) {
    throw new ApiError("bad_request", "That upload does not belong to this event.", 400);
  }
  const type = Object.entries(CLASS_GALLERY_TYPES).find(([, t]) => t.ext === ext)?.[0] ?? "";
  if (!type) throw new ApiError("bad_request", "Unknown file type", 400);
  const { sb, tenantId } = await db();
  const parent = opts.path.split("/").slice(0, -1).join("/");
  const name = opts.path.split("/").pop() || "";
  const { data: listed, error: le } = await sb.storage.from(CLASS_GALLERY_BUCKET).list(parent, { search: name, limit: 5 });
  if (le || !(listed ?? []).some((f) => f.name === name)) {
    throw new ApiError("bad_request", "The file did not arrive — please try again.", 400);
  }
  const now = new Date().toISOString();
  const kind = CLASS_GALLERY_TYPES[type]!.kind;
  const row = {
    ...photoToRow(tenantId, {
      id: opts.photoId,
      albumId: album.id,
      url: classMediaUrl(opts.photoId),
      caption: String(opts.caption ?? "").slice(0, 200),
      uploadedAt: now,
      uploadedBy: ctx.session.fullName || "Class teacher",
      mediaKind: kind,
      storagePath: opts.path,
    }),
    review_status: "pending",
  };
  const { error } = await sb.from("school_comms_desk_photos").upsert(row, { onConflict: "id", ignoreDuplicates: true });
  if (error) throw new ApiError("server_error", "Could not save — try again", 503);
  await touchCommsMeta(sb, tenantId, now).catch(() => undefined);
  const { reviewClassItem } = await import("@/lib/classGalleryReview.server");
  const status = await reviewClassItem(opts.photoId, deadline);
  return { id: opts.photoId, url: classMediaUrl(opts.photoId), kind, status };
}

/** The sections a parent's children on roll are in. */
export function parentSections(householdStudents: SisStudent[], sessionAy: string): Set<string> {
  return new Set(childrenOnRoll(householdStudents, sessionAy).map((s) => sectionKey(s.classId, s.sectionId)));
}

/**
 * One item, for the media route: where it lives (the bucket, or — after its
 * 30 days — Drive), its album's audience and its review status.
 */
export async function readClassMedia(photoId: string): Promise<{
  path: string;
  url: string;
  sectionIds: string[];
  reviewStatus: ReviewStatus;
  mediaKind: "photo" | "video";
  /** Set once the bucket copy is gone: Drive serves it. */
  driveFileId: string;
  evicted: boolean;
} | null> {
  const { sb, tenantId } = await db();
  const { data: p, error } = await sb.from("school_comms_desk_photos").select("*").eq("tenant_id", tenantId).eq("id", photoId).maybeSingle();
  if (error) throw new ApiError("server_error", "Could not read — try again", 503);
  if (!p) return null;
  const photo = rowToPhoto(p as Record<string, unknown>);
  const { data: a, error: ae } = await sb
    .from("school_comms_desk_albums")
    .select("section_ids")
    .eq("tenant_id", tenantId)
    .eq("id", photo.albumId)
    .maybeSingle();
  if (ae) throw new ApiError("server_error", "Could not read — try again", 503);
  let driveFileId = "";
  if (photo.storageEvicted && photo.storagePath) {
    const { data: d } = await sb
      .from("drive_archive")
      .select("drive_file_id")
      .eq("tenant_id", tenantId)
      .eq("kind", "media")
      .eq("ref", `${CLASS_GALLERY_BUCKET}/${photo.storagePath}`)
      .maybeSingle();
    driveFileId = String((d as { drive_file_id?: string } | null)?.drive_file_id || "");
  }
  return {
    path: photo.storagePath || "",
    url: photo.url,
    reviewStatus: photo.reviewStatus ?? "ok",
    mediaKind: photo.mediaKind === "video" ? "video" : "photo",
    driveFileId,
    evicted: !!photo.storageEvicted,
    sectionIds: Array.isArray((a as { section_ids?: unknown } | null)?.section_ids) ? ((a as { section_ids: string[] }).section_ids) : [],
  };
}

export async function signedMediaUrl(path: string): Promise<string> {
  const { sb } = await db();
  const { data, error } = await sb.storage.from(CLASS_GALLERY_BUCKET).createSignedUrl(path, 10 * 60);
  if (error || !data?.signedUrl) throw new ApiError("server_error", "Could not open the file — try again", 503);
  return data.signedUrl;
}
