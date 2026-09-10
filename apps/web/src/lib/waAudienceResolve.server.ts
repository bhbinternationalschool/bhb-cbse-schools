/**
 * Turn an audience spec into people to write to, server-side.
 *
 * One resolver for every audience the send screen offers, so opt-out, the
 * known-not-on-WhatsApp skip, the fall-through across a family's numbers,
 * and per-family language are applied once rather than reinvented per
 * screen. Whatever the audience, a recipient comes out the same shape.
 *
 * Names come back with the numbers on purpose: the confirm step shows who
 * is about to be messaged, and an audience the office can only see as a
 * count is an audience nobody can check.
 */

import "server-only";

import { loadSis, type Household, type SisStudent } from "@/lib/sis";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { ensureFeesHydratedServer } from "@/lib/feesPersistence.server";
import { loadServerMasters } from "@/lib/api/v1/auth";
import { currentAcademicYearCode, type MastersState } from "@/lib/masters";
import { listLiveDefaulters } from "@/lib/playbook";
import { waTemplateLanguageFor } from "@/lib/householdPrefs";
import { listOptedOutSet, toE164India } from "@/lib/waContactState.server";
import { listKnownNotOnWhatsApp } from "@/lib/waNumberHealth.server";
import {
  householdCandidateNumbers,
  pickWaNumbers,
} from "@/lib/waHouseholdNumbers";
import {
  describeWaAudience,
  isWholeSchoolAudience,
  type WaAudienceSpec,
} from "@/lib/waAudienceSpec";

export type WaAudienceRecipient = {
  mobile: string;
  fallbackMobile?: string;
  /** "Father's number" when the designated one is dead. */
  numberLabel?: string;
  language: "en" | "hi";
  /** Shown on the confirm step: "Aarav Sharma · V-A" or a staff name. */
  name: string;
  /** Household id for parents, staff id for staff. */
  refId: string;
  /** Variables for this recipient's own template render. */
  variables: Record<string, string>;
};

export type WaAudienceResolution = {
  ok: boolean;
  recipients: WaAudienceRecipient[];
  /** One line naming the audience, for the confirm dialog. */
  label: string;
  wholeSchool: boolean;
  skippedOptOut: number;
  skippedNotOnWhatsApp: number;
  /** In the audience but with no usable number at all. */
  skippedNoNumber: number;
  error?: string;
};

function classLabelOf(masters: MastersState, student: SisStudent): string {
  const cls = (masters.classes ?? []).find((c) => c.id === student.classId);
  const sec = (masters.sections ?? []).find((s) => s.id === student.sectionId);
  return [cls?.name, sec?.name].filter(Boolean).join("-") || "";
}

/** Sections covered by a parents spec: named sections plus whole classes. */
function targetSectionIds(
  spec: Extract<WaAudienceSpec, { kind: "parents" }>,
  masters: MastersState,
): Set<string> | null {
  const want = new Set<string>(spec.sectionIds ?? []);
  for (const classId of spec.classIds ?? []) {
    for (const s of masters.sections ?? []) {
      if (s.classId === classId) want.add(s.id);
    }
  }
  // null = no narrowing at all, i.e. every active family.
  return want.size ? want : null;
}

type HouseholdHit = { household: Household; students: SisStudent[] };

function householdHits(
  studentFilter: (s: SisStudent) => boolean,
  sis: { households: Household[]; students: SisStudent[] },
): HouseholdHit[] {
  const byHousehold = new Map<string, SisStudent[]>();
  for (const s of sis.students) {
    if (s.status !== "active" || !s.householdId) continue;
    if (!studentFilter(s)) continue;
    const list = byHousehold.get(s.householdId) ?? [];
    list.push(s);
    byHousehold.set(s.householdId, list);
  }
  const out: HouseholdHit[] = [];
  for (const [householdId, students] of byHousehold) {
    const household = sis.households.find((h) => h.id === householdId);
    if (!household) continue;
    out.push({ household, students });
  }
  return out;
}

export async function resolveWaAudience(
  spec: WaAudienceSpec,
): Promise<WaAudienceResolution> {
  const masters = await loadServerMasters();
  const label = describeWaAudience(spec, {
    classes: Object.fromEntries(
      (masters.classes ?? []).map((c) => [c.id, c.name]),
    ),
    sections: Object.fromEntries(
      (masters.sections ?? []).map((s) => [
        s.id,
        `${(masters.classes ?? []).find((c) => c.id === s.classId)?.name ?? ""}-${s.name}`,
      ]),
    ),
    departments: Object.fromEntries(
      (masters.departments ?? []).map((d) => [d.id, d.name]),
    ),
    designations: Object.fromEntries(
      (masters.designations ?? []).map((d) => [d.id, d.name]),
    ),
  });
  const base = {
    label,
    wholeSchool: isWholeSchoolAudience(spec),
    skippedOptOut: 0,
    skippedNotOnWhatsApp: 0,
    skippedNoNumber: 0,
  };

  // ── Staff ──────────────────────────────────────────────────────────────
  if (spec.kind === "staff") {
    const stream = spec.stream ?? "all";
    const wantDept = new Set(spec.departmentIds ?? []);
    const wantDesig = new Set(spec.designationIds ?? []);
    const raw = (masters.staff ?? []).filter((s) => {
      if (s.status !== "active") return false;
      if (stream !== "all" && s.stream !== stream) return false;
      if (wantDept.size && !wantDept.has(s.departmentId || "")) return false;
      if (wantDesig.size && !wantDesig.has(s.designationId || "")) return false;
      return true;
    });

    // Staff have two numbers on file as well, so they get the same
    // fall-through: a teacher whose primary is not on WhatsApp is written
    // to on their alternate rather than missed.
    const staffNumbers = raw.map((s) => ({
      staff: s,
      numbers: [s.mobile, s.altMobile]
        .map((m) => (m || "").replace(/\D/g, "").slice(-10))
        .filter((m) => m.length === 10 && /^[6-9]/.test(m)),
    }));
    const staffKnownBad = await listKnownNotOnWhatsApp(
      staffNumbers.flatMap((x) => x.numbers),
    ).catch(() => new Set<string>());

    const seen = new Set<string>();
    const candidates: WaAudienceRecipient[] = [];
    let skippedNoNumber = 0;
    for (const { staff: s, numbers } of staffNumbers) {
      const usable = numbers.filter(
        (m) => !staffKnownBad.has(m),
      );
      const mobile = usable[0];
      if (!mobile) {
        skippedNoNumber++;
        continue;
      }
      if (seen.has(mobile)) continue;
      seen.add(mobile);
      candidates.push({
        mobile,
        fallbackMobile: usable[1],
        numberLabel:
          mobile === numbers[0] ? "Staff mobile" : "Staff alternate number",
        language: "en",
        name: s.fullName || s.empCode || s.id,
        refId: s.id,
        variables: {
          staffName: s.fullName || "",
          schoolName: "",
        },
      });
    }
    const filtered = await dropUnreachable(candidates);
    return {
      ok: true,
      recipients: filtered.kept,
      ...base,
      skippedNoNumber,
      skippedOptOut: filtered.skippedOptOut,
      skippedNotOnWhatsApp: filtered.skippedNotOnWhatsApp,
    };
  }

  // ── Everything else is families ────────────────────────────────────────
  await ensureSisHydratedServer().catch(() => false);
  const sis = loadSis();
  const ay = currentAcademicYearCode(masters);

  let hits: HouseholdHit[] = [];

  if (spec.kind === "parents") {
    const want = targetSectionIds(spec, masters);
    hits = householdHits(
      (s) => (want ? want.has(s.sectionId) : true),
      { households: sis.households ?? [], students: sis.students ?? [] },
    );
    if (spec.languageUnset) {
      hits = hits.filter(
        (h) => !(h.household.preferredLanguage || "").trim(),
      );
    }
  } else if (spec.kind === "students") {
    const want = new Set(spec.studentIds);
    hits = householdHits((s) => want.has(s.id), {
      households: sis.households ?? [],
      students: sis.students ?? [],
    });
  } else {
    // fee_stage — the recovery stage is computed, not stored on the student.
    await ensureFeesHydratedServer().catch(() => false);
    const wantStages = new Set(spec.stages);
    const defaulters = listLiveDefaulters({
      academicYearCode: ay,
      sis,
      masters,
    }).filter((d) => wantStages.has(d.stage));
    const wantStudents = new Set(defaulters.map((d) => d.studentId));
    hits = householdHits((s) => wantStudents.has(s.id), {
      households: sis.households ?? [],
      students: sis.students ?? [],
    });
  }

  // Every number every one of these families has, asked about once.
  const candidatesByHousehold = new Map(
    hits.map((h) => [
      h.household.id,
      householdCandidateNumbers({
        household: h.household,
        students: h.students,
      }),
    ]),
  );
  const knownBad = await listKnownNotOnWhatsApp(
    [...candidatesByHousehold.values()].flat().map((c) => c.mobile10),
  ).catch(() => new Set<string>());

  const candidates: WaAudienceRecipient[] = [];
  let skippedNoNumber = 0;
  let skippedNotOnWhatsAppEntirely = 0;
  for (const h of hits) {
    const cands = candidatesByHousehold.get(h.household.id) ?? [];
    if (!cands.length) {
      skippedNoNumber++;
      continue;
    }
    const choice = pickWaNumbers(cands, knownBad);
    if (!choice.primary) {
      // Every number this family has is known dead — see Numbers to fix.
      skippedNotOnWhatsAppEntirely++;
      continue;
    }
    const childNames = h.students.map((s) => s.fullName);
    candidates.push({
      mobile: choice.primary.mobile10,
      fallbackMobile: choice.fallback?.mobile10,
      numberLabel: choice.primary.label,
      language: waTemplateLanguageFor(h.household),
      name: `${h.household.guardianName || "Parent"} · ${childNames.join(", ")}`,
      refId: h.household.id,
      variables: {
        guardianName: h.household.guardianName || "Parent",
        childName: childNames[0] || "your child",
        classLabel: h.students[0]
          ? classLabelOf(masters, h.students[0])
          : "",
      },
    });
  }

  const filtered = await dropUnreachable(candidates);
  return {
    ok: true,
    recipients: filtered.kept,
    ...base,
    skippedNoNumber,
    skippedOptOut: filtered.skippedOptOut,
    skippedNotOnWhatsApp:
      filtered.skippedNotOnWhatsApp + skippedNotOnWhatsAppEntirely,
  };
}

/**
 * STOP and known-dead numbers, applied to whatever the audience produced.
 *
 * Fails OPEN on a read error — a lookup failure must not silently shrink an
 * audience the office has just been shown a count for.
 */
async function dropUnreachable(recipients: WaAudienceRecipient[]): Promise<{
  kept: WaAudienceRecipient[];
  skippedOptOut: number;
  skippedNotOnWhatsApp: number;
}> {
  if (!recipients.length) {
    return { kept: [], skippedOptOut: 0, skippedNotOnWhatsApp: 0 };
  }
  const mobiles = recipients.map((r) => r.mobile);
  const [optedOut, notOnWa] = await Promise.all([
    listOptedOutSet(mobiles).catch(() => new Set<string>()),
    listKnownNotOnWhatsApp(mobiles).catch(() => new Set<string>()),
  ]);
  const kept: WaAudienceRecipient[] = [];
  let skippedOptOut = 0;
  let skippedNotOnWhatsApp = 0;
  for (const r of recipients) {
    const key = toE164India(r.mobile);
    if (optedOut.has(key)) skippedOptOut++;
    else if (notOnWa.has(key)) skippedNotOnWhatsApp++;
    else kept.push(r);
  }
  return { kept, skippedOptOut, skippedNotOnWhatsApp };
}
