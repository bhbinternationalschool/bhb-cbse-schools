/**
 * Compliance facts — the school-level figures CBSE MPD / affiliation /
 * inspection formats ask for that no other module holds: infrastructure,
 * safety certificates, teacher-training log, committees. Entered by the
 * office; feeds the compliance-narrative preset in the Document maker.
 * Persisted through module_local_state ("compliance_facts").
 */

import { writeCacheOrInvalidate } from "@/lib/browserStorage";
import { assertModulePermission } from "@/lib/rbacGuard";

export type ComplianceInfra = {
  classrooms: number;
  labs: { physics: boolean; chemistry: boolean; biology: boolean; computer: boolean; maths: boolean; composite: boolean };
  libraryBooks: number;
  libraryComputers: number;
  playgroundSqm: number;
  toiletsBoys: number;
  toiletsGirls: number;
  toiletsCwsn: number;
  drinkingWater: string;
  rampsAndRails: boolean;
  cctvCameras: number;
  medicalRoom: boolean;
  counsellorAvailable: boolean;
  transportVehicles: number;
  /** YYYY-MM-DD; "" = not on record */
  fireNocValidTill: string;
  buildingSafetyValidTill: string;
  healthSanitationValidTill: string;
  drinkingWaterTestValidTill: string;
  note: string;
};

export type TrainingLogEntry = {
  id: string;
  date: string;
  title: string;
  provider: string;
  hours: number;
  participants: number;
  /** Names / departments as free text */
  who: string;
  note: string;
};

export type CommitteeEntry = {
  id: string;
  name: string;
  members: string;
  lastMeetingOn: string;
  note: string;
};

export type ComplianceFactsState = {
  version: 1;
  infra: ComplianceInfra;
  trainings: TrainingLogEntry[];
  committees: CommitteeEntry[];
  updatedAt: string;
};

const STORAGE_KEY = "bhb_compliance_facts_v1";

function nid(p: string) {
  return `${p}_${Math.random().toString(36).slice(2, 10)}`;
}
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, v) : Number(v) > 0 ? Number(v) : 0);
const str = (v: unknown, max = 300) => String(v ?? "").trim().slice(0, max);
const date = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? "")) ? String(v) : "");

export function emptyComplianceFacts(): ComplianceFactsState {
  return {
    version: 1,
    infra: {
      classrooms: 0,
      labs: { physics: false, chemistry: false, biology: false, computer: false, maths: false, composite: false },
      libraryBooks: 0,
      libraryComputers: 0,
      playgroundSqm: 0,
      toiletsBoys: 0,
      toiletsGirls: 0,
      toiletsCwsn: 0,
      drinkingWater: "",
      rampsAndRails: false,
      cctvCameras: 0,
      medicalRoom: false,
      counsellorAvailable: false,
      transportVehicles: 0,
      fireNocValidTill: "",
      buildingSafetyValidTill: "",
      healthSanitationValidTill: "",
      drinkingWaterTestValidTill: "",
      note: "",
    },
    trainings: [],
    committees: [],
    updatedAt: "",
  };
}

export function normalizeComplianceFacts(raw: unknown): ComplianceFactsState {
  const d = emptyComplianceFacts();
  if (!raw || typeof raw !== "object") return d;
  const r = raw as Partial<ComplianceFactsState>;
  const i = (r.infra ?? {}) as Partial<ComplianceInfra>;
  const labs = (i.labs ?? {}) as Partial<ComplianceInfra["labs"]>;
  return {
    version: 1,
    infra: {
      classrooms: num(i.classrooms),
      labs: {
        physics: !!labs.physics,
        chemistry: !!labs.chemistry,
        biology: !!labs.biology,
        computer: !!labs.computer,
        maths: !!labs.maths,
        composite: !!labs.composite,
      },
      libraryBooks: num(i.libraryBooks),
      libraryComputers: num(i.libraryComputers),
      playgroundSqm: num(i.playgroundSqm),
      toiletsBoys: num(i.toiletsBoys),
      toiletsGirls: num(i.toiletsGirls),
      toiletsCwsn: num(i.toiletsCwsn),
      drinkingWater: str(i.drinkingWater, 120),
      rampsAndRails: !!i.rampsAndRails,
      cctvCameras: num(i.cctvCameras),
      medicalRoom: !!i.medicalRoom,
      counsellorAvailable: !!i.counsellorAvailable,
      transportVehicles: num(i.transportVehicles),
      fireNocValidTill: date(i.fireNocValidTill),
      buildingSafetyValidTill: date(i.buildingSafetyValidTill),
      healthSanitationValidTill: date(i.healthSanitationValidTill),
      drinkingWaterTestValidTill: date(i.drinkingWaterTestValidTill),
      note: str(i.note, 1000),
    },
    trainings: Array.isArray(r.trainings)
      ? r.trainings
          .map((t) => {
            const x = (t ?? {}) as Partial<TrainingLogEntry>;
            const title = str(x.title, 160);
            if (!title) return null;
            return {
              id: x.id || nid("trn"),
              date: date(x.date),
              title,
              provider: str(x.provider, 120),
              hours: num(x.hours),
              participants: Math.floor(num(x.participants)),
              who: str(x.who, 400),
              note: str(x.note, 400),
            };
          })
          .filter((t): t is TrainingLogEntry => !!t)
          .sort((a, b) => b.date.localeCompare(a.date))
      : [],
    committees: Array.isArray(r.committees)
      ? r.committees
          .map((c) => {
            const x = (c ?? {}) as Partial<CommitteeEntry>;
            const name = str(x.name, 120);
            if (!name) return null;
            return { id: x.id || nid("cmt"), name, members: str(x.members, 600), lastMeetingOn: date(x.lastMeetingOn), note: str(x.note, 400) };
          })
          .filter((c): c is CommitteeEntry => !!c)
      : [],
    updatedAt: str(r.updatedAt, 40),
  };
}

export function loadComplianceFacts(): ComplianceFactsState {
  if (typeof window === "undefined") return emptyComplianceFacts();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeComplianceFacts(JSON.parse(raw)) : emptyComplianceFacts();
  } catch {
    return emptyComplianceFacts();
  }
}

export function saveComplianceFacts(state: ComplianceFactsState): ComplianceFactsState {
  const next = normalizeComplianceFacts({ ...state, updatedAt: new Date().toISOString() });
  if (!assertModulePermission("compliance", "edit", "saveComplianceFacts")) return next;
  if (typeof window !== "undefined") {
    writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify(next));
    void import("@/lib/localModulesPersistence").then((m) => m.scheduleModuleStateSync("compliance_facts", next));
    window.dispatchEvent(new CustomEvent("bhb-compliance-facts"));
  }
  return next;
}

/** Hydrate path (module_local_state) — cache write only, no RBAC, no push. */
export function writeComplianceFactsLocalRaw(state: ComplianceFactsState): void {
  if (typeof window === "undefined") return;
  try {
    writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify(normalizeComplianceFacts(state)));
  } catch {
    /* quota */
  }
  window.dispatchEvent(new CustomEvent("bhb-compliance-facts"));
}

export function complianceFactsIsEmpty(s: ComplianceFactsState): boolean {
  return !s.updatedAt && s.trainings.length === 0 && s.committees.length === 0;
}

/** Facts text for the compliance narrative — only what has been entered. */
export function complianceFactsToText(s: ComplianceFactsState, academicYearCode: string): string {
  const L: string[] = [];
  const i = s.infra;
  const labs = Object.entries(i.labs).filter(([, v]) => v).map(([k]) => k);
  const infraBits: string[] = [];
  if (i.classrooms) infraBits.push(`${i.classrooms} classrooms`);
  if (labs.length) infraBits.push(`labs: ${labs.join(", ")}`);
  if (i.libraryBooks) infraBits.push(`library with ${i.libraryBooks} books${i.libraryComputers ? ` and ${i.libraryComputers} computers` : ""}`);
  if (i.playgroundSqm) infraBits.push(`playground ${i.playgroundSqm} sq m`);
  if (i.toiletsBoys || i.toiletsGirls) infraBits.push(`toilets: ${i.toiletsBoys} boys, ${i.toiletsGirls} girls${i.toiletsCwsn ? `, ${i.toiletsCwsn} CWSN` : ""}`);
  if (i.drinkingWater) infraBits.push(`drinking water: ${i.drinkingWater}`);
  if (i.rampsAndRails) infraBits.push("ramps and railings for CWSN");
  if (i.cctvCameras) infraBits.push(`${i.cctvCameras} CCTV cameras`);
  if (i.medicalRoom) infraBits.push("medical room");
  if (i.counsellorAvailable) infraBits.push("counsellor available");
  if (i.transportVehicles) infraBits.push(`${i.transportVehicles} school vehicles`);
  if (infraBits.length) L.push(`Infrastructure: ${infraBits.join("; ")}.`);
  const certs: string[] = [];
  if (i.fireNocValidTill) certs.push(`Fire NOC valid till ${i.fireNocValidTill}`);
  if (i.buildingSafetyValidTill) certs.push(`Building safety certificate valid till ${i.buildingSafetyValidTill}`);
  if (i.healthSanitationValidTill) certs.push(`Health & sanitation certificate valid till ${i.healthSanitationValidTill}`);
  if (i.drinkingWaterTestValidTill) certs.push(`Drinking water test valid till ${i.drinkingWaterTestValidTill}`);
  if (certs.length) L.push(`Safety certificates: ${certs.join("; ")}.`);
  if (i.note) L.push(`Infrastructure note: ${i.note}`);
  const trainings = s.trainings.filter((t) => !academicYearCode || !t.date || t.date >= `${academicYearCode.slice(0, 4)}-04-01`);
  if (trainings.length) {
    const hours = trainings.reduce((a, t) => a + t.hours, 0);
    const people = trainings.reduce((a, t) => a + t.participants, 0);
    L.push(`Teacher training: ${trainings.length} programme${trainings.length === 1 ? "" : "s"}, ${hours} hours, ${people} participant-seats:`);
    for (const t of trainings.slice(0, 12)) L.push(`- ${t.date || "date n/a"} · ${t.title}${t.provider ? ` (${t.provider})` : ""} · ${t.hours} h · ${t.participants} participants${t.who ? ` · ${t.who}` : ""}`);
  }
  if (s.committees.length) {
    L.push("Committees:");
    for (const c of s.committees) L.push(`- ${c.name}${c.members ? `: ${c.members}` : ""}${c.lastMeetingOn ? ` · last met ${c.lastMeetingOn}` : ""}`);
  }
  return L.join("\n");
}
