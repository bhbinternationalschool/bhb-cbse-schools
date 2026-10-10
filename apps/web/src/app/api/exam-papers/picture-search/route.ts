import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";

export const runtime = "nodejs";

const COMMONS = "https://commons.wikimedia.org/w/api.php";
const UA = "BHB-School-ERP/1.0 (exam paper editor; director@bhbinternational.school)";

/**
 * GET ?q=… → { results: [{ id, title, thumbUrl, width, height, license, author, pageUrl }] }
 *
 * Pictures for question papers come from Wikimedia Commons: free, openly
 * licensed, no key. The teacher picks from the list; picture-fetch then
 * brings the chosen thumbnail in as a data URL. The licence and author
 * travel with it as the caption so the paper credits the source.
 */
export async function GET(req: Request) {
  const session = await getDemoSession();
  if (!session || session.persona !== "staff") {
    return NextResponse.json({ error: "Staff login required" }, { status: 403 });
  }
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim().slice(0, 120);
  if (q.length < 2) return NextResponse.json({ error: "Type what to search for" }, { status: 400 });
  const params = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: `${q} filetype:bitmap|drawing`,
    gsrnamespace: "6",
    gsrlimit: "16",
    prop: "imageinfo",
    iiprop: "url|extmetadata|size",
    iiurlwidth: "480",
    format: "json",
    formatversion: "2",
  });
  let data: {
    query?: {
      pages?: {
        pageid: number;
        title: string;
        imageinfo?: {
          thumburl?: string;
          thumbwidth?: number;
          thumbheight?: number;
          descriptionurl?: string;
          extmetadata?: Record<string, { value?: string }>;
        }[];
      }[];
    };
  };
  try {
    const res = await fetch(`${COMMONS}?${params.toString()}`, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return NextResponse.json({ error: `Picture search failed (HTTP ${res.status})` }, { status: 502 });
    data = (await res.json()) as typeof data;
  } catch (e) {
    return NextResponse.json({ error: `Picture search failed: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
  }
  const strip = (s: string) => s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  const results = (data.query?.pages ?? [])
    .map((p) => {
      const ii = p.imageinfo?.[0];
      if (!ii?.thumburl) return null;
      const meta = ii.extmetadata ?? {};
      return {
        id: String(p.pageid),
        title: p.title.replace(/^File:/, ""),
        thumbUrl: ii.thumburl,
        width: ii.thumbwidth ?? 0,
        height: ii.thumbheight ?? 0,
        license: strip(meta.LicenseShortName?.value ?? ""),
        author: strip(meta.Artist?.value ?? meta.Credit?.value ?? "").slice(0, 80),
        pageUrl: ii.descriptionurl ?? "",
      };
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
  return NextResponse.json({ results });
}
