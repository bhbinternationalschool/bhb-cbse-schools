import { writeAudit } from "@/lib/audit.server";
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { requestMeta, resolveApiAuth } from "@/lib/api/v1/auth";
import { requireParentHousehold } from "@/lib/api/v1/household";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { householdForParent } from "@/lib/parentProfile";
import { updateHouseholdContactInDb, type HouseholdContactFields } from "@/lib/sisProfile.server";
import { loadSis } from "@/lib/sis";

export const runtime = "nodejs";

type Body = Partial<Record<keyof HouseholdContactFields, string>>;

const FIELDS: (keyof HouseholdContactFields)[] = [
  "guardianName", "altMobile", "email", "address", "locality",
  "landmark", "city", "state", "pincode",
];

/**
 * POST /api/v1/profile/household — the contact details a parent may keep
 * current themselves: guardian name, alternate mobile, email, address.
 * The registered mobile is deliberately not here — it is the login, and
 * changing it is an office job with the parent present.
 *
 * Same fields the web portal's updateParentHouseholdProfile allows; written
 * to the row directly (see sisProfile.server.ts for why not the roster push).
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const householdId = requireParentHousehold(ctx);
    const body = (await request.json().catch(() => ({}))) as Body;

    await ensureSchoolMirrorHydrated();
    await ensureSisHydratedServer();
    const sis = loadSis();
    const prev = sis.households.find((h) => h.id === householdId);
    if (!prev) throw new ApiError("not_found", "Household not found", 404);

    const next: HouseholdContactFields = {
      guardianName: prev.guardianName,
      altMobile: prev.altMobile,
      email: prev.email,
      address: prev.address,
      locality: prev.locality,
      landmark: prev.landmark,
      city: prev.city,
      state: prev.state,
      pincode: prev.pincode,
    };
    const changed: string[] = [];
    for (const f of FIELDS) {
      const raw = body[f];
      if (typeof raw !== "string") continue;
      const v = raw.trim();
      if (v === next[f]) continue;
      if (f === "guardianName" && !v) {
        throw new ApiError("bad_request", "Guardian name cannot be blank", 400);
      }
      if (f === "altMobile" && v && !/^[6-9]\d{9}$/.test(v)) {
        throw new ApiError("bad_request", "Alternate mobile must be a 10-digit Indian number", 400);
      }
      if (f === "pincode" && v && !/^\d{6}$/.test(v)) {
        throw new ApiError("bad_request", "PIN code must be 6 digits", 400);
      }
      if (f === "email" && v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
        throw new ApiError("bad_request", "That email address does not look right", 400);
      }
      if (v.length > 200) {
        throw new ApiError("bad_request", `${f} is too long`, 400);
      }
      next[f] = v;
      changed.push(f);
    }
    if (changed.length === 0) {
      return apiOk({ household: householdForParent(prev), changed: [] });
    }

    const written = await updateHouseholdContactInDb(householdId, next);
    if (!written.ok) {
      console.warn("[profile-v1] household write failed", written.error);
      throw new ApiError("server_error", "Could not save — try again", 503);
    }

    const meta = requestMeta(request);
    await writeAudit({
      session: ctx.session,
      module: "students",
      action: "edit",
      entityType: "household",
      entityId: householdId,
      summary: `Parent updated family contact details (${changed.join(", ")}) from the app`,
      before: Object.fromEntries(changed.map((f) => [f, prev[f as keyof typeof prev]])),
      after: Object.fromEntries(changed.map((f) => [f, next[f as keyof HouseholdContactFields]])),
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    const household = loadSis().households.find((h) => h.id === householdId) ?? { ...prev, ...next };
    return apiOk({ household: householdForParent(household), changed });
  } catch (e) {
    return apiErr(e);
  }
}
