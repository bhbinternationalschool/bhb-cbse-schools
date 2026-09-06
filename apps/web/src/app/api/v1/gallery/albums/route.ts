import { apiErr, apiOk } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureSchoolCommsHydratedServer } from "@/lib/schoolCommsPersistence";
import { loadSchoolComms } from "@/lib/schoolComms";

export const runtime = "nodejs";

/**
 * GET /api/v1/gallery/albums — published photo albums, newest first, each
 * with its photos.
 *
 * Published only. An album the office is still filling is a draft, and a
 * draft reaching a parent's phone is the same mistake as a draft notice
 * reaching one. Same source and the same hydrate as /comms/feed, because the
 * albums live in the school-comms desk beside the notices and the news.
 *
 * Photos travel with their album rather than behind a second call: an album
 * holds a handful of pictures, and a phone on a village connection should
 * not pay a round trip per album to find that out.
 */
export async function GET(request: Request) {
  try {
    await resolveApiAuth(request);
    await ensureSchoolMirrorHydrated();
    await ensureSchoolCommsHydratedServer();
    const state = loadSchoolComms();

    const byAlbum = new Map<string, typeof state.photos>();
    for (const p of state.photos) {
      if (!p.url) continue;
      const list = byAlbum.get(p.albumId) ?? [];
      list.push(p);
      byAlbum.set(p.albumId, list);
    }

    const albums = state.albums
      .filter((a) => a.status === "published")
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
            url: p.url,
            caption: p.caption || "",
          }));
        return {
          id: a.id,
          title: a.title,
          description: a.description || "",
          // Falls back to the first photo: an album whose cover was never
          // picked still deserves a face on the phone.
          coverUrl: a.coverUrl || photos[0]?.url || "",
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
