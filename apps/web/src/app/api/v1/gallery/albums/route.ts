import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { albumVisibleTo } from "@/lib/classGallery";
import { parentSections } from "@/lib/classGallery.server";
import { fetchGalleryDeskFromDb } from "@/lib/schoolCommsNormalized.server";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { loadSis } from "@/lib/sis";

export const runtime = "nodejs";

/**
 * GET /api/v1/gallery/albums — published photo albums, newest first, each
 * with its photos.
 *
 * Published only. An album the office is still filling is a draft, and a
 * draft reaching a parent's phone is the same mistake as a draft notice
 * reaching one.
 *
 * Class gallery (10 Oct 2026): an album with sections is seen only by the
 * families of those sections (their children on roll) and by staff. Read
 * straight from the tables — a cached copy from before the class columns
 * would not know an album is a class's, and would show it to everyone. Class
 * items are served by /api/v1/gallery/media/<id>, which checks again.
 *
 * Photos travel with their album rather than behind a second call: an album
 * holds a handful of pictures, and a phone on a village connection should
 * not pay a round trip per album to find that out.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const desk = await fetchGalleryDeskFromDb();
    if (!desk.ok) throw new ApiError("server_error", "Could not read the gallery — try again", 503);
    const state = desk.bundle;
    let viewer: Parameters<typeof albumVisibleTo>[1] = { staff: true };
    if (ctx.session.persona !== "staff") {
      await ensureSisHydratedServer();
      const hh = loadSis().students.filter((st) => st.householdId === ctx.session.householdId);
      viewer = { staff: false, sections: parentSections(hh, ctx.session.academicYearCode || "") };
    }

    const byAlbum = new Map<string, typeof state.photos>();
    for (const p of state.photos) {
      if (!p.url) continue;
      const list = byAlbum.get(p.albumId) ?? [];
      list.push(p);
      byAlbum.set(p.albumId, list);
    }

    const albums = state.albums
      .filter((a) => a.status === "published" && albumVisibleTo(a, viewer))
      .sort((a, b) =>
        (b.publishedAt || b.createdAt || "").localeCompare(
          a.publishedAt || a.createdAt || "",
        ),
      )
      .slice(0, 60)
      .map((a) => {
        const photos = (byAlbum.get(a.id) ?? [])
          .slice()
          .sort((x, y) => (x.uploadedAt || "").localeCompare(y.uploadedAt || ""))
          .map((p) => ({
            id: p.id,
            // A class item's url is the ERP route (relative): the app adds its base and login.
            url: p.url,
            caption: p.caption || "",
            kind: p.mediaKind === "video" ? "video" : "photo",
          }));
        return {
          id: a.id,
          title: a.title,
          description: a.description || "",
          // Falls back to the first photo: an album whose cover was never
          // picked still deserves a face on the phone.
          coverUrl: a.coverUrl || photos.find((p) => p.kind === "photo")?.url || "",
          classLabel: a.classLabel || "",
          publishedAt: a.publishedAt || a.createdAt || "",
          photoCount: photos.length,
          photos,
        };
      })
      // An album with no pictures in it is a heading with nothing under it.
      .filter((a) => a.photos.length > 0);

    return apiOk({ albums });
  } catch (e) {
    return apiErr(e);
  }
}
