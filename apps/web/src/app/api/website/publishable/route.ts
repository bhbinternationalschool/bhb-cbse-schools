import { NextResponse } from "next/server";
import { requireStaffApi } from "@/lib/apiRouteAuth.server";
import { getServerTenantContext } from "@/lib/serverTenant";
import type { PublicationKind } from "@/lib/website";

export const runtime = "nodejs";

/**
 * Everything the office could put on the website, in one list.
 *
 * The four desks that feed the site store their content differently — a
 * notice has a body, news has a summary, an album has photos, an event has
 * a date. Reconciling that in the browser would mean the Website desk
 * knowing the shape of four other desks, and breaking whenever one of them
 * changed. It is done here instead, and the desk receives one flat list.
 *
 * This returns CANDIDATES, not published items. Whether each is actually on
 * the site is `site_publications`, which the desk reads through the ordinary
 * data API so the tick is an auditable per-record write like any other.
 */

export type Candidate = {
  kind: PublicationKind;
  id: string;
  title: string;
  detail: string;
  /** Sort key: newest or soonest first, depending on the kind. */
  at: string;
};

export async function GET(req: Request) {
  const auth = await requireStaffApi(req);
  if (!auth.ok) return auth.response;

  const ctx = await getServerTenantContext();
  if (!ctx) {
    return NextResponse.json(
      { ok: false, error: "Database not reachable" },
      { status: 503 },
    );
  }
  const { sb, tenantId } = ctx;

  const [notices, news, albums, events] = await Promise.all([
    sb
      .from("school_comms_desk_notices")
      .select("id, title, body, published_at, created_at")
      .eq("tenant_id", tenantId)
      .limit(200),
    sb
      .from("school_comms_desk_news")
      .select("id, title, summary, published_at, created_at")
      .eq("tenant_id", tenantId)
      .limit(200),
    sb
      .from("school_comms_desk_albums")
      .select("id, title, description, published_at, created_at")
      .eq("tenant_id", tenantId)
      .limit(200),
    sb
      .from("school_events")
      .select("id, title, description, starts_on, is_active")
      .eq("tenant_id", tenantId)
      .limit(200),
  ]);

  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const trim = (v: unknown, n = 140) =>
    str(v).replace(/\s+/g, " ").trim().slice(0, n);

  const items: Candidate[] = [
    ...(notices.data ?? []).map((r) => ({
      kind: "notice" as const,
      id: str(r.id),
      title: trim(r.title, 120) || "Untitled notice",
      detail: trim(r.body),
      at: str(r.published_at) || str(r.created_at),
    })),
    ...(news.data ?? []).map((r) => ({
      kind: "news" as const,
      id: str(r.id),
      title: trim(r.title, 120) || "Untitled news item",
      detail: trim(r.summary),
      at: str(r.published_at) || str(r.created_at),
    })),
    ...(albums.data ?? []).map((r) => ({
      kind: "album" as const,
      id: str(r.id),
      title: trim(r.title, 120) || "Untitled album",
      detail: trim(r.description),
      at: str(r.published_at) || str(r.created_at),
    })),
    ...(events.data ?? [])
      // A cancelled event is not a candidate for the website.
      .filter((r) => r.is_active !== false)
      .map((r) => ({
        kind: "event" as const,
        id: str(r.id),
        title: trim(r.title, 120) || "Untitled event",
        detail: trim(r.description),
        at: str(r.starts_on),
      })),
  ];

  items.sort((a, b) => (a.at < b.at ? 1 : -1));
  return NextResponse.json({ ok: true, items });
}
