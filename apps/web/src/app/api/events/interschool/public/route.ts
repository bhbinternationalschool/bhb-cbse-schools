/**
 * Inter-school events — PUBLIC api: the transparency page, registration,
 * and certificate verification. No auth: everything served here is data the
 * school has chosen to publish (draft events are never served), and the
 * registration insert validates itself.
 */

import { NextResponse } from "next/server";
import {
  EvtError,
  publicEventView,
  registerPublic,
  verifyCertificate,
} from "@/lib/events/interschool.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(e: unknown): NextResponse {
  if (e instanceof EvtError) {
    return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
  }
  console.error("[events-public] failed:", e instanceof Error ? e.message : e);
  return NextResponse.json(
    { ok: false, error: "Something went wrong — try again" },
    { status: 500 },
  );
}

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  try {
    const certId = q.get("verify") ?? "";
    if (certId) {
      const cert = await verifyCertificate(certId);
      if (!cert) {
        return NextResponse.json(
          { ok: false, error: "No such certificate" },
          { status: 404 },
        );
      }
      return NextResponse.json({ ok: true, certificate: cert });
    }
    const slug = q.get("slug") ?? "";
    if (!slug) return NextResponse.json({ error: "slug required" }, { status: 400 });
    return NextResponse.json({ ok: true, view: await publicEventView(slug) });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: Request) {
  let body: {
    slug?: string;
    studentName?: string;
    schoolName?: string;
    classLabel?: string;
    guardianMobile?: string;
    categoryId?: string;
    consent?: boolean;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  try {
    const res = await registerPublic({
      slug: String(body.slug ?? ""),
      studentName: String(body.studentName ?? ""),
      schoolName: String(body.schoolName ?? ""),
      classLabel: String(body.classLabel ?? ""),
      guardianMobile: String(body.guardianMobile ?? ""),
      categoryId: String(body.categoryId ?? ""),
      consent: !!body.consent,
    });
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    return fail(e);
  }
}
