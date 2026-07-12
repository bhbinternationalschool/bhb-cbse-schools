/**
 * NEP 2020 + NCF-FS / NCF-SE + CBSE (incl. Jadui Pitara / Balvatika) subject
 * suggestions for Masters. Pre-Primary also mirrors UP Basic Shiksha School
 * Readiness (भाषा · अंकीय दक्षता · पर्यावरण). Codes are practical ERP seeds.
 */

import {
  defaultSeniorStreams,
  newFoundationId,
  normalizeSubject,
  type SeniorStream,
  type Subject,
  type SubjectCategory,
} from "@/lib/foundationMasters";

export type NepStage =
  | "foundational"
  | "preparatory"
  | "middle"
  | "secondary_9_10"
  | "secondary_11_12";

export type NepSuggestionItem = {
  code: string;
  nameEn: string;
  category: SubjectCategory;
  coScholasticArea?: string;
  /** Parent group code — component sits under that subject */
  underCode?: string;
  note?: string;
  /** Optional override; otherwise stage defaults apply */
  periodsPerWeek?: number;
};

export type NepStagePack = {
  id: NepStage;
  label: string;
  grades: string;
  ages: string;
  summary: string;
  tips: string[];
  subjects: NepSuggestionItem[];
};

export const NEP_STAGE_PACKS: NepStagePack[] = [
  {
    id: "foundational",
    label: "Pre-Primary · Balvatika",
    grades: "Nursery – UKG",
    ages: "3–6",
    summary:
      "Play-based ECCE (NCF-FS / CBSE Jadui Pitara). Not rigid subject silos — five development domains + FLN readiness. UP Basic Shiksha School Readiness stresses भाषा, आरंभिक अंकीय दक्षता, and पर्यावरण pre-concepts before Class I.",
    tips: [
      "NCF-FS domains: Physical · Socio-emotional & ethical · Cognitive · Language & literacy · Aesthetic & cultural (+ Positive learning habits).",
      "CBSE Circular 19/2024: Balvatika spaces + Jadui Pitara play materials; mother tongue / Hindi as R1 in UP.",
      "UP Basic Shiksha (NIPUN / School Readiness): activity-based भाषा + अंकीय दक्षता + पर्यावरण — avoid heavy textbooks and formal exams.",
      "Assessment = observation / portfolios; keep the day play- and theme-centred.",
    ],
    subjects: [
      {
        code: "HIN",
        nameEn: "Language & Literacy — Hindi (R1)",
        category: "scholastic",
        note: "NCF-FS Language domain · UP स्कूल रेडीनेस — भाषा; mother tongue / regional as R1",
      },
      {
        code: "HIN-ORAL",
        nameEn: "Hindi — Listening, speaking & stories",
        category: "scholastic",
        underCode: "HIN",
        note: "Rhymes, picture talk, storytelling (Jaadui Pitara)",
      },
      {
        code: "ENG",
        nameEn: "English — Oral & early literacy (R2)",
        category: "scholastic",
        note: "Common in CBSE UP schools; keep oral / play-first in Nursery–LKG",
      },
      {
        code: "ENG-ORAL",
        nameEn: "English — Songs, phonics & talk",
        category: "scholastic",
        underCode: "ENG",
      },
      {
        code: "NUM",
        nameEn: "Early Numeracy",
        category: "scholastic",
        note: "NCF Cognitive / FLN · UP आरंभिक अंकीय दक्षता — counting, shapes, patterns (play)",
      },
      {
        code: "WAU",
        nameEn: "World Around Us / Environmental awareness",
        category: "scholastic",
        note: "NCF Cognitive · UP पर्यावरण pre-concepts — nature, seasons, community helpers",
      },
      {
        code: "ART",
        nameEn: "Art, craft & visual expression",
        category: "co_scholastic",
        coScholasticArea: "Aesthetic & Cultural",
        note: "NCF Aesthetic & Cultural domain",
      },
      {
        code: "MUS",
        nameEn: "Music, rhymes & movement",
        category: "co_scholastic",
        coScholasticArea: "Aesthetic & Cultural",
        note: "NCF Aesthetic · supports language & socio-emotional goals",
      },
      {
        code: "PEW",
        nameEn: "Physical development & free play",
        category: "co_scholastic",
        coScholasticArea: "Physical Development",
        note: "NCF Physical domain — gross/fine motor, outdoor play (not formal PE drills)",
      },
      {
        code: "SEE",
        nameEn: "Socio-emotional & ethical development",
        category: "co_scholastic",
        coScholasticArea: "Socio-emotional & Ethical",
        note: "NCF-FS / Jadui Pitara domain — sharing, empathy, routines with peers",
      },
      {
        code: "HAB",
        nameEn: "Positive learning habits & self-help",
        category: "co_scholastic",
        coScholasticArea: "Positive Learning Habits",
        note: "NCF-FS + UP school readiness — hygiene, independence, sitting for a task",
      },
    ],
  },
  {
    id: "preparatory",
    label: "Primary · I–V",
    grades: "I – V",
    ages: "6–11",
    summary:
      "Spans NCF Foundational Grades I–II (FLN) and Preparatory Grades III–V (Languages, Maths, World Around Us / EVS, Art, PE). UP Basic Shiksha: Hindi, English, Maths; from III — Sanskrit/Urdu + हमारा परिवेश; Art/Music & work experience.",
    tips: [
      "I–II: prioritise Foundational Literacy & Numeracy (NIPUN / NCF-FS) — light textbooks, activity-based.",
      "III–V (NCF Preparatory): R1 + R2, Mathematics, The World Around Us (EVS), Art, PE; work/pre-vocational inside WAU.",
      "UP Basic: हमारा परिवेश (III–V); Sanskrit or Urdu as third language option from Class III.",
      "CBSE dual-affiliation schools: keep Hindi + English as concrete languages for Varanasi / UP context.",
    ],
    subjects: [
      {
        code: "HIN",
        nameEn: "Hindi (R1)",
        category: "scholastic",
        note: "UP कलरव · NCF Language R1 (mother tongue / regional)",
      },
      {
        code: "HIN-ORAL",
        nameEn: "Hindi — Oral",
        category: "scholastic",
        underCode: "HIN",
      },
      {
        code: "HIN-WRIT",
        nameEn: "Hindi — Written",
        category: "scholastic",
        underCode: "HIN",
      },
      {
        code: "ENG",
        nameEn: "English (R2)",
        category: "scholastic",
        note: "UP Rainbow · NCF Language R2",
      },
      {
        code: "ENG-ORAL",
        nameEn: "English — Oral",
        category: "scholastic",
        underCode: "ENG",
      },
      {
        code: "ENG-WRIT",
        nameEn: "English — Written",
        category: "scholastic",
        underCode: "ENG",
      },
      {
        code: "MAT",
        nameEn: "Mathematics",
        category: "scholastic",
        note: "I–II: FLN numeracy; III–V: NCF Mathematics curricular area",
      },
      {
        code: "EVS",
        nameEn: "Environmental Studies / World Around Us",
        category: "scholastic",
        note: "NCF Preparatory WAU · UP हमारा परिवेश (III–V); integrated science & social",
      },
      {
        code: "SKT",
        nameEn: "Sanskrit",
        category: "scholastic",
        note: "UP Basic optional from Class III (Sanskrit / Urdu); CBSE third-language path",
      },
      {
        code: "ART",
        nameEn: "Art Education",
        category: "co_scholastic",
        coScholasticArea: "Art Education",
        note: "NCF Art · UP कला / संगीत",
      },
      {
        code: "MUS",
        nameEn: "Music",
        category: "co_scholastic",
        coScholasticArea: "Art Education",
        note: "UP कला/संगीत band — may be merged with Art in timetable",
      },
      {
        code: "PEW",
        nameEn: "Physical Education & Well-being",
        category: "co_scholastic",
        coScholasticArea: "HPE",
        note: "NCF PE & Well-being · UP खेल एवं स्वास्थ्य",
      },
      {
        code: "WE",
        nameEn: "Work experience / Moral education",
        category: "co_scholastic",
        coScholasticArea: "Vocational",
        note: "UP कार्यानुभव / नैतिक शिक्षा · NCF pre-vocational inside WAU",
      },
    ],
  },
  {
    id: "middle",
    label: "Middle · VI–VIII",
    grades: "VI – VIII",
    ages: "11–14",
    summary:
      "NCF Middle: three languages (R1–R3, ≥2 Indian), Mathematics, Science, Social Science, Art, PE & Well-being, Vocational. UP Basic upper primary adds Environmental Studies, Sanskrit/Urdu, craft/agriculture/home science, games & scouting.",
    tips: [
      "Three-language formula: Hindi + English + Sanskrit (or Urdu) is the common UP pattern.",
      "Science and Social Science become separate subjects (NCF); subject teachers introduced.",
      "Vocational / craft gets dedicated space from Grade 6 (NEP/NCF).",
      "UP Basic also assesses पर्यावरणीय अध्ययन and खेल/स्कॉउटिंग — keep as co-curricular links.",
    ],
    subjects: [
      {
        code: "HIN",
        nameEn: "Hindi (R1)",
        category: "scholastic",
        note: "UP मंजरी · Indian language R1",
      },
      {
        code: "HIN-ORAL",
        nameEn: "Hindi — Oral",
        category: "scholastic",
        underCode: "HIN",
      },
      {
        code: "HIN-WRIT",
        nameEn: "Hindi — Written",
        category: "scholastic",
        underCode: "HIN",
      },
      {
        code: "ENG",
        nameEn: "English (R2)",
        category: "scholastic",
      },
      {
        code: "ENG-ORAL",
        nameEn: "English — Oral",
        category: "scholastic",
        underCode: "ENG",
      },
      {
        code: "ENG-WRIT",
        nameEn: "English — Written",
        category: "scholastic",
        underCode: "ENG",
      },
      {
        code: "SKT",
        nameEn: "Sanskrit (R3)",
        category: "scholastic",
        note: "UP Sanskrit/Urdu third language · NCF R3 (Indian)",
      },
      {
        code: "MAT",
        nameEn: "Mathematics",
        category: "scholastic",
      },
      {
        code: "SCI",
        nameEn: "Science",
        category: "scholastic",
        note: "NCF Science Education · UP विज्ञान",
      },
      {
        code: "SST",
        nameEn: "Social Science",
        category: "scholastic",
        note: "NCF thematic Social Science · UP सामाजिक विषय (History/Civics/Geography integrated)",
      },
      {
        code: "ENV",
        nameEn: "Environmental Studies",
        category: "scholastic",
        note: "UP पर्यावरणीय अध्ययन (VI–VIII) · complements Science/SST",
      },
      {
        code: "ART",
        nameEn: "Art Education",
        category: "co_scholastic",
        coScholasticArea: "Art Education",
        note: "NCF Art · UP कला / संगीत",
      },
      {
        code: "MUS",
        nameEn: "Music",
        category: "co_scholastic",
        coScholasticArea: "Art Education",
      },
      {
        code: "PEW",
        nameEn: "Physical Education & Well-being",
        category: "co_scholastic",
        coScholasticArea: "HPE",
        note: "NCF PE · UP खेल एवं शारीरिक शिक्षा / स्काउटिंग",
      },
      {
        code: "VOC",
        nameEn: "Vocational / Work education",
        category: "co_scholastic",
        coScholasticArea: "Vocational",
        note: "NCF Vocational from Middle · UP बेसिक क्राफ्ट / कृषि / गृह शिल्प",
      },
      {
        code: "ICT",
        nameEn: "Computational Thinking / ICT",
        category: "scholastic",
        note: "NEP digital literacy · CBSE skill exposure",
      },
    ],
  },
  {
    id: "secondary_9_10",
    label: "Secondary · IX–X",
    grades: "IX – X",
    ages: "14–16",
    summary:
      "NCF Secondary Phase 1 / CBSE Class IX–X: shopping-cart enrolment — typically 7 subjects with ≥3 languages (Tag A) and ≥1 skill/voc (Tag B), plus academic electives (Tag C) and mandatory modules (Tag D).",
    tips: [
      "Cart rule: exactly 7 · ≥3 Tag A languages · ≥1 Tag B skill (IT / AI / VOC).",
      "Seed links ENG · HIN · SKT/URDU · Maths · Science · SST · skill options into IX and X.",
      "Tag D (ENV / ETH) stay available as curricular modules.",
      "Art & PE remain in the offering — pick into the cart where the school requires them.",
    ],
    subjects: [
      {
        code: "ENG",
        nameEn: "English Language & Literature",
        category: "scholastic",
        note: "Tag A · Foreign language",
      },
      {
        code: "ENG-ORAL",
        nameEn: "English — Oral / ASL",
        category: "scholastic",
        underCode: "ENG",
        note: "CBSE Assessment of Speaking & Listening",
      },
      {
        code: "ENG-WRIT",
        nameEn: "English — Written",
        category: "scholastic",
        underCode: "ENG",
      },
      {
        code: "HIN",
        nameEn: "Hindi Course A / B",
        category: "scholastic",
        note: "Tag A · Native language",
      },
      {
        code: "SKT",
        nameEn: "Sanskrit",
        category: "scholastic",
        note: "Tag A · Regional / Indian language",
      },
      {
        code: "URDU",
        nameEn: "Urdu",
        category: "scholastic",
        note: "Tag A · Regional / Indian language option",
      },
      {
        code: "MAT",
        nameEn: "Mathematics (Standard / Basic)",
        category: "scholastic",
        note: "Tag C · Academic",
      },
      {
        code: "SCI",
        nameEn: "Science",
        category: "scholastic",
        note: "Tag C · Integrated Physics–Chemistry–Biology",
      },
      {
        code: "SST",
        nameEn: "Social Science",
        category: "scholastic",
        note: "Tag C · History, Geography, Political Science, Economics",
      },
      {
        code: "IT",
        nameEn: "Information Technology / Computer Applications",
        category: "scholastic",
        note: "Tag B · Skill",
      },
      {
        code: "AI",
        nameEn: "Artificial Intelligence (Skill)",
        category: "scholastic",
        note: "Tag B · Skill",
      },
      {
        code: "VOC",
        nameEn: "Vocational / Skill subject",
        category: "scholastic",
        note: "Tag B · Vocational",
      },
      {
        code: "ART",
        nameEn: "Art Education / Painting",
        category: "scholastic",
        note: "Tag C · Art elective",
      },
      {
        code: "PEW",
        nameEn: "Health & Physical Education",
        category: "scholastic",
        note: "Tag C · PE elective",
      },
      {
        code: "ENV",
        nameEn: "Environmental Education",
        category: "scholastic",
        note: "Tag D · Mandatory module",
      },
      {
        code: "ETH",
        nameEn: "Ethics / Individual in Society",
        category: "scholastic",
        note: "Tag D · Mandatory module",
      },
    ],
  },
  {
    id: "secondary_11_12",
    label: "Senior Secondary · XI–XII",
    grades: "XI – XII",
    ages: "16–18",
    summary:
      "NCF Secondary Phase 2 / CBSE: shopping-cart enrolment — exactly 6 subjects, ≥2 languages (Tag A) with ≥1 native, free mix across Tag B skill and Tag C electives. Stream packages are counselor guidance only.",
    tips: [
      "Cart rule: exactly 6 · ≥2 Tag A · ≥1 native language · cross-group mixes allowed.",
      "Seed Languages (ENG/HIN/SKT/URDU), Skill (IT/AI/VOC), and Electives (Science / Commerce / Humanities) onto XI and XII.",
      "Soft warning when 3+ lab-heavy subjects (PHY/CHE/BIO/CT) are chosen together.",
      "Masters → Streams still sync Science/Commerce/Humanities packages for counseling — not as an enrollment gate.",
    ],
    subjects: [
      {
        code: "ENG",
        nameEn: "English Core",
        category: "scholastic",
        note: "Tag A · Foreign language",
      },
      {
        code: "HIN",
        nameEn: "Hindi Core / Elective",
        category: "scholastic",
        note: "Tag A · Native language",
      },
      {
        code: "SKT",
        nameEn: "Sanskrit",
        category: "scholastic",
        note: "Tag A · Regional / Indian language",
      },
      {
        code: "URDU",
        nameEn: "Urdu",
        category: "scholastic",
        note: "Tag A · Regional / Indian language",
      },
      {
        code: "PHY",
        nameEn: "Physics",
        category: "scholastic",
        note: "Tag C · Science",
      },
      {
        code: "CHE",
        nameEn: "Chemistry",
        category: "scholastic",
        note: "Tag C · Science",
      },
      {
        code: "BIO",
        nameEn: "Biology",
        category: "scholastic",
        note: "Tag C · Science",
      },
      {
        code: "MAT",
        nameEn: "Mathematics",
        category: "scholastic",
        note: "Tag C",
      },
      {
        code: "APP-MAT",
        nameEn: "Applied Mathematics",
        category: "scholastic",
        note: "Tag C · Commerce / Humanities friendly",
      },
      {
        code: "CT",
        nameEn: "Computer Science / Informatics Practices",
        category: "scholastic",
        note: "Tag C · Computational Thinking",
      },
      {
        code: "IT",
        nameEn: "Information Technology",
        category: "scholastic",
        note: "Tag B · Skill",
      },
      {
        code: "AI",
        nameEn: "Artificial Intelligence",
        category: "scholastic",
        note: "Tag B · Skill",
      },
      {
        code: "VOC",
        nameEn: "Vocational / Skill elective",
        category: "scholastic",
        note: "Tag B · Vocational",
      },
      {
        code: "HIS",
        nameEn: "History",
        category: "scholastic",
        note: "Tag C · Humanities",
      },
      {
        code: "GEO",
        nameEn: "Geography",
        category: "scholastic",
        note: "Tag C · Humanities",
      },
      {
        code: "POL",
        nameEn: "Political Science",
        category: "scholastic",
        note: "Tag C · Humanities",
      },
      {
        code: "ECO",
        nameEn: "Economics",
        category: "scholastic",
        note: "Tag C · Humanities / Commerce",
      },
      {
        code: "ACC",
        nameEn: "Accountancy",
        category: "scholastic",
        note: "Tag C · Commerce",
      },
      {
        code: "BST",
        nameEn: "Business Studies",
        category: "scholastic",
        note: "Tag C · Commerce",
      },
      {
        code: "PSY",
        nameEn: "Psychology",
        category: "scholastic",
        note: "Tag C · Humanities",
      },
      {
        code: "SOC",
        nameEn: "Sociology",
        category: "scholastic",
        note: "Tag C · Humanities",
      },
      {
        code: "ART",
        nameEn: "Fine Arts / Painting",
        category: "scholastic",
        note: "Tag C · Art",
      },
      {
        code: "PEW",
        nameEn: "Physical Education",
        category: "scholastic",
        note: "Tag C · PE theory + practical",
      },
      {
        code: "ENV",
        nameEn: "Environmental Education",
        category: "scholastic",
        note: "Tag D · Mandatory module",
      },
      {
        code: "ETH",
        nameEn: "Ethics / Individual in Society",
        category: "scholastic",
        note: "Tag D · Mandatory module",
      },
    ],
  },
];

export type NepGap = {
  item: NepSuggestionItem;
  status: "present" | "missing";
};

export function analyseNepPack(
  pack: NepStagePack,
  subjects: Subject[],
): { gaps: NepGap[]; missingCount: number; presentCount: number } {
  const byCode = new Map(
    subjects.map((s) => [s.code.toUpperCase(), s] as const),
  );
  const gaps: NepGap[] = pack.subjects.map((item) => ({
    item,
    status: byCode.has(item.code.toUpperCase()) ? "present" : "missing",
  }));
  const missingCount = gaps.filter((g) => g.status === "missing").length;
  const presentCount = gaps.length - missingCount;
  return { gaps, missingCount, presentCount };
}

/** Codes seeded as electives / optional student choices. */
const ELECTIVE_NEP_CODES = new Set([
  "SKT",
  "URDU",
  "VOC",
  "MUS",
  "WE",
  "ICT",
  "IT",
  "AI",
  "ENV",
  "ETH",
  "APP-MAT",
  "PSY",
  "SOC",
  "ART",
  "PEW",
]);

/** Add missing NEP-suggested subjects (and parents for components). */
export function applyNepSuggestions(
  subjects: Subject[],
  pack: NepStagePack,
  opts?: { onlyMissing?: boolean },
): { subjects: Subject[]; added: number } {
  const onlyMissing = opts?.onlyMissing !== false;
  let list = subjects.map(normalizeSubject);
  const codeIndex = () =>
    new Map(list.map((s) => [s.code.toUpperCase(), s] as const));

  let added = 0;

  const ensureTop = (item: NepSuggestionItem): Subject => {
    const map = codeIndex();
    const existing = map.get(item.code.toUpperCase());
    if (existing) return existing;
    const row = normalizeSubject({
      id: newFoundationId("sub"),
      code: item.code.toUpperCase(),
      nameEn: item.nameEn,
      category: item.category,
      coScholasticArea: item.coScholasticArea ?? "",
      parentId: null,
      isElective: ELECTIVE_NEP_CODES.has(item.code.toUpperCase()),
      isActive: true,
      sortOrder: list.filter((s) => !s.parentId).length + 1,
    });
    list = [...list, row];
    added += 1;
    return row;
  };

  // Parents first
  for (const item of pack.subjects.filter((s) => !s.underCode)) {
    const map = codeIndex();
    if (onlyMissing && map.has(item.code.toUpperCase())) continue;
    if (!map.has(item.code.toUpperCase())) ensureTop(item);
  }

  // Components
  for (const item of pack.subjects.filter((s) => s.underCode)) {
    const map = codeIndex();
    if (onlyMissing && map.has(item.code.toUpperCase())) continue;
    if (map.has(item.code.toUpperCase())) continue;

    let parent = map.get(item.underCode!.toUpperCase());
    if (!parent) {
      const parentDef = pack.subjects.find(
        (s) => s.code.toUpperCase() === item.underCode!.toUpperCase(),
      );
      parent = ensureTop(
        parentDef ?? {
          code: item.underCode!,
          nameEn: item.underCode!,
          category: item.category,
        },
      );
    }

    const row = normalizeSubject({
      id: newFoundationId("sub"),
      code: item.code.toUpperCase(),
      nameEn: item.nameEn,
      category: parent.category,
      coScholasticArea: "",
      parentId: parent.id,
      isElective: ELECTIVE_NEP_CODES.has(item.code.toUpperCase()),
      isActive: true,
      sortOrder:
        list.filter((s) => s.parentId === parent!.id).length + 1,
    });
    list = [...list, row];
    added += 1;
  }

  return { subjects: list, added };
}

export type StreamApplyResult = {
  subjects: Subject[];
  seniorStreams: SeniorStream[];
  subjectsAdded: number;
  streamsUpserted: number;
};

/** Ensure XI–XII stream subjects exist and refresh stream packages. */
export function applySeniorStreamPackages(
  subjects: Subject[],
  streams: SeniorStream[],
): StreamApplyResult {
  const xiPack = NEP_STAGE_PACKS.find((p) => p.id === "secondary_11_12")!;
  const applied = applyNepSuggestions(subjects, xiPack);
  const seed = defaultSeniorStreams();

  const byCode = new Map(
    streams.map((s) => [s.code.toUpperCase(), s] as const),
  );
  let upserted = 0;
  const next = seed.map((def) => {
    const existing = byCode.get(def.code.toUpperCase());
    if (existing) {
      upserted += 1;
      return {
        ...existing,
        nameEn: def.nameEn,
        traditionalLabel: def.traditionalLabel,
        nepNote: def.nepNote,
        coreCodes: def.coreCodes,
        electiveCodes: def.electiveCodes,
        grades: def.grades,
        sortOrder: def.sortOrder,
        // Keep school's on/off choice (e.g. Multi stays inactive unless activated)
        isActive: existing.isActive,
      };
    }
    upserted += 1;
    return def;
  });
  for (const s of streams) {
    if (!seed.some((d) => d.code.toUpperCase() === s.code.toUpperCase())) {
      next.push(s);
    }
  }

  return {
    subjects: applied.subjects,
    seniorStreams: next,
    subjectsAdded: applied.added,
    streamsUpserted: upserted,
  };
}

/**
 * Suggested periods / week by stage (indicative CBSE-style timetable).
 * NEP stresses balance of languages, STEM, arts, PE & vocational — not only
 * “main” academics. Adjust to school bell schedule (typically 40–48 periods/wk).
 */
const STAGE_PERIOD_DEFAULTS: Record<NepStage, Record<string, number>> = {
  foundational: {
    HIN: 8,
    "HIN-ORAL": 4,
    ENG: 5,
    "ENG-ORAL": 3,
    NUM: 6,
    WAU: 4,
    ART: 4,
    MUS: 3,
    PEW: 5,
    SEE: 2,
    HAB: 2,
  },
  preparatory: {
    HIN: 6,
    "HIN-ORAL": 2,
    "HIN-WRIT": 4,
    ENG: 6,
    "ENG-ORAL": 2,
    "ENG-WRIT": 4,
    MAT: 7,
    EVS: 5,
    SKT: 3,
    ART: 3,
    MUS: 2,
    PEW: 4,
    WE: 2,
  },
  middle: {
    HIN: 5,
    "HIN-ORAL": 2,
    "HIN-WRIT": 3,
    ENG: 5,
    "ENG-ORAL": 2,
    "ENG-WRIT": 3,
    SKT: 4,
    MAT: 7,
    SCI: 6,
    SST: 5,
    ENV: 2,
    ART: 2,
    MUS: 2,
    PEW: 3,
    VOC: 2,
    ICT: 2,
  },
  secondary_9_10: {
    ENG: 6,
    "ENG-ORAL": 2,
    "ENG-WRIT": 4,
    HIN: 5,
    SKT: 4,
    URDU: 4,
    MAT: 7,
    SCI: 7,
    SST: 5,
    IT: 3,
    AI: 2,
    ART: 2,
    PEW: 3,
    VOC: 2,
    ENV: 2,
    ETH: 1,
  },
  secondary_11_12: {
    ENG: 5,
    HIN: 5,
    SKT: 5,
    URDU: 5,
    PHY: 7,
    CHE: 7,
    BIO: 7,
    MAT: 7,
    "APP-MAT": 7,
    CT: 5,
    IT: 4,
    AI: 3,
    HIS: 6,
    GEO: 6,
    POL: 6,
    ECO: 6,
    ACC: 7,
    BST: 6,
    PSY: 5,
    SOC: 5,
    ART: 3,
    PEW: 3,
    VOC: 3,
    ENV: 2,
    ETH: 1,
  },
};

const CATEGORY_FALLBACK: Record<SubjectCategory, number> = {
  scholastic: 5,
  co_scholastic: 3,
};

export function suggestedPeriodsPerWeek(
  stage: NepStage,
  code: string,
  category: SubjectCategory = "scholastic",
): number {
  const key = code.toUpperCase();
  const fromStage = STAGE_PERIOD_DEFAULTS[stage]?.[key];
  if (fromStage != null) return fromStage;
  // Soft match ENG-ORAL style
  for (const [k, v] of Object.entries(STAGE_PERIOD_DEFAULTS[stage] ?? {})) {
    if (key.startsWith(k) || k.startsWith(key)) return v;
  }
  return CATEGORY_FALLBACK[category] ?? 5;
}

export function periodsForSuggestion(
  stage: NepStage,
  item: NepSuggestionItem,
): number {
  if (item.periodsPerWeek != null) return item.periodsPerWeek;
  return suggestedPeriodsPerWeek(stage, item.code, item.category);
}

/** Sum suggested periods for checklist (skip language components if parent listed). */
export function suggestedWeeklyLoad(pack: NepStagePack): {
  total: number;
  rows: { code: string; periods: number; nameEn: string }[];
} {
  const rows = pack.subjects
    .filter((s) => !s.underCode)
    .map((s) => ({
      code: s.code,
      nameEn: s.nameEn,
      periods: periodsForSuggestion(pack.id, s),
    }));
  const total = rows.reduce((a, r) => a + r.periods, 0);
  return { total, rows };
}

export function suggestedPeriodsBySubjectCode(
  stage: NepStage,
  subjects: Subject[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const s of subjects) {
    map.set(s.id, suggestedPeriodsPerWeek(stage, s.code, s.category));
  }
  return map;
}
