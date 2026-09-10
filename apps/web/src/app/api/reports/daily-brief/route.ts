/**
 * GET /api/reports/daily-brief?d=YYYY-MM-DD&exp=&sig=
 *
 * The brief PDF, for Meta to fetch and attach to the 6 PM template. No
 * session: the signature is the authorisation, exactly as the receipt PDF
 * works, because Meta cannot log in.
 *
 * Three reasons this is safe to expose:
 *   - the signature covers the date, so a URL cannot be edited to read
 *     another day
 *   - it expires in five minutes, and Meta fetches within seconds
 *   - with no secret configured in production nothing is signed and nothing
 *     is accepted, so a misconfigured deployment serves nobody rather than
 *     everybody
 *
 * It carries family contact details and fee balances, so it is never
 * cached and never indexed.
 */

import { NextResponse } from "next/server";
import { buildDailyBrief } from "@/lib/dailyBrief.server";
import { renderDailyBriefPdf } from "@/lib/dailyBriefPdf.server";
import { verifyBriefLinkToken } from "@/lib/dailyBriefLinkToken.server";
import { briefFilename } from "@/lib/dailyBrief";
import { loadServerMasters } from "@/lib/api/v1/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const date = (url.searchParams.get("d") || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "Bad date" }, { status: 400 });
  }

  const verdict = verifyBriefLinkToken(
    date,
    url.searchParams.get("exp"),
    url.searchParams.get("sig"),
  );
  if (!verdict.ok) {
    // One status for every failure: a probe must not learn whether a date
    // exists, only that this URL is not valid.
    return NextResponse.json({ error: "Not available" }, { status: 403 });
  }

  try {
    const brief = await buildDailyBrief({ dateIso: date });
    const masters = await loadServerMasters();
    const bytes = await renderDailyBriefPdf(brief, masters);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="${briefFilename(date)}"`,
        "cache-control": "no-store, private",
        "x-robots-tag": "noindex, nofollow",
      },
    });
  } catch (e) {
    console.error("[dailyBrief] render failed", e);
    return NextResponse.json({ error: "Could not build the brief" }, { status: 502 });
  }
}
