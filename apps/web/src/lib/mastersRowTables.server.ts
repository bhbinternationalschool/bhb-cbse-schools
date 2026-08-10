/**
 * Read masters from the masters_desk_* row tables.
 *
 * Stage 2's read-path switch. This assembles exactly the same
 * MastersDeskBundle that fetchMastersDeskFromDb() assembles from
 * masters_desk_slices — same keys, same field names, same order — so the API
 * contract, the client, and every downstream consumer are untouched. Only
 * where the bytes come from changes.
 *
 * That shape is the whole design. Rewiring MastersWorkspace to the new
 * collections API would have meant changing the reader, the writer, the
 * state shape and the UI in one step, with no way to tell which of them
 * broke. Swapping the source underneath a fixed contract can be verified by
 * direct comparison: assemble from both and assert they are identical.
 *
 * Field mapping is snake_case back to the camelCase the app uses. The JSONB
 * is the reference for what each field is called — not a guess, and not the
 * abandoned schema's naming.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { emptyMastersShell } from "@/lib/masters";
import { getServerTenantContext } from "@/lib/serverTenant";
import type { MastersDeskBundle } from "@/lib/mastersNormalized.server";

type Row = Record<string, unknown>;

/**
 * Absent stays absent.
 *
 * The first parity run showed the mapper coercing every null to "", 0 or
 * false while the slice stored null — `parentId`, `isOptional`, `weekday`,
 * `structurePublishedAt`, `classId`, `autoApproveMaxPaise` and more. Most
 * would have been harmless (`if (x.parentId)` treats "" and null alike), but
 * `weekday` proves the principle: **0 is a valid weekday**, so coercing a
 * null to 0 turns "no weekday set" into "Sunday". A holiday rule would have
 * silently acquired a day.
 *
 * So these preserve null rather than inventing a value — the same rule the
 * data layer's `Revision` type enforces: unknown must stay representable.
 */
const s = (v: unknown): string | null => (v == null ? null : String(v));
const n = (v: unknown): number | null => (v == null ? null : Number(v));
const b = (v: unknown): boolean | null => (v == null ? null : v === true);
/** Dates come back as `YYYY-MM-DD` (or a timestamp); keep just the day. */
const d = (v: unknown): string | null =>
  v == null ? null : String(v).slice(0, 10);
/**
 * timestamptz round-trips as `+00:00` while the slice holds `Z`. The same
 * instant spelled two ways — exactly what broke the masters revision guard's
 * string comparison. Normalise to ISO-Z so equality is about the instant.
 */
const ts = (v: unknown): string | null => {
  if (v == null) return null;
  const ms = Date.parse(String(v));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : String(v);
};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/**
 * Order by the position the record held in the slice.
 *
 * Lists render in array order, so inventing an order here — even a more
 * sensible one like (sort_order, id) — would silently reorder somebody's
 * class list the moment the read path switched. `ordinal` is captured from
 * the slice at copy time (migration 20260810070000), so the switch is
 * invisible. Reordering anything is then a separate, deliberate change.
 */
const sortNum = (v: unknown): number => (v == null ? 0 : Number(v));
const sortStr = (v: unknown): string => (v == null ? "" : String(v));

function byOrdinal(a: Row, z: Row): number {
  const d1 = sortNum(a.ordinal) - sortNum(z.ordinal);
  return d1 !== 0 ? d1 : sortStr(a.id).localeCompare(sortStr(z.id));
}

export async function fetchMastersFromRowTables(): Promise<{
  bundle: MastersDeskBundle;
  ok: boolean;
}> {
  const ctx = await getServerTenantContext();
  const { version: _v, ...empty } = emptyMastersShell();
  if (!ctx) return { bundle: empty, ok: false };
  const { sb, tenantId } = ctx;

  const load = async (table: string): Promise<Row[] | null> => {
    const { data, error } = await sb.from(table).select("*").eq("tenant_id", tenantId);
    if (error) {
      console.warn(`[masters-rows] ${table} read failed`, error.message);
      return null;
    }
    return (data ?? []) as Row[];
  };

  const [
    classes, sections, campuses, academicYears, academicTerms, subjects,
    classSubjects, feeHeadCategories, feeHeads, installments, feeGroups,
    feeStructureLines, lateFeeRules, specialFees, specialFeeAssignments,
    concessionKinds, concessions, concessionGrants, seniorStreams,
    numberSeries, holidays, settings,
  ] = await Promise.all([
    load("masters_desk_classes"), load("masters_desk_sections"),
    load("masters_desk_campuses"), load("masters_desk_academic_years"),
    load("masters_desk_academic_terms"), load("masters_desk_subjects"),
    load("masters_desk_class_subjects"), load("masters_desk_fee_head_categories"),
    load("masters_desk_fee_heads"), load("masters_desk_installments"),
    load("masters_desk_fee_groups"), load("masters_desk_fee_structure_lines"),
    load("masters_desk_late_fee_rules"), load("masters_desk_special_fees"),
    load("masters_desk_special_fee_assignments"),
    load("masters_desk_concession_kinds"), load("masters_desk_concessions"),
    load("masters_desk_concession_grants"), load("masters_desk_senior_streams"),
    load("masters_desk_number_series"), load("masters_desk_holidays"),
    load("masters_desk_settings"),
  ]);

  // A single failed table means we do not know what masters is. Returning a
  // partial bundle here is the exact shape of the bug this whole migration
  // exists to remove — an incomplete read that looks like data.
  const all = [
    classes, sections, campuses, academicYears, academicTerms, subjects,
    classSubjects, feeHeadCategories, feeHeads, installments, feeGroups,
    feeStructureLines, lateFeeRules, specialFees, specialFeeAssignments,
    concessionKinds, concessions, concessionGrants, seniorStreams,
    numberSeries, holidays, settings,
  ];
  if (all.some((t) => t === null)) return { bundle: empty, ok: false };

  const settingsFor = (id: string): Row | undefined =>
    (settings as Row[]).find((r) => s(r.id) === id)?.payload as Row | undefined;

  const bundle: MastersDeskBundle = {
    ...empty,

    classes: (classes as Row[]).sort(byOrdinal).map((r) => ({
      id: s(r.id), name: s(r.name), sortOrder: n(r.sort_order),
      groupCode: s(r.group_code), isActive: b(r.is_active),
    })) as unknown as MastersDeskBundle["classes"],

    sections: (sections as Row[]).sort(byOrdinal).map((r) => ({
      id: s(r.id), classId: s(r.class_id), name: s(r.name), isActive: b(r.is_active),
    })) as unknown as MastersDeskBundle["sections"],

    campuses: (campuses as Row[]).sort(byOrdinal).map((r) => ({
      id: s(r.id), code: s(r.code), name: s(r.name),
      isPrimary: b(r.is_primary), isActive: b(r.is_active),
    })) as unknown as MastersDeskBundle["campuses"],

    academicYears: (academicYears as Row[]).sort(byOrdinal).map((r) => ({
      id: s(r.id), code: s(r.code), label: s(r.label),
      startsOn: d(r.starts_on), endsOn: d(r.ends_on),
      status: s(r.status), isActive: b(r.is_active),
    })) as unknown as MastersDeskBundle["academicYears"],

    academicTerms: (academicTerms as Row[]).sort(byOrdinal).map((r) => ({
      id: s(r.id), code: s(r.code), label: s(r.label),
      academicYearCode: s(r.academic_year_code),
      startsOn: d(r.starts_on), endsOn: d(r.ends_on), sortOrder: n(r.sort_order),
    })) as unknown as MastersDeskBundle["academicTerms"],

    subjects: (subjects as Row[]).sort(byOrdinal).map((r) => ({
      id: s(r.id), code: s(r.code), nameEn: s(r.name_en), category: s(r.category),
      sortOrder: n(r.sort_order), isElective: b(r.is_elective),
      parentId: s(r.parent_id), cbseGroupId: s(r.cbse_group_id),
      ncfTagId: s(r.ncf_tag_id), languageSubtype: s(r.language_subtype),
      coScholasticArea: s(r.co_scholastic_area), isActive: b(r.is_active),
    })) as unknown as MastersDeskBundle["subjects"],

    classSubjects: (classSubjects as Row[]).sort(byOrdinal).map((r) => ({
      id: s(r.id), classId: s(r.class_id), subjectId: s(r.subject_id),
      periodsPerWeek: n(r.periods_per_week), isOptional: b(r.is_optional),
      isActive: b(r.is_active),
    })) as unknown as MastersDeskBundle["classSubjects"],

    feeHeadCategories: (feeHeadCategories as Row[]).sort(byOrdinal).map((r) => ({
      id: s(r.id), code: s(r.code), label: s(r.label),
      sortOrder: n(r.sort_order), isActive: b(r.is_active),
    })) as unknown as MastersDeskBundle["feeHeadCategories"],

    feeHeads: (feeHeads as Row[]).sort(byOrdinal).map((r) => ({
      id: s(r.id), code: s(r.code), nameEn: s(r.name_en), nameHi: s(r.name_hi),
      category: s(r.category), frequency: s(r.frequency), sortOrder: n(r.sort_order),
      isOptional: b(r.is_optional), isRefundable: b(r.is_refundable),
      isActive: b(r.is_active),
    })) as unknown as MastersDeskBundle["feeHeads"],

    installments: (installments as Row[]).sort(byOrdinal).map((r) => ({
      id: s(r.id), code: s(r.code), label: s(r.label),
      academicYearCode: s(r.academic_year_code), dueOn: d(r.due_on),
      sortOrder: n(r.sort_order), isActive: b(r.is_active),
    })) as unknown as MastersDeskBundle["installments"],

    feeGroups: (feeGroups as Row[]).sort(byOrdinal).map((r) => ({
      id: s(r.id), code: s(r.code), name: s(r.name),
      academicYearCode: s(r.academic_year_code), studentType: s(r.student_type),
      classIds: arr(r.class_ids), structurePublishedAt: ts(r.structure_published_at),
      structurePublishedBy: s(r.structure_published_by), isActive: b(r.is_active),
    })) as unknown as MastersDeskBundle["feeGroups"],

    feeStructureLines: (feeStructureLines as Row[]).sort(byOrdinal).map((r) => ({
      id: s(r.id), feeGroupId: s(r.fee_group_id), classId: s(r.class_id),
      feeHeadId: s(r.fee_head_id), installmentId: s(r.installment_id),
      amountPaise: n(r.amount_paise),
    })) as unknown as MastersDeskBundle["feeStructureLines"],

    lateFeeRules: (lateFeeRules as Row[]).sort(byOrdinal).map((r) => ({
      id: s(r.id), academicYearCode: s(r.academic_year_code),
      feeHeadId: s(r.fee_head_id), feeHeadIds: arr(r.fee_head_ids),
      mode: s(r.mode), value: n(r.value), graceDays: n(r.grace_days),
      maxAmountPaise: n(r.max_amount_paise), isActive: b(r.is_active),
    })) as unknown as MastersDeskBundle["lateFeeRules"],

    specialFees: (specialFees as Row[]).sort(byOrdinal).map((r) => ({
      id: s(r.id), code: s(r.code), name: s(r.name),
      academicYearCode: s(r.academic_year_code), feeHeadId: s(r.fee_head_id),
      amountPaise: n(r.amount_paise), dueOn: d(r.due_on), reason: s(r.reason),
      isActive: b(r.is_active),
    })) as unknown as MastersDeskBundle["specialFees"],

    // An assignment targets a SET of classes and/or students with an explicit
    // scope — not one student. The initial table shape said otherwise because
    // the source slice is empty and the columns were inferred from the
    // abandoned schema; typecheck caught it. See migration 20260810060000.
    specialFeeAssignments: (specialFeeAssignments as Row[]).sort(byOrdinal).map((r) => ({
      id: s(r.id), specialFeeId: s(r.special_fee_id),
      classIds: arr(r.class_ids) as string[],
      studentIds: arr(r.student_ids) as string[],
      scope: (s(r.scope) || "classes") as "classes" | "students" | "mixed",
      createdAt: ts(r.created_at),
    })) as unknown as MastersDeskBundle["specialFeeAssignments"],

    concessionKinds: (concessionKinds as Row[]).sort(byOrdinal).map((r) => ({
      id: s(r.id), code: s(r.code), label: s(r.label), isSystem: b(r.is_system),
    })) as unknown as MastersDeskBundle["concessionKinds"],

    concessions: (concessions as Row[]).sort(byOrdinal).map((r) => ({
      id: s(r.id), code: s(r.code), name: s(r.name),
      academicYearCode: s(r.academic_year_code), kind: s(r.kind), mode: s(r.mode),
      value: n(r.value), notes: s(r.notes),
      documentationRequired: b(r.documentation_required),
      autoApproveMaxPaise: n(r.auto_approve_max_paise),
      feeHeadIds: arr(r.fee_head_ids), incompatibleCodes: arr(r.incompatible_codes),
      siblingTiers: arr(r.sibling_tiers), isActive: b(r.is_active),
    })) as unknown as MastersDeskBundle["concessions"],

    concessionGrants: (concessionGrants as Row[]).sort(byOrdinal).map((r) => ({
      id: s(r.id), concessionId: s(r.concession_id), studentId: s(r.student_id),
      status: s(r.status), reason: s(r.reason),
      siblingChildNo: n(r.sibling_child_no),
      effectiveFrom: d(r.effective_from), effectiveTo: d(r.effective_to),
      createdAt: ts(r.created_at),
    })) as unknown as MastersDeskBundle["concessionGrants"],

    seniorStreams: (seniorStreams as Row[]).sort(byOrdinal).map((r) => ({
      id: s(r.id), code: s(r.code), nameEn: s(r.name_en),
      traditionalLabel: s(r.traditional_label), nepNote: s(r.nep_note),
      sortOrder: n(r.sort_order), grades: arr(r.grades),
      coreCodes: arr(r.core_codes), electiveCodes: arr(r.elective_codes),
      isActive: b(r.is_active),
    })) as unknown as MastersDeskBundle["seniorStreams"],

    numberSeries: (numberSeries as Row[]).sort(byOrdinal).map((r) => ({
      id: s(r.id), code: s(r.code), label: s(r.label), prefix: s(r.prefix),
      nextNumber: n(r.next_number), padWidth: n(r.pad_width),
      resetOnAy: b(r.reset_on_ay),
      includeSessionInPrefix: b(r.include_session_in_prefix),
    })) as unknown as MastersDeskBundle["numberSeries"],

    holidays: (holidays as Row[]).sort(byOrdinal).map((r) => ({
      id: s(r.id), title: s(r.title), academicYearCode: s(r.academic_year_code),
      kind: s(r.kind), scope: s(r.scope), mode: s(r.mode), dayType: s(r.day_type),
      appliesTo: s(r.applies_to), groupCode: s(r.group_code), weekday: n(r.weekday),
      startsOn: d(r.starts_on), endsOn: d(r.ends_on), note: s(r.note),
      paidForStaff: b(r.paid_for_staff), isPublished: b(r.is_published),
      publishedAt: ts(r.published_at), publishedBy: s(r.published_by),
      workingOverride: b(r.working_override), classIds: arr(r.class_ids),
      exceptionDates: arr(r.exception_dates),
    })) as unknown as MastersDeskBundle["holidays"],
  };

  // The three single-document slices.
  const profile = settingsFor("schoolProfile");
  const timing = settingsFor("schoolTiming");
  const midYear = settingsFor("midYearFeePolicy");
  if (profile) bundle.schoolProfile = profile as MastersDeskBundle["schoolProfile"];
  if (timing) bundle.schoolTiming = timing as MastersDeskBundle["schoolTiming"];
  if (midYear) {
    bundle.midYearFeePolicy = midYear as MastersDeskBundle["midYearFeePolicy"];
  }

  return { bundle, ok: true };
}

/**
 * Compare the row-table bundle against the slice bundle, key by key.
 *
 * Used by the parity check before the switch, and kept afterwards so a drift
 * between the two sources is findable while both still exist. Returns the
 * differing keys rather than a boolean: "they differ" is not actionable.
 */
export function diffMastersBundles(
  fromSlices: MastersDeskBundle,
  fromRows: MastersDeskBundle,
): {
  key: string;
  slices: number | string;
  rows: number | string;
  sample?: { id?: string; field: string; slices: unknown; rows: unknown };
}[] {
  const out: ReturnType<typeof diffMastersBundles> = [];
  const keys = new Set([...Object.keys(fromSlices), ...Object.keys(fromRows)]);
  for (const k of keys) {
    const a = (fromSlices as Record<string, unknown>)[k];
    const z = (fromRows as Record<string, unknown>)[k];
    if (canonical(a) === canonical(z)) continue;
    out.push({
      key: k,
      slices: Array.isArray(a) ? a.length : typeof a,
      rows: Array.isArray(z) ? z.length : typeof z,
      sample: firstFieldDifference(a, z),
    });
  }
  return out;
}

/**
 * Order-insensitive JSON.
 *
 * The first parity run reported all 21 collections as differing while every
 * value was in fact identical: the slice writes `{id, name, isActive,
 * groupCode, sortOrder}` and the mapper builds `{id, name, sortOrder,
 * groupCode, isActive}`. JSON.stringify preserves insertion order, so a
 * byte comparison called that a difference.
 *
 * Key order carries no meaning here — the client reads fields by name, and
 * Postgres normalises jsonb key order anyway — so the comparison is what was
 * wrong, not the mapper. Reordering the mapper to match would have encoded
 * an incidental detail of how the slice happened to be written.
 */
function canonical(v: unknown): string {
  return JSON.stringify(sortKeys(v ?? null));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.keys(v as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
}

/** The first genuinely differing field, so a failure is actionable. */
function firstFieldDifference(
  a: unknown,
  z: unknown,
): { id?: string; field: string; slices: unknown; rows: unknown } | undefined {
  if (!Array.isArray(a) || !Array.isArray(z)) {
    return { field: "(whole value)", slices: a, rows: z };
  }
  const byId = new Map(
    z.map((r) => [String((r as Record<string, unknown>)?.id ?? ""), r]),
  );
  for (const item of a) {
    const rec = item as Record<string, unknown>;
    const id = String(rec?.id ?? "");
    const other = byId.get(id) as Record<string, unknown> | undefined;
    if (!other) return { id, field: "(missing in rows)", slices: rec, rows: null };
    for (const f of new Set([...Object.keys(rec), ...Object.keys(other)])) {
      if (canonical(rec[f]) !== canonical(other[f])) {
        return { id, field: f, slices: rec[f], rows: other[f] };
      }
    }
  }
  return undefined;
}
