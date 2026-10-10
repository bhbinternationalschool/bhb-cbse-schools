import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";

export const runtime = "nodejs";

const MAX_BYTES = 3 * 1024 * 1024;

/**
 * POST { url } → { dataUrl }
 *
 * Brings a picture chosen in picture-search into the paper as a data URL,
 * the same shape an uploaded picture has, so it prints and syncs like one.
 * Only Wikimedia's image hosts are fetched — this is not a general proxy.
 */
export async function POST(req: Request) {
  const session = await getDemoSession();
  if (!session || session.persona !== "staff") {
    return NextResponse.json({ error: "Staff login required" }, { status: 403 });
  }
  let body: { url?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  let target: URL;
  try {
    target = new URL(String(body.url || ""));
  } catch {
    return NextResponse.json({ error: "Bad picture URL" }, { status: 400 });
  }
  // Commons serves originals from upload.wikimedia.org and, since 2026,
  // thumbnails from thumb.wikimedia.org (with tracking parameters).
  const allowedHosts = new Set(["upload.wikimedia.org", "thumb.wikimedia.org"]);
  target.search = "";
  if (target.protocol !== "https:" || !allowedHosts.has(target.hostname)) {
    return NextResponse.json({ error: "Only pictures from the picture search can be fetched" }, { status: 400 });
  }
  try {
    const res = await fetch(target.toString(), {
      headers: { "User-Agent": "BHB-School-ERP/1.0 (exam paper editor)" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return NextResponse.json({ error: `Could not fetch the picture (HTTP ${res.status})` }, { status: 502 });
    const type = res.headers.get("content-type") || "image/jpeg";
    if (!type.startsWith("image/")) return NextResponse.json({ error: "That link is not a picture" }, { status: 400 });
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_BYTES) return NextResponse.json({ error: "Picture is too large (3 MB max)" }, { status: 413 });
    return NextResponse.json({ dataUrl: `data:${type.split(";")[0]};base64,${buf.toString("base64")}` });
  } catch (e) {
    return NextResponse.json({ error: `Could not fetch the picture: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
  }
}
