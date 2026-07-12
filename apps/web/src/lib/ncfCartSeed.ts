/**
 * Seed NCF shopping-cart offerings for IX–X and XI–XII:
 * ensure pack subjects exist (tagged A/B/C/D) and link them to class maps.
 */

import {
  newFoundationId,
  normalizeSubject,
  type ClassSubjectLink,
  type Subject,
} from "@/lib/foundationMasters";
import {
  NEP_STAGE_PACKS,
  applyNepSuggestions,
  periodsForSuggestion,
  type NepStage,
  type NepStagePack,
} from "@/lib/nepSubjectSuggestions";
import { ncfTagForSubject } from "@/lib/cbseSubjectGroups";

export type CartSeedClass = {
  id: string;
  name: string;
  isActive?: boolean;
  groupCode?: string | null;
};

export type CartSeedResult = {
  subjects: Subject[];
  classSubjects: ClassSubjectLink[];
  subjectsAdded: number;
  linksAdded: number;
  /** True when IX–X / XI–XII already had full links — only tags refreshed */
  alreadySeeded: boolean;
};

const OPTIONAL_CODES = new Set([
  "SKT",
  "URDU",
  "IT",
  "AI",
  "VOC",
  "ART",
  "PEW",
  "ENV",
  "ETH",
  "APP-MAT",
  "PSY",
  "SOC",
  "CT",
  "PHY",
  "CHE",
  "BIO",
  "HIS",
  "GEO",
  "POL",
  "ECO",
  "ACC",
  "BST",
  "MAT", // senior: elective among many; still linked
]);

/** IX–X cores that stay non-optional in the class map */
const SECONDARY_CORE = new Set(["ENG", "HIN", "MAT", "SCI", "SST"]);

/** XI–XII: languages often treated as expected; still choosable in cart */
const SENIOR_CORE = new Set(["ENG", "HIN"]);

function packForGroup(group: "SECONDARY" | "SENIOR"): NepStagePack {
  const id: NepStage =
    group === "SECONDARY" ? "secondary_9_10" : "secondary_11_12";
  return NEP_STAGE_PACKS.find((p) => p.id === id)!;
}

function topLevelCodes(pack: NepStagePack): string[] {
  return pack.subjects
    .filter((s) => !s.underCode)
    .map((s) => s.code.toUpperCase());
}

function isOptionalLink(
  group: "SECONDARY" | "SENIOR",
  code: string,
): boolean {
  const c = code.toUpperCase();
  if (group === "SECONDARY") {
    return !SECONDARY_CORE.has(c);
  }
  // Senior cart: almost everything is a choice; mark non-language as optional
  return !SENIOR_CORE.has(c) || OPTIONAL_CODES.has(c);
}

/**
 * Apply NEP packs for IX–X / XI–XII, normalize NCF tags, and link
 * top-level subjects onto every active class in those bands.
 */
export function seedNcfCartOfferings(input: {
  classes: CartSeedClass[];
  subjects: Subject[];
  classSubjects: ClassSubjectLink[];
}): CartSeedResult {
  const ixPack = packForGroup("SECONDARY");
  const xiPack = packForGroup("SENIOR");

  let subjectsAdded = 0;
  let list = input.subjects.map((s) => normalizeSubject(s));

  const r1 = applyNepSuggestions(list, ixPack);
  list = r1.subjects;
  subjectsAdded += r1.added;

  const r2 = applyNepSuggestions(list, xiPack);
  list = r2.subjects;
  subjectsAdded += r2.added;

  // Align pack subjects to scholastic + re-derive NCF tags / language subtypes from codes
  const packCodes = new Set([
    ...topLevelCodes(ixPack),
    ...topLevelCodes(xiPack),
  ]);
  list = list.map((s) => {
    if (!packCodes.has(s.code.toUpperCase())) return normalizeSubject(s);
    return normalizeSubject({
      ...s,
      category: "scholastic",
      coScholasticArea: "",
      // Force code-based tags so legacy G1–G4 / wrong CT→B rows refresh
      ncfTagId: undefined,
      cbseGroupId: null,
      languageSubtype: undefined,
    });
  });

  const byCode = new Map(
    list.map((s) => [s.code.toUpperCase(), s] as const),
  );

  let links = [...(input.classSubjects ?? [])];
  let linksAdded = 0;

  const bands: { group: "SECONDARY" | "SENIOR"; names: string[] }[] = [
    { group: "SECONDARY", names: ["IX", "X"] },
    { group: "SENIOR", names: ["XI", "XII"] },
  ];

  for (const band of bands) {
    const pack = packForGroup(band.group);
    const codes = topLevelCodes(pack);
    const classes = input.classes.filter((c) => {
      if (c.isActive === false) return false;
      const name = c.name.trim().toUpperCase();
      if (band.names.includes(name)) return true;
      return (c.groupCode ?? "").toUpperCase() === band.group;
    });

    for (const cls of classes) {
      for (const code of codes) {
        const sub = byCode.get(code);
        if (!sub || !sub.isActive || sub.parentId) continue;
        // Skip empty CO-only noise — packs shouldn't include pure CO for senior cart
        const tag = ncfTagForSubject(sub);
        if (tag === "CO") continue;

        const existing = links.find(
          (l) =>
            l.classId === cls.id &&
            l.subjectId === sub.id &&
            l.isActive,
        );
        if (existing) {
          // Ensure optional flag is set for cart clarity
          const wantOpt = isOptionalLink(band.group, code);
          if (existing.isOptional !== wantOpt) {
            links = links.map((l) =>
              l.id === existing.id ? { ...l, isOptional: wantOpt } : l,
            );
          }
          continue;
        }

        links.push({
          id: newFoundationId("csub"),
          classId: cls.id,
          subjectId: sub.id,
          periodsPerWeek: periodsForSuggestion(pack.id, {
            code: sub.code,
            nameEn: sub.nameEn,
            category: sub.category,
          }),
          isActive: true,
          isOptional: isOptionalLink(band.group, code),
        });
        linksAdded += 1;
      }
    }
  }

  return {
    subjects: list,
    classSubjects: links,
    subjectsAdded,
    linksAdded,
    alreadySeeded: subjectsAdded === 0 && linksAdded === 0,
  };
}

/** True when every IX–X / XI–XII class has at least one Tag A and one Tag B link. */
export function ncfCartOfferingsReady(input: {
  classes: CartSeedClass[];
  subjects: Subject[];
  classSubjects: ClassSubjectLink[];
}): boolean {
  const byId = new Map(input.subjects.map((s) => [s.id, s]));
  const bands = [
    { names: ["IX", "X"], group: "SECONDARY" as const },
    { names: ["XI", "XII"], group: "SENIOR" as const },
  ];

  for (const band of bands) {
    const classes = input.classes.filter((c) => {
      if (c.isActive === false) return false;
      const name = c.name.trim().toUpperCase();
      return (
        band.names.includes(name) ||
        (c.groupCode ?? "").toUpperCase() === band.group
      );
    });
    if (classes.length === 0) return false;

    for (const cls of classes) {
      const linked = (input.classSubjects ?? [])
        .filter((l) => l.isActive && l.classId === cls.id)
        .map((l) => byId.get(l.subjectId))
        .filter((s): s is Subject => !!s && s.isActive && !s.parentId);

      const tags = new Set(linked.map((s) => ncfTagForSubject(s)));
      if (!tags.has("A")) return false;
      if (band.group === "SECONDARY" && !tags.has("B")) return false;
      if (band.group === "SENIOR" && !tags.has("C")) return false;
      if (linked.length < 5) return false;
    }
  }
  return true;
}
