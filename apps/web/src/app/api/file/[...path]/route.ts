import { NextResponse } from "next/server";
import { requireStaffApi } from "@/lib/apiRouteAuth.server";
import { getServerTenantContext } from "@/lib/serverTenant";
import { contentTypeFor, sanitizeMediaPath } from "@/lib/media";

export const runtime = "nodejs";

/**
 * Serve one file out of the private `school-files` bucket.
 *
 * The alternative was a Supabase signed URL, which is what the old upload
 * path handed back — and which expires. Storing one on a staff record means
 * the signature works for seven days and then silently 400s on a printed
 * certificate, with nothing in the record to say why. This URL never expires
 * because it holds no permission: the check happens on every request.
 *
 * Staff only, for now. Student photographs are read by parents too, and
 * answering "may THIS parent see THIS child's photo?" needs the ownership
 * that `site_media` will carry — so student photos stay where they are until
 * that exists, rather than being moved somewhere a parent cannot reach them.
 */

type RouteCtx = { params: Promise<{ path: string[] }> };

export async function GET(request: Request, ctx: RouteCtx) {
  const auth = await requireStaffApi(request);
  if (!auth.ok) return auth.response;

  const { path: segments } = await ctx.params;
  const path = sanitizeMediaPath((segments ?? []).join("/"));
  if (!path) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Only types this bucket is allowed to hold can come back out of it, so a
  // file smuggled in by some other route cannot be served as something the
  // browser will execute.
  const contentType = contentTypeFor("school-files", path);
  if (!contentType) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const tenant = await getServerTenantContext();
  if (!tenant) {
    return NextResponse.json(
      { error: "Supabase service role not configured" },
      { status: 503 },
    );
  }

  const { data, error } = await tenant.sb.storage
    .from("school-files")
    .download(path);

  if (error || !data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return new NextResponse(await data.arrayBuffer(), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      // Private: a shared cache must never hold this. The browser may, for an
      // hour — long enough that a class roster of photos is fetched once.
      "Cache-Control": "private, max-age=3600",
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
