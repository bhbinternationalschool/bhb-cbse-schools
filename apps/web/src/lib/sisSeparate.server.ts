import "server-only";

/**
 * Take a child out of a family they were wrongly put in.
 *
 * 26–27 Aug 2026: three unrelated admissions entered with the placeholder
 * mobile 0000000000 (AASHI, DIVYANSHU PATEL, MOHAMMAD ALI) became one
 * household. A household shares its parent details with every child in it,
 * so editing one child's parents rewrote the other two — and there was no
 * way to separate them. This is that way.
 *
 * Server-side and row by row, never through the whole-roster push:
 *   - a new household of the child's own, with a unique HH- code;
 *   - every session row of the child (one per academic year, matched by
 *     admission number) moved to it, optionally with the parent details
 *     cleared — they were copied from the family and are not this child's;
 *   - the child's OWN receipts (every line theirs) moved with them, so the
 *     parent app and receipt resends follow; a receipt shared with a
 *     sibling stays where it is;
 *   - updated_at bumped on every row it touches: an office browser still
 *     holding the old rows has its next save of them refused as a conflict
 *     (see pushSisGuarded) instead of silently putting the child back.
 */

import { getServerTenantContext } from "@/lib/serverTenant";
import {
  isPlaceholderMobile,
  loadSis,
  newSisId,
  nextHouseholdCode,
  normalizeHousehold,
  normalizeMobile,
  writeSisLocalRaw,
} from "@/lib/sis";

export type SeparateResult =
  | {
      ok: true;
      householdId: string;
      householdCode: string;
      studentRows: number;
      receiptsMoved: number;
      receiptsShared: number;
    }
  | { ok: false; error: string };

const PARENT_COLUMNS_CLEARED = {
  father_name: "",
  mother_name: "",
  father_mobile: "",
  mother_mobile: "",
  father_aadhaar_last4: "",
  mother_aadhaar_last4: "",
  father_pan: "",
  mother_pan: "",
  emergency_name: "",
  emergency_mobile: "",
} as const;

export async function separateStudentFromFamily(input: {
  studentId: string;
  clearParentDetails: boolean;
}): Promise<SeparateResult> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Tenant not configured" };
  const { sb, tenantId } = ctx;

  const { data: row, error: rowErr } = await sb
    .from("sis_students")
    .select("id, full_name, admission_no, household_id, father_name, mother_name, father_mobile, mother_mobile")
    .eq("tenant_id", tenantId)
    .eq("id", input.studentId)
    .maybeSingle();
  if (rowErr) return { ok: false, error: rowErr.message };
  if (!row) return { ok: false, error: "Student not found" };
  const oldHh = String(row.household_id || "");
  if (!oldHh) return { ok: false, error: "This student is not in a family yet" };

  // The child's rows in this family: one per academic year.
  const admissionNo = String(row.admission_no || "").trim();
  let childQ = sb.from("sis_students").select("id").eq("tenant_id", tenantId).eq("household_id", oldHh);
  childQ = admissionNo ? childQ.eq("admission_no", admissionNo) : childQ.eq("id", input.studentId);
  const { data: childRows, error: childErr } = await childQ;
  if (childErr) return { ok: false, error: childErr.message };
  const childIds = [...new Set([input.studentId, ...(childRows ?? []).map((r) => String(r.id))])];

  const { count: others, error: othersErr } = await sb
    .from("sis_students")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("household_id", oldHh)
    .not("id", "in", `(${childIds.map((id) => `"${id}"`).join(",")})`);
  if (othersErr) return { ok: false, error: othersErr.message };
  if (!others) return { ok: false, error: "This student is already the only child in the family" };

  const { data: codeRows, error: codeErr } = await sb.from("sis_households").select("code").eq("tenant_id", tenantId);
  if (codeErr) return { ok: false, error: codeErr.message };
  const code = nextHouseholdCode((codeRows ?? []).map((r) => String(r.code || "")));

  const now = new Date().toISOString();
  const ownMobile = [row.father_mobile, row.mother_mobile]
    .map((m) => normalizeMobile(String(m || "")))
    .find((m) => !isPlaceholderMobile(m)) ?? "";
  const household = {
    id: newSisId("hh"),
    tenant_id: tenantId,
    code,
    // Cleared parents mean a blank family the office fills in; kept ones
    // carry over what this child's own record says.
    guardian_name: input.clearParentDetails ? "" : String(row.father_name || row.mother_name || ""),
    mobile: input.clearParentDetails ? "" : ownMobile,
    whatsapp_mobile: input.clearParentDetails ? "" : ownMobile,
    updated_at: now,
  };
  const { error: insErr } = await sb.from("sis_households").insert(household);
  if (insErr) return { ok: false, error: insErr.message };

  const { error: updErr } = await sb
    .from("sis_students")
    .update({
      household_id: household.id,
      updated_at: now,
      ...(input.clearParentDetails ? PARENT_COLUMNS_CLEARED : {}),
    })
    .eq("tenant_id", tenantId)
    .in("id", childIds);
  if (updErr) {
    // Nothing moved — take the empty household back out.
    await sb.from("sis_households").delete().eq("tenant_id", tenantId).eq("id", household.id);
    return { ok: false, error: updErr.message };
  }

  // Receipts: only those whose every line is this child's.
  let receiptsMoved = 0;
  let receiptsShared = 0;
  const { data: vouchers } = await sb
    .from("fee_desk_vouchers")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("household_id", oldHh);
  const vIds = (vouchers ?? []).map((v) => String(v.id));
  if (vIds.length) {
    const { data: lines } = await sb
      .from("fee_desk_voucher_lines")
      .select("voucher_id, student_id")
      .eq("tenant_id", tenantId)
      .in("voucher_id", vIds);
    const byVoucher = new Map<string, Set<string>>();
    for (const l of lines ?? []) {
      const v = String(l.voucher_id);
      const set = byVoucher.get(v) ?? new Set<string>();
      set.add(String(l.student_id || ""));
      byVoucher.set(v, set);
    }
    const mine: string[] = [];
    for (const [v, studs] of byVoucher) {
      const all = [...studs];
      if (all.length && all.every((s) => childIds.includes(s))) mine.push(v);
      else if (all.some((s) => childIds.includes(s))) receiptsShared++;
    }
    if (mine.length) {
      const { error: vErr } = await sb
        .from("fee_desk_vouchers")
        .update({ household_id: household.id, updated_at: now })
        .eq("tenant_id", tenantId)
        .in("id", mine);
      if (!vErr) receiptsMoved = mine.length;
      else console.warn("[sis-separate] receipts not moved", vErr.message);
    }
  }

  // Other browsers re-read the roster when this moves.
  const { data: meta } = await sb.from("sis_sync_meta").select("household_count").eq("tenant_id", tenantId).maybeSingle();
  await sb
    .from("sis_sync_meta")
    .update({ household_count: Number(meta?.household_count ?? 0) + 1, updated_at: now })
    .eq("tenant_id", tenantId);

  // This process's cache, so its next read agrees.
  try {
    const sis = loadSis();
    if (sis.students.some((s) => childIds.includes(s.id))) {
      writeSisLocalRaw({
        ...sis,
        households: [
          ...sis.households,
          normalizeHousehold({
            id: household.id,
            code,
            guardianName: household.guardian_name,
            mobile: household.mobile,
            whatsappMobile: household.whatsapp_mobile,
            revisionAt: now,
          }),
        ],
        students: sis.students.map((s) =>
          childIds.includes(s.id)
            ? {
                ...s,
                householdId: household.id,
                revisionAt: now,
                ...(input.clearParentDetails
                  ? {
                      fatherName: "",
                      motherName: "",
                      fatherMobile: "",
                      motherMobile: "",
                      fatherAadhaarLast4: "",
                      motherAadhaarLast4: "",
                      fatherPan: "",
                      motherPan: "",
                      emergencyName: "",
                      emergencyMobile: "",
                    }
                  : {}),
              }
            : s,
        ),
      });
    }
  } catch (e) {
    console.warn("[sis-separate] cache patch skipped", (e as Error)?.message);
  }

  return {
    ok: true,
    householdId: household.id,
    householdCode: code,
    studentRows: childIds.length,
    receiptsMoved,
    receiptsShared,
  };
}
