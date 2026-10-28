import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { fetchCurrentAcademicYearFromDesk } from "@/lib/mastersNormalized.server";
import { getServerTenantContext } from "@/lib/serverTenant";
import { revalidateSiteContent } from "@/lib/website.server";
import { createRateLimiter } from "@/lib/rateLimit";

export const runtime = "nodejs";

/**
 * An admission enquiry from the public website.
 *
 * Open by necessity — a parent has no account — so it is written to be
 * boring and hard to misuse:
 *
 *   - it INSERTS only at the enquiry stage. The opaque retry key can
 *     recover its acknowledgement number, never personal data or an update.
 *   - every field is length-capped before it reaches the database.
 *   - the reply says the same thing whether or not the school already knows
 *     this family, so the endpoint cannot be used to test whether a number is
 *     on file.
 *
 * Public attribution is restricted to the supported source codes.
 */

const MAX = { name: 120, mobile: 20, message: 1000, short: 80, key: 64 } as const;

/** 10 enquiries per IP per 10 minutes: plenty for a family, blunt for a script. */
const limited = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 10 });

/** Sources a public visitor may claim. Anything else is filed as 'website'. */
const PUBLIC_SOURCES = new Set(["website", "google", "social", "field_survey", "referral", "phone", "whatsapp", "other"]);

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
    const parsed: unknown = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Expected object");
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Expected JSON" }, { status: 400 });
  }

  if (limited(req)) {
    return NextResponse.json(
      { ok: false, error: "Too many enquiries from this connection. Please telephone us." },
      { status: 429 },
    );
  }

  const guardianName = clean(body.guardianName, MAX.name);
  const childName = clean(body.childName, MAX.name);
  const message = clean(body.message, MAX.message);
  const classSought = clean(body.classSought, MAX.name);
  const mobile = normalizeMobile(clean(body.mobile, MAX.mobile));
  const rawSource = clean(body.source, MAX.short).toLowerCase();
  const source = PUBLIC_SOURCES.has(rawSource) ? rawSource : "website";
  const dob = /^\d{4}-\d{2}-\d{2}$/.test(clean(body.dob, 10)) ? clean(body.dob, 10) : "";
  // Field names match AdmissionLead: the desk reads lead_json as a partial
  // lead (admissionsNormalized.server.ts), so these show up in staff screens.
  const concerns = Array.isArray(body.concerns)
    ? body.concerns.filter((c): c is string => typeof c === "string").slice(0, 12).map((c) => c.slice(0, 40))
    : [];
  const transport = clean(body.transport, 12);
  const extras: Record<string, unknown> = {
    dob,
    gender: clean(body.gender, MAX.short),
    motherName: clean(body.motherName, MAX.name),
    locality: clean(body.locality, MAX.name),
    address: clean(body.address, 300),
    pincode: clean(body.pincode, 6).replace(/\D/g, ""),
    transportInterest: transport === "yes" || transport === "no" ? transport : "undecided",
    preferredLanguage: clean(body.preferredLanguage, MAX.short),
    previousBoard: clean(body.previousBoard, MAX.short),
    previousSchool: clean(body.previousSchool, MAX.name),
    rte: body.rte === true,
    concerns,
    campaignId: clean(body.campaignId, MAX.short),
    referralCode: clean(body.referralCode, 20).toUpperCase().replace(/[^A-Z0-9-]/g, ""),
    campaignNote: `Public · ${source}`,
    declarationAccepted: body.consent === true,
    parentConsentAt: body.consent === true ? new Date().toISOString() : "",
    parentConsentBy: body.consent === true ? "parent (public form)" : "",
  };
  // A retry of the same form submission reuses this key, so it files one lead.
  const idemKey = clean(body.idempotencyKey, MAX.key);
  if (!/^[a-zA-Z0-9_-]{16,64}$/.test(idemKey)) {
    return NextResponse.json({ ok: false, error: "Please reload the form and try again." }, { status: 400 });
  }

  // Consent is required independently of caller-supplied attribution.
  if (body.consent !== true) {
    return NextResponse.json(
      { ok: false, error: "Please tick the consent box so we can contact you." },
      { status: 400 },
    );
  }
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

  try {
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

    const id = `lead_web_${ctx.tenantId}_${idemKey}`;
    const now = new Date().toISOString();
    // The DB unique constraint is the concurrency guard. Retry a number collision;
    // never turn an unrelated unique-constraint failure into success.
    for (let attempt = 0; attempt < 3; attempt++) {
      const enquiryNo = `WEB-${randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`;
      const lead = {
        ...extras, id, enquiryNo, stage: "enquiry", source,
        academicYearCode, guardianName, childName, mobile,
        classSoughtId: classSought, leadDate: now.slice(0, 10),
        createdAt: now, updatedAt: now,
        ...(message ? { note: message } : {}),
      };
      const { error } = await ctx.sb.from("admission_desk_leads").insert({
        id, tenant_id: ctx.tenantId, stage: "enquiry", enquiry_no: enquiryNo,
        source, academic_year_code: academicYearCode, guardian_name: guardianName,
        child_name: childName, mobile, class_sought_id: classSought,
        lead_date: now.slice(0, 10), lead_json: lead,
      });
      if (!error) {
        revalidateSiteContent();
        return NextResponse.json({ ok: true, enquiryNo });
      }
      if (error.code === "23505") {
        // A request may have landed before the client lost its connection.
        // Read only its opaque key and tenant, returning no personal details.
        const { data, error: readError } = await ctx.sb.from("admission_desk_leads")
          .select("enquiry_no").eq("tenant_id", ctx.tenantId).eq("id", id).maybeSingle();
        if (!readError && data?.enquiry_no) {
          return NextResponse.json({ ok: true, enquiryNo: data.enquiry_no });
        }
        if (!readError && /enquiry_no/.test(error.message + (error.details ?? ""))) continue;
      }
      console.warn("[api/public/enquiry] insert failed:", error.code);
      break;
    }
    return NextResponse.json(
      { ok: false, error: "We could not record that. Please call 6388104972 or try again." },
      { status: 503 },
    );
  } catch {
    return NextResponse.json(
      { ok: false, error: "We could not record that. Please call 6388104972 or try again." },
      { status: 503 },
    );
  }
}
