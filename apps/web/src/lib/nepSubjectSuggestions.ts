/**
 * NEP 2020 + NCF-FS / NCF-SE + CBSE (incl. Jadui Pitara / Balvatika) subject
 * suggestions for Masters. Pre-Primary also mirrors UP Basic Shiksha School
 * Readiness (भाषा · अंकीय दक्षता · पर्यावरण). Codes are practical ERP seeds.
 *
 * CBSE 2026-27 (read 30 Sep 2026 from cbseacademic.nic.in; copies in the
 * school Drive, "BHB International — Documents / CBSE Curriculum 2026-27"):
 *   - Scheme of Studies IX–X (Curriculum_SecP1_2026-27): R1 + R2 + R3 (R3
 *     compulsory from Class VI & IX in 2026-27, school-assessed, qualifying;
 *     two of the three native Indian), Maths & Science Standard with an
 *     optional Advanced paper (Basic discontinued), Social Science,
 *     Individuals in Society (IX), Environmental Education (X, 2027-28),
 *     Art Education, PE & Well-being, Vocational Education, CT & AI modules.
 *   - Scheme of Studies XI–XII (Curriculum_SecP2_2026-27): Hindi or English
 *     as Subject 1, four more from Group L / A / S, optional 6th, plus HPE,
 *     Work Experience and General Studies internally assessed.
 *   - CT & AI framework, Classes 3–8 (CTAI_Pri_2026-27): III–V 50 h/yr inside
 *     Mathematics & TWAU; VI–VIII 100 h/yr of projects and AI literacy.
 *   - Skill Education with NCERT Kaushal Bodh mandatory in VI–VIII from
 *     2025-26 (CBSE Circular Skill-81/2025; notifications 116/2025, 126/2026).
 * The weekly DIKSHA list (ncfOfficial.ts) flags later changes; this file is
 * what a person read and decided.
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
      "CBSE 2026-27: Computational Thinking from Class III — about 50 hours a year inside Mathematics and The World Around Us (no separate subject or period).",
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
        note: "NCF Preparatory The World Around Us (TWAU) · UP हमारा परिवेश (III–V); integrated science & social · carries CBSE's CT activities with Mathematics",
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
      "NCF Middle: three languages (R1–R3, ≥2 Indian), Mathematics, Science, Social Science, Art, PE & Well-being, Skill Education. CBSE: R3 compulsory from Class VI (2026-27); Skill Education with Kaushal Bodh mandatory (2025-26); CT & AI about 100 hours a year. UP Basic upper primary adds Environmental Studies, Sanskrit/Urdu, craft/agriculture/home science, games & scouting.",
    tips: [
      "Three languages are compulsory from Class VI in 2026-27 (CBSE): Hindi + English + Sanskrit (or Urdu) is the common UP pattern; two must be native Indian languages. R3 is designed for 2–3 periods a week.",
      "Science and Social Science become separate subjects (NCF); subject teachers introduced.",
      "Skill Education is mandatory in VI–VIII (CBSE Circular Skill-81/2025) using NCERT's Kaushal Bodh activity books — work with life forms, machines & materials, and human services.",
      "CT & AI (CBSE framework 2026-27): about 100 hours a year of worksheets, interdisciplinary projects and AI literacy, assessed through projects, journals and presentations.",
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
        note: "Third language (R3), compulsory from Class VI in 2026-27 (CBSE) · UP Sanskrit/Urdu · 2–3 periods a week",
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
        nameEn: "Skill Education (Kaushal Bodh)",
        category: "co_scholastic",
        coScholasticArea: "Vocational",
        note: "Mandatory in VI–VIII from 2025-26 (CBSE Circular Skill-81/2025) · NCERT Kaushal Bodh activity books · UP बेसिक क्राफ्ट / कृषि / गृह शिल्प",
      },
      {
        code: "ICT",
        nameEn: "Computational Thinking & AI",
        category: "scholastic",
        note: "CBSE 2026-27: about 100 h/yr — advanced CT, data, AI literacy through projects across subjects; assessed by projects, journals, presentations",
      },
    ],
  },
  {
    id: "secondary_9_10",
    label: "Secondary · IX–X",
    grades: "IX – X",
    ages: "14–16",
    summary:
      "CBSE Scheme of Studies 2026-27 (Class IX): Language 1 (R1) + Language 2 (R2) + Mathematics + Science + Social Science with annual exams; Language 3 (R3), Individuals in Society, Art Education, PE & Well-being, Vocational Education and an optional subject assessed in school; CT & AI as modules. Class X keeps the old scheme in 2026-27 and moves over in 2027-28.",
    tips: [
      "Three languages: R1 + R2 examined; R3 compulsory from Class IX in 2026-27 (Class VI-level R3 textbook + one local literary text), assessed in school, graded Qualified / Not Qualified — no pass certificate without it. Two of the three must be native Indian languages.",
      "Mathematics and Science: one Standard course for everyone (80 marks + 20 internal). Advanced is an optional extra 25-mark, 1-hour paper, not added to the total. Mathematics Basic is discontinued from 2026-27 (Class X of 2026-27 may still take it).",
      "Interdisciplinary: Individuals in Society in Class IX (2026-27), Environmental Education in Class X (2027-28), as NCERT books arrive.",
      "Board exam subjects: 7 in 2027 (5 compulsory + 2 optional) → 8 in 2029. CT & AI becomes a compulsory subject in 2027-28.",
      "A student failing Science, Mathematics or Social Science can have it replaced by the optional (11th) subject — only if the three languages are cleared.",
    ],
    subjects: [
      {
        code: "HIN",
        nameEn: "Hindi (R1 / R2)",
        category: "scholastic",
        note: "Native Indian language · Course A or B in Class X of 2026-27 · annual exam + internal",
      },
      {
        code: "ENG",
        nameEn: "English Language & Literature (R1 / R2)",
        category: "scholastic",
        note: "Annual exam + internal (Assessment of Speaking & Listening)",
      },
      {
        code: "ENG-ORAL",
        nameEn: "English — Speaking & Listening",
        category: "scholastic",
        underCode: "ENG",
        note: "Internal assessment",
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
        note: "Third language, compulsory from Class IX in 2026-27 · school-assessed, Qualified / Not Qualified · 2–3 periods a week",
      },
      {
        code: "URDU",
        nameEn: "Urdu (R3 option)",
        category: "scholastic",
        note: "Alternative native Indian third language",
      },
      {
        code: "MAT",
        nameEn: "Mathematics (Standard; Advanced optional)",
        category: "scholastic",
        note: "80 marks (3 h) + 20 internal · Advanced: optional extra 25-mark paper, not added to the total · Basic discontinued from 2026-27",
      },
      {
        code: "SCI",
        nameEn: "Science (Standard; Advanced optional)",
        category: "scholastic",
        note: "80 marks (3 h) + 20 internal · Advanced: optional extra 25-mark paper, not added to the total",
      },
      {
        code: "SST",
        nameEn: "Social Science",
        category: "scholastic",
        note: "History, Geography, Political Science, Economics · annual exam + internal",
      },
      {
        code: "ETH",
        nameEn: "Individuals in Society",
        category: "scholastic",
        note: "Interdisciplinary, compulsory · Class IX from 2026-27 as NCERT books arrive · school-assessed",
      },
      {
        code: "ENV",
        nameEn: "Environmental Education",
        category: "scholastic",
        note: "Interdisciplinary, compulsory · Class X from 2027-28 · school-assessed",
      },
      {
        code: "VOC",
        nameEn: "Vocational Education (Kaushal Vikas)",
        category: "scholastic",
        note: "Compulsory · school-based internal + annual exam · continues Kaushal Bodh projects",
      },
      {
        code: "ICT",
        nameEn: "Computational Thinking & AI",
        category: "scholastic",
        note: "Modules from NCERT; compulsory subject from 2027-28",
      },
      {
        code: "ART",
        nameEn: "Art Education",
        category: "scholastic",
        note: "Compulsory · school-based internal assessment (theory + practical)",
      },
      {
        code: "PEW",
        nameEn: "Physical Education & Well-being",
        category: "scholastic",
        note: "Compulsory · school-based · Health & PE and Work Experience are subsumed in it",
      },
      {
        code: "IT",
        nameEn: "Information Technology (402)",
        category: "scholastic",
        note: "Optional skill subject",
      },
      {
        code: "AI",
        nameEn: "Artificial Intelligence (417)",
        category: "scholastic",
        note: "Optional skill subject",
      },
    ],
  },
  {
    id: "secondary_11_12",
    label: "Senior Secondary · XI–XII",
    grades: "XI – XII",
    ages: "16–18",
    summary:
      "CBSE Scheme of Studies 2026-27 (XI–XII): Subject 1 is Hindi or English (Core or Elective); Subjects 2–5 are a language (Group L) or electives (Group A academic, Group S skill); a 6th subject is optional. Health & Physical Education, Work Experience and General Studies are taken by all and assessed in school. Stream packages are counselling guidance only.",
    tips: [
      "Hindi or English must be one of the languages; the same language cannot be taken at both Core and Elective level. A second language is not compulsory — Subject 2 may be an academic elective.",
      "Not together: Mathematics (041) with Applied Mathematics (241); Business Studies (054) with Business Administration (833); only one of Informatics Practices (065), Computer Science (083), Information Technology (802).",
      "If one of the first five subjects is failed, the 6th replaces it — provided Hindi or English stays among the five.",
      "Class XII is graded on a 9-point scale (A-1…E); Class XI is assessed by the school on the same pattern.",
      "Masters → Streams still syncs Science / Commerce / Humanities packages for counselling — not as an enrolment gate.",
    ],
    subjects: [
      {
        code: "ENG",
        nameEn: "English Core (301) / Elective (001)",
        category: "scholastic",
        note: "Subject 1 option · 80 + 20 internal",
      },
      {
        code: "HIN",
        nameEn: "Hindi Core (302) / Elective (002)",
        category: "scholastic",
        note: "Subject 1 option · 80 + 20 internal",
      },
      {
        code: "SKT",
        nameEn: "Sanskrit Elective (022)",
        category: "scholastic",
        note: "Group L language",
      },
      {
        code: "URDU",
        nameEn: "Urdu Core (303) / Elective (003)",
        category: "scholastic",
        note: "Group L language",
      },
      {
        code: "PHY",
        nameEn: "Physics (042)",
        category: "scholastic",
        note: "Group A · 70 theory + 30 practical",
      },
      {
        code: "CHE",
        nameEn: "Chemistry (043)",
        category: "scholastic",
        note: "Group A · 70 theory + 30 practical",
      },
      {
        code: "BIO",
        nameEn: "Biology (044)",
        category: "scholastic",
        note: "Group A · 70 theory + 30 practical",
      },
      {
        code: "MAT",
        nameEn: "Mathematics (041)",
        category: "scholastic",
        note: "Group A · not with Applied Mathematics",
      },
      {
        code: "APP-MAT",
        nameEn: "Applied Mathematics (241)",
        category: "scholastic",
        note: "Group A · not with Mathematics · commerce / humanities friendly",
      },
      {
        code: "CT",
        nameEn: "Computer Science (083) / Informatics Practices (065)",
        category: "scholastic",
        note: "Group A · only one of CS, IP or IT (802)",
      },
      {
        code: "IT",
        nameEn: "Information Technology (802)",
        category: "scholastic",
        note: "Group S skill · 60 + 40 practical · not with CS or IP",
      },
      {
        code: "AI",
        nameEn: "Artificial Intelligence (843)",
        category: "scholastic",
        note: "Group S skill · 50 + 50 practical",
      },
      {
        code: "VOC",
        nameEn: "Skill elective (Group S)",
        category: "scholastic",
        note: "Retail, Tourism, Financial Markets, Beauty & Wellness, Agriculture… · 60 + 40",
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
        nameEn: "Physical Education (048)",
        category: "scholastic",
        note: "Group A elective · 70 + 30 practical (separate from the compulsory HPE)",
      },
      {
        code: "WE",
        nameEn: "Work Experience",
        category: "co_scholastic",
        coScholasticArea: "Work Experience",
        note: "Compulsory for all regular students · school-assessed",
      },
      {
        code: "GS",
        nameEn: "General Studies",
        category: "co_scholastic",
        coScholasticArea: "General Studies",
        note: "Compulsory for all regular students · school-assessed",
      },
      {
        code: "HPE",
        nameEn: "Health & Physical Education",
        category: "co_scholastic",
        coScholasticArea: "HPE",
        note: "Compulsory for all regular students · school-assessed",
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
// Choice subjects. VOC, WE, ICT (CT & AI), ENV and ETH (Individuals in
// Society) were here until CBSE's 2026-27 scheme made them compulsory.
const ELECTIVE_NEP_CODES = new Set([
  "SKT",
  "URDU",
  "MUS",
  "IT",
  "AI",
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
    SKT: 3,
    MAT: 7,
    SCI: 6,
    SST: 5,
    ENV: 2,
    ART: 2,
    MUS: 2,
    PEW: 3,
    VOC: 2,
    ICT: 3,
  },
  secondary_9_10: {
    ENG: 6,
    "ENG-ORAL": 2,
    "ENG-WRIT": 4,
    HIN: 5,
    SKT: 3,
    URDU: 3,
    MAT: 7,
    SCI: 7,
    SST: 5,
    IT: 3,
    AI: 2,
    ICT: 2,
    ART: 2,
    PEW: 3,
    VOC: 2,
    ENV: 2,
    ETH: 2,
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
    WE: 2,
    GS: 1,
    HPE: 2,
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
