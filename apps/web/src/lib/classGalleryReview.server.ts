/**
 * The check every class-gallery item passes before parents see it
 * (director, 10 Oct 2026: "not censored" photos must not reach families).
 *
 *   pending → AI check → ok (parents see it, Drive copy)
 *                      → held (principal and office told; they approve or remove)
 *
 * The file goes to Gemini through its File API — a five-minute video is
 * streamed from storage, never held in memory. An AI that fails or replies
 * nonsense never passes an item: it stays pending for the next try (the
 * scheduled-publish tick, every 10 minutes) and after REVIEW_MAX_ATTEMPTS it
 * is held for a person.
 */

import { geminiApiKey, geminiModel } from "@/lib/erpAiGemini.server";
import { archiveToDrive } from "@/lib/driveArchive.server";
import { getServerTenantContext } from "@/lib/serverTenant";
import { rowToAlbum, rowToPhoto, touchCommsMeta } from "@/lib/schoolCommsNormalized.server";
import {
  CLASS_GALLERY_BUCKET,
  MODERATION_PROMPT,
  MODERATION_SYSTEM,
  REVIEW_MAX_ATTEMPTS,
  classGalleryDriveFolder,
  classMediaUrl,
  parseModerationVerdict,
  type ReviewStatus,
} from "@/lib/classGallery";

const GEMINI = "https://generativelanguage.googleapis.com";
const PHOTOS = "school_comms_desk_photos";
const ALBUMS = "school_comms_desk_albums";
/** A pending item another request touched this recently is left to it. */
const CLAIM_MS = 5 * 60_000;

type Verdict = { verdict: "ok" | "hold"; reason: string };

/** A signed read of a stored item, as a stream with its length. */
async function openStored(path: string): Promise<{ stream: ReadableStream<Uint8Array>; bytes: number } | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const { data } = await ctx.sb.storage.from(CLASS_GALLERY_BUCKET).createSignedUrl(path, 15 * 60);
  if (!data?.signedUrl) return null;
  const res = await fetch(data.signedUrl);
  const bytes = Number(res.headers.get("content-length") || 0);
  if (!res.ok || !res.body || !(bytes > 0)) return null;
  return { stream: res.body, bytes };
}

/** Ask Gemini about one stored file. ok:false = no answer (try again later), never a pass. */
export async function checkClassMedia(
  path: string,
  mimeType: string,
  deadline: number,
): Promise<{ ok: true; verdict: Verdict } | { ok: false; error: string }> {
  const key = geminiApiKey();
  if (!key) return { ok: false, error: "GEMINI_API_KEY not configured" };
  const file = await openStored(path);
  if (!file) return { ok: false, error: "The file could not be read from storage" };
  let fileName = "";
  try {
    const start = await fetch(`${GEMINI}/upload/v1beta/files?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: {
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(file.bytes),
        "X-Goog-Upload-Header-Content-Type": mimeType,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ file: { display_name: "class-gallery-check" } }),
    });
    const uploadUrl = start.headers.get("x-goog-upload-url");
    if (!start.ok || !uploadUrl) return { ok: false, error: `Gemini upload start HTTP ${start.status}` };
    const up = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "Content-Length": String(file.bytes),
        "X-Goog-Upload-Offset": "0",
        "X-Goog-Upload-Command": "upload, finalize",
      },
      body: file.stream,
      duplex: "half",
    } as RequestInit);
    const uj = (await up.json().catch(() => ({}))) as { file?: { name?: string; uri?: string; state?: string } };
    fileName = uj.file?.name ?? "";
    const uri = uj.file?.uri ?? "";
    if (!up.ok || !fileName || !uri) return { ok: false, error: `Gemini upload HTTP ${up.status}` };

    // A video is processed before it can be read.
    let state = uj.file?.state ?? "";
    while (state === "PROCESSING") {
      if (Date.now() > deadline) return { ok: false, error: "Out of time while the video was processed" };
      await new Promise((r) => setTimeout(r, 3000));
      const g = await fetch(`${GEMINI}/v1beta/${fileName}?key=${encodeURIComponent(key)}`);
      state = ((await g.json().catch(() => ({}))) as { state?: string }).state ?? "";
    }
    if (state && state !== "ACTIVE") return { ok: false, error: `Gemini file ${state}` };

    const model = geminiModel("flash");
    const res = await fetch(`${GEMINI}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: MODERATION_SYSTEM }] },
        contents: [{ role: "user", parts: [{ file_data: { mime_type: mimeType, file_uri: uri } }, { text: MODERATION_PROMPT }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 200, responseMimeType: "application/json" },
        safetySettings: [
          "HARM_CATEGORY_HARASSMENT",
          "HARM_CATEGORY_HATE_SPEECH",
          "HARM_CATEGORY_SEXUALLY_EXPLICIT",
          "HARM_CATEGORY_DANGEROUS_CONTENT",
        ].map((category) => ({ category, threshold: "BLOCK_ONLY_HIGH" })),
      }),
    });
    const j = (await res.json().catch(() => ({}))) as {
      candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
      promptFeedback?: { blockReason?: string };
      error?: { message?: string };
    };
    if (!res.ok) return { ok: false, error: j.error?.message || `Gemini HTTP ${res.status}` };
    // Gemini refusing to look at it IS an answer: hold it.
    const finish = j.candidates?.[0]?.finishReason ?? "";
    if (j.promptFeedback?.blockReason || ["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII"].includes(finish)) {
      return { ok: true, verdict: { verdict: "hold", reason: "The AI safety filter flagged it" } };
    }
    const text = (j.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
    const verdict = parseModerationVerdict(text.replace(/^```(?:json)?\s*|```$/gi, ""));
    return verdict ? { ok: true, verdict } : { ok: false, error: "The AI reply could not be read" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Gemini request failed" };
  } finally {
    if (fileName) {
      await fetch(`${GEMINI}/v1beta/${fileName}?key=${encodeURIComponent(key)}`, { method: "DELETE" }).catch(() => undefined);
    }
  }
}

async function tell(title: string, body: string, photoId: string) {
  try {
    const { leadershipStaffIds } = await import("@/lib/jobApplications.server");
    const ids = await leadershipStaffIds();
    if (!ids.length) return;
    const { sendPushToSubjects } = await import("@/lib/webPush.server");
    await sendPushToSubjects("staff", ids, { title, body, data: { kind: "class_gallery_review", id: photoId } });
  } catch (e) {
    console.warn("[class-gallery] review push failed", e);
  }
}

/** Copy a passed item to Drive: Class gallery / <year> / <class> / <event>. A failure is recorded, never fatal. */
export async function copyClassItemToDrive(photoId: string): Promise<boolean> {
  const ctx = await getServerTenantContext();
  if (!ctx) return false;
  const { sb, tenantId } = ctx;
  const { data: p } = await sb.from(PHOTOS).select("*").eq("tenant_id", tenantId).eq("id", photoId).maybeSingle();
  if (!p) return false;
  const photo = rowToPhoto(p as Record<string, unknown>);
  if (photo.reviewStatus !== "ok" || !photo.storagePath) return false;
  const { data: a } = await sb.from(ALBUMS).select("*").eq("tenant_id", tenantId).eq("id", photo.albumId).maybeSingle();
  if (!a) return false;
  const album = rowToAlbum(a as Record<string, unknown>);
  const file = await openStored(photo.storagePath);
  if (!file) return false;
  const ext = photo.storagePath.split(".").pop() || "";
  const { CLASS_GALLERY_TYPES } = await import("@/lib/classGallery");
  const mimeType = Object.entries(CLASS_GALLERY_TYPES).find(([, t]) => t.ext === ext)?.[0] || "application/octet-stream";
  const r = await archiveToDrive({
    kind: "media",
    ref: `${CLASS_GALLERY_BUCKET}/${photo.storagePath}`,
    folderPath: classGalleryDriveFolder(album.academicYearCode, album.classLabel || "", album.title),
    fileName: `${photo.uploadedAt.slice(0, 10)}_${photo.id}.${ext}`,
    mimeType,
    data: file,
  }).catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }));
  if (!r.ok) console.warn("[class-gallery] drive copy failed", r.error);
  return r.ok;
}

/** Make a decision stick: status, note, the event's cover, the desk meta. */
async function settle(photoId: string, status: ReviewStatus, note: string): Promise<void> {
  const ctx = await getServerTenantContext();
  if (!ctx) throw new Error("Database unavailable");
  const { sb, tenantId } = ctx;
  const now = new Date().toISOString();
  const { data, error } = await sb
    .from(PHOTOS)
    .update({ review_status: status, review_note: note.slice(0, 200), updated_at: now })
    .eq("tenant_id", tenantId)
    .eq("id", photoId)
    .select("*")
    .maybeSingle();
  if (error || !data) throw new Error(error?.message || "Item not found");
  const photo = rowToPhoto(data as Record<string, unknown>);
  if (status === "ok" && photo.mediaKind !== "video") {
    // The event's cover: its first photo parents may see.
    await sb
      .from(ALBUMS)
      .update({ cover_url: classMediaUrl(photo.id), updated_at: now })
      .eq("tenant_id", tenantId)
      .eq("id", photo.albumId)
      .eq("cover_url", "");
  }
  await touchCommsMeta(sb, tenantId, now).catch(() => undefined);
}

/**
 * Check one pending item. Returns its status afterwards ("pending" if the AI
 * could not answer in time, or another request is already on it).
 */
export async function reviewClassItem(photoId: string, deadline: number): Promise<ReviewStatus> {
  const ctx = await getServerTenantContext();
  if (!ctx) return "pending";
  const { sb, tenantId } = ctx;
  const { data: row } = await sb.from(PHOTOS).select("*").eq("tenant_id", tenantId).eq("id", photoId).maybeSingle();
  if (!row) return "pending";
  const r = row as Record<string, unknown>;
  const photo = rowToPhoto(r);
  if (photo.reviewStatus !== "pending") return photo.reviewStatus ?? "ok";
  const attempts = Number(r.review_attempts) || 0;
  // Claim it: one checker at a time (a lost claim simply waits CLAIM_MS).
  const { data: claimed } = await sb
    .from(PHOTOS)
    .update({ review_attempts: attempts + 1, updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("id", photoId)
    .eq("review_status", "pending")
    .eq("review_attempts", attempts)
    .select("id");
  if (!claimed?.length) return "pending";

  const ext = (photo.storagePath || "").split(".").pop() || "";
  const { CLASS_GALLERY_TYPES } = await import("@/lib/classGallery");
  const mimeType = Object.entries(CLASS_GALLERY_TYPES).find(([, t]) => t.ext === ext)?.[0] ?? "";
  const res = mimeType
    ? await checkClassMedia(photo.storagePath || "", mimeType, deadline)
    : ({ ok: false, error: "Unknown file type" } as const);

  const { data: a } = await sb.from(ALBUMS).select("title, class_label").eq("tenant_id", tenantId).eq("id", photo.albumId).maybeSingle();
  const where = [String(a?.class_label || ""), String(a?.title || "")].filter(Boolean).join(" · ");
  const what = photo.mediaKind === "video" ? "video" : "photo";

  if (!res.ok) {
    console.warn("[class-gallery] AI check failed", photoId, res.error);
    if (attempts + 1 < REVIEW_MAX_ATTEMPTS) return "pending";
    await settle(photoId, "held", "The AI check could not run — please look at it");
    await tell(`Class ${what} waiting for you`, `${where}: the AI could not check it — please approve or remove.`, photoId);
    return "held";
  }
  if (res.verdict.verdict === "hold") {
    await settle(photoId, "held", res.verdict.reason);
    await tell(`Class ${what} held for review`, `${where}: ${res.verdict.reason}`, photoId);
    return "held";
  }
  await settle(photoId, "ok", "");
  if (Date.now() < deadline) await copyClassItemToDrive(photoId);
  return "ok";
}

/** The principal's (or office's) decision on a held item. Remove deletes the file; the row stays as "removed". */
export async function decideClassItem(photoId: string, action: "approve" | "remove"): Promise<ReviewStatus> {
  const ctx = await getServerTenantContext();
  if (!ctx) throw new Error("Database unavailable");
  const { sb, tenantId } = ctx;
  const { data } = await sb.from(PHOTOS).select("*").eq("tenant_id", tenantId).eq("id", photoId).maybeSingle();
  if (!data) throw new Error("Item not found");
  const photo = rowToPhoto(data as Record<string, unknown>);
  if (!photo.storagePath) throw new Error("This is not a class-gallery item");
  if (action === "approve") {
    if (photo.reviewStatus === "removed") throw new Error("This item was removed");
    await settle(photoId, "ok", "Approved");
    await copyClassItemToDrive(photoId);
    return "ok";
  }
  await settle(photoId, "removed", "Removed by the principal");
  await sb.storage.from(CLASS_GALLERY_BUCKET).remove([photo.storagePath]);
  // The event's cover, if it was this one.
  await sb
    .from(ALBUMS)
    .update({ cover_url: "", updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("id", photo.albumId)
    .eq("cover_url", classMediaUrl(photoId));
  return "removed";
}

/** Held (and still-checking) items for the principal, newest first. */
export async function listItemsForReview() {
  const ctx = await getServerTenantContext();
  if (!ctx) throw new Error("Database unavailable");
  const { sb, tenantId } = ctx;
  const { data, error } = await sb
    .from(PHOTOS)
    .select("*")
    .eq("tenant_id", tenantId)
    .in("review_status", ["held", "pending"])
    .neq("storage_path", "")
    .order("uploaded_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  const photos = (data ?? []).map((r) => rowToPhoto(r as Record<string, unknown>));
  const albumIds = [...new Set(photos.map((p) => p.albumId))];
  const { data: albums } = albumIds.length
    ? await sb.from(ALBUMS).select("id, title, class_label").eq("tenant_id", tenantId).in("id", albumIds)
    : { data: [] as { id: string; title: string; class_label: string }[] };
  const byId = new Map((albums ?? []).map((a) => [String(a.id), a]));
  return photos.map((p) => ({
    id: p.id,
    kind: p.mediaKind === "video" ? "video" : "photo",
    url: classMediaUrl(p.id),
    status: p.reviewStatus,
    note: p.reviewNote ?? "",
    event: String(byId.get(p.albumId)?.title ?? ""),
    classLabel: String(byId.get(p.albumId)?.class_label ?? ""),
    uploadedBy: p.uploadedBy,
    uploadedAt: p.uploadedAt,
  }));
}

/**
 * The tick's sweep: pending items nobody is checking, then passed items whose
 * Drive copy has not landed. Stops at the deadline; the rest wait for the next tick.
 */
export async function sweepClassGallery(deadline: number): Promise<{ checked: number; held: number; copied: number }> {
  const out = { checked: 0, held: 0, copied: 0 };
  const ctx = await getServerTenantContext();
  if (!ctx) return out;
  const { sb, tenantId } = ctx;
  const { data: pending } = await sb
    .from(PHOTOS)
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("review_status", "pending")
    .lt("updated_at", new Date(Date.now() - CLAIM_MS).toISOString())
    .order("uploaded_at", { ascending: true })
    .limit(20);
  for (const p of pending ?? []) {
    if (Date.now() > deadline - 60_000) return out;
    const s = await reviewClassItem(String(p.id), deadline);
    if (s !== "pending") out.checked += 1;
    if (s === "held") out.held += 1;
  }
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data: passed } = await sb
    .from(PHOTOS)
    .select("id, storage_path")
    .eq("tenant_id", tenantId)
    .eq("review_status", "ok")
    .neq("storage_path", "")
    .gt("uploaded_at", since)
    .limit(200);
  if (!passed?.length) return out;
  const { data: copied } = await sb
    .from("drive_archive")
    .select("ref, drive_file_id, attempts")
    .eq("tenant_id", tenantId)
    .eq("kind", "media")
    .in("ref", passed.map((p) => `${CLASS_GALLERY_BUCKET}/${p.storage_path}`));
  // Copied, or tried five times (a dead Drive grant shows in the archive list, not as endless retries).
  const done = new Set(
    (copied ?? []).filter((c) => c.drive_file_id || Number(c.attempts) >= 5).map((c) => String(c.ref)),
  );
  for (const p of passed) {
    if (done.has(`${CLASS_GALLERY_BUCKET}/${p.storage_path}`)) continue;
    if (Date.now() > deadline - 60_000) break;
    if (await copyClassItemToDrive(String(p.id))) out.copied += 1;
  }
  return out;
}
