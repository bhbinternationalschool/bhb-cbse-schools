/**
 * The Office Robot ↔ UDISE+ School Profile module (profile.udiseplus.gov.in).
 *
 * POST — { academicYear, section: { key|tab, title }, fields, formStatus, text }
 *        one open section's form as the robot read it from the page. Stored
 *        per year and section (lib/udiseSchoolProfile); earlier years kept.
 * GET  — ?section=<key>&ay=<2026-27>: the fill plan for that section (ERP
 *        facts + last year's answers, empty boxes only) and the 1A compare.
 *        No section: everything captured, for Students → UDISE+.
 *
 * Compliance · edit for both: this is a government form. Nothing here
 * changes an ERP record — the portal snapshot is kept beside the ERP, and a
 * difference is shown to the office, never applied.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import {
  academicYearForDate,
  buildProfileFillPlan,
  compareProfile1A,
  normalizeAcademicYear,
  normalizeFields,
  respondentWarnings,
  SECTION_1A_KEY,
  sectionKeyFromLabel,
  sectionTitle,
  UDISE_PROFILE_SECTIONS,
} from "@/lib/udiseSchoolProfile";
import { readErpSchoolFacts, readSchoolProfileStore, saveSchoolProfileSection } from "@/lib/udiseSchoolProfile.server";

export const runtime = "nodejs";

const MAX_BODY = 600_000;

export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "compliance", "edit");
  if (!auth.ok) return auth.response;
  const raw = await req.text();
  if (raw.length > MAX_BODY) return NextResponse.json({ ok: false, error: "Section too large" }, { status: 413 });
  let body: {
    academicYear?: unknown;
    section?: { key?: unknown; tab?: unknown; title?: unknown };
    fields?: unknown;
    formStatus?: unknown;
    text?: unknown;
  };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Body must be JSON" }, { status: 400 });
  }
  // The robot reads the year off the portal page (or asks the person); a
  // year it could not establish is refused, not guessed from today's date.
  const ay = normalizeAcademicYear(body.academicYear);
  if (!ay) return NextResponse.json({ ok: false, error: "Which academic year is open on the portal? (e.g. 2026-27)" }, { status: 400 });
  const key = sectionKeyFromLabel(String(body.section?.key ?? "")) || sectionKeyFromLabel(String(body.section?.tab ?? ""));
  if (!key) return NextResponse.json({ ok: false, error: "Open one of the numbered section tabs (e.g. 2.1 to 2.6) first." }, { status: 400 });
  const fields = normalizeFields(body.fields);
  const text = String(body.text ?? "");
  if (!Object.keys(fields).length && !text.trim()) {
    return NextResponse.json({ ok: false, error: "The section showed no boxes and no text — nothing sent. Wait for it to load." }, { status: 400 });
  }
  const by = auth.ctx.session.fullName || auth.ctx.session.email || "";
  if (!by) return NextResponse.json({ ok: false, error: "Your login has no name to record." }, { status: 400 });
  const saved = await saveSchoolProfileSection(ay, key, {
    title: String(body.section?.title ?? "").slice(0, 200) || sectionTitle(key),
    capturedAt: new Date().toISOString(),
    capturedBy: by,
    fields,
    formStatus: String(body.formStatus ?? "").slice(0, 60),
    text: text.slice(0, 30_000),
  });
  if (!saved.ok) return NextResponse.json({ ok: false, error: saved.error }, { status: 500 });
  const out: Record<string, unknown> = { ok: true, academicYear: ay, section: key, fieldCount: Object.keys(fields).length };
  if (key === SECTION_1A_KEY) {
    const facts = await readErpSchoolFacts(ay);
    if (facts) {
      out.differences = compareProfile1A(saved.store[ay]?.[key], facts).filter((d) => d.status === "differs");
      out.respondent = respondentWarnings(saved.store[ay]?.[key], facts);
    }
  }
  return NextResponse.json(out);
}

export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "compliance", "edit");
  if (!auth.ok) return auth.response;
  const url = new URL(req.url);
  const ay = normalizeAcademicYear(url.searchParams.get("ay")) || academicYearForDate(new Date());
  const got = await readSchoolProfileStore();
  if (!got) return NextResponse.json({ ok: false, error: "Could not read the stored school profile. Try again." }, { status: 503 });
  const facts = await readErpSchoolFacts(ay);
  if (!facts) return NextResponse.json({ ok: false, error: "Could not read the ERP school profile. Try again." }, { status: 503 });

  const sectionParam = url.searchParams.get("section");
  if (sectionParam) {
    const key = sectionKeyFromLabel(sectionParam);
    if (!key) return NextResponse.json({ ok: false, error: "Unknown section" }, { status: 400 });
    return NextResponse.json({ ok: true, plan: buildProfileFillPlan(got.store, ay, key, facts) });
  }

  // The newest year with a 1A capture is what the office compares against.
  const years = Object.keys(got.store).sort().reverse();
  const yearWith1A = years.find((y) => got.store[y]?.[SECTION_1A_KEY]) ?? "";
  const capture1A = yearWith1A ? got.store[yearWith1A]![SECTION_1A_KEY] : undefined;
  return NextResponse.json({
    ok: true,
    academicYear: ay,
    sections: UDISE_PROFILE_SECTIONS,
    store: got.store,
    updatedAt: got.updatedAt,
    facts,
    compare1A: { academicYear: yearWith1A, rows: compareProfile1A(capture1A, facts), respondent: respondentWarnings(capture1A, facts) },
  });
}
