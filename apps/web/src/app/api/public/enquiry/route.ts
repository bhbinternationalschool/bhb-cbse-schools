import { NextResponse } from "next/server";
import { fetchCurrentAcademicYearFromDesk } from "@/lib/mastersNormalized.server";
import { getServerTenantContext } from "@/lib/serverTenant";
import { revalidateSiteContent } from "@/lib/website.server";

export const runtime = "nodejs";

/**
 * An admission enquiry from the public website.
 *
 * Open by necessity — a parent has no account — so it is written to be
 * boring and hard to misuse:
 *
 *   - it only ever INSERTS a lead at the `enquiry` stage. There is no id in
 *     the request, so nothing existing can be addressed, overwritten or read
 *     back. The worst a bad actor achieves is a junk row in a list the office
 *     already triages by hand.
 *   - every field is length-capped before it reaches the database.
 *   - the reply says the same thing whether or not the school already knows
 *     this family, so the endpoint cannot be used to test whether a number is
 *     on file.
 *
 * `source` is 'website', which is what lets the Admissions desk say what the
 * website is actually bringing in.
 */

const MAX = { name: 120, mobile: 20, message: 1000 } as const;

const clean = (v: unknown, cap: number): string =>
  typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, cap) : "";

/** Indian mobile numbers, however the parent chose to type it. */
function normalizeMobile(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  const local =
    digits.startsWith("91") && digits.length === 12
      ? digits.slice(2)
      : digits.startsWith("0") && digits.length === 11
        ? digits.slice(1)
        : digits;
  return /^[6-9]\d{9}$/.test(local) ? local : null;
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Expected JSON" }, { status: 400 });
  }

  const guardianName = clean(body.guardianName, MAX.name);
  const childName = clean(body.childName, MAX.name);
  const message = clean(body.message, MAX.message);
  const classSought = clean(body.classSought, MAX.name);
  const mobile = normalizeMobile(clean(body.mobile, MAX.mobile));

  if (!guardianName) {
    return NextResponse.json(
      { ok: false, error: "Please give us your name." },
      { status: 400 },
    );
  }
  if (!mobile) {
    return NextResponse.json(
      { ok: false, error: "That does not look like a ten-digit mobile number." },
      { status: 400 },
    );
  }

  const ctx = await getServerTenantContext();
  if (!ctx) {
    return NextResponse.json(
      { ok: false, error: "The school office is not reachable just now." },
      { status: 503 },
    );
  }

  // The year the school itself says is current, not one compiled in here.
  // If masters cannot answer, the lead is filed with a BLANK year rather
  // than a guessed one: the desk lists leads by tenant and never filters by
  // year, so nothing is hidden, and an empty field reads as "not known"
  // instead of quietly asserting a session this enquiry may not be for.
  const academicYearCode = (await fetchCurrentAcademicYearFromDesk()) ?? "";
  if (!academicYearCode) {
    console.warn(
      "[api/public/enquiry] no current academic year in masters; filing the lead without one",
    );
  }

  const id = `lead_web_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const { error } = await ctx.sb.from("admission_desk_leads").insert({
    id,
    tenant_id: ctx.tenantId,
    stage: "enquiry",
    source: "website",
    academic_year_code: academicYearCode,
    guardian_name: guardianName,
    child_name: childName,
    mobile,
    class_sought_id: classSought,
    lead_date: new Date().toISOString().slice(0, 10),
    // The free-text question has no column of its own; it belongs with the
    // lead rather than being dropped on the floor.
    lead_json: message ? { websiteMessage: message } : {},
  });

  if (error) {
    console.warn("[api/public/enquiry] insert failed:", error.message);
    return NextResponse.json(
      { ok: false, error: "We could not record that. Please telephone us instead." },
      { status: 500 },
    );
  }

  revalidateSiteContent();
  return NextResponse.json({ ok: true });
}
