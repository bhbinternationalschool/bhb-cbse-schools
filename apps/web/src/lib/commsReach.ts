/**
 * Who the school can reach WITHOUT the personal class WhatsApp groups —
 * class by class (director, 8 Oct 2026: moving homework and notices off
 * personal groups). For each family of this session's children:
 *  - app: the parent app is on a phone (a push token for the household);
 *  - whatsapp: the school's own number can message a family number that is
 *    not known to be off WhatsApp (an unchecked number counts — unknown is
 *    not "unreachable");
 *  - unreachable: neither — the office calls them before a group closes.
 * Pure; the route feeds it.
 */

import { householdCandidateNumbers, pickWaNumbers } from "@/lib/waHouseholdNumbers";
import type { Household, SisStudent } from "@/lib/sis";

export type ReachFamily = {
  householdId: string;
  guardianName: string;
  children: string[];
  classKeys: string[];
  app: boolean;
  whatsapp: boolean;
  /** Confirmed on WhatsApp by Meta's check (not just "not known bad"). */
  whatsappConfirmed: boolean;
  numbers: string[];
};

export type ReachClassRow = {
  key: string;
  label: string;
  order: number;
  families: number;
  app: number;
  whatsappOnly: number;
  unreachable: number;
};

export type ReachReport = {
  totals: { families: number; app: number; whatsappOnly: number; unreachable: number; whatsappConfirmed: number };
  classes: ReachClassRow[];
  unreachable: ReachFamily[];
};

export function buildReachReport(input: {
  students: SisStudent[];
  householdOf: (id: string) => Household | undefined;
  /** Households with the parent app (push token rows). */
  appHouseholds: Set<string>;
  /** 10-digit numbers Meta said are NOT on WhatsApp. */
  notOnWhatsApp: Set<string>;
  /** 10-digit numbers Meta said ARE on WhatsApp. */
  onWhatsApp: Set<string>;
  classLabel: (s: SisStudent) => { key: string; label: string; order: number };
}): ReachReport {
  const byHousehold = new Map<string, SisStudent[]>();
  for (const s of input.students) {
    const id = s.householdId || `solo:${s.id}`;
    byHousehold.set(id, [...(byHousehold.get(id) ?? []), s]);
  }
  const families: ReachFamily[] = [];
  const rows = new Map<string, ReachClassRow>();
  for (const [hid, kids] of byHousehold) {
    const hh = hid.startsWith("solo:") ? undefined : input.householdOf(hid);
    const candidates = householdCandidateNumbers({ household: hh ?? null, students: kids });
    const choice = pickWaNumbers(candidates, input.notOnWhatsApp);
    const app = input.appHouseholds.has(hid);
    const whatsapp = choice.usable.length > 0;
    const classInfos = kids.map(input.classLabel);
    const fam: ReachFamily = {
      householdId: hid,
      guardianName: hh?.guardianName || kids[0]?.fatherName || kids[0]?.motherName || "",
      children: kids.map((k) => k.fullName),
      classKeys: [...new Set(classInfos.map((c) => c.key))],
      app,
      whatsapp,
      whatsappConfirmed: choice.usable.some((c) => input.onWhatsApp.has(c.mobile10)),
      numbers: candidates.map((c) => c.mobile10),
    };
    families.push(fam);
    // A family with children in two classes counts in both classes' rows.
    for (const c of classInfos.filter((x, i, a) => a.findIndex((y) => y.key === x.key) === i)) {
      const r = rows.get(c.key) ?? { key: c.key, label: c.label, order: c.order, families: 0, app: 0, whatsappOnly: 0, unreachable: 0 };
      r.families += 1;
      if (app) r.app += 1;
      else if (whatsapp) r.whatsappOnly += 1;
      else r.unreachable += 1;
      rows.set(c.key, r);
    }
  }
  const unreachable = families.filter((f) => !f.app && !f.whatsapp);
  return {
    totals: {
      families: families.length,
      app: families.filter((f) => f.app).length,
      whatsappOnly: families.filter((f) => !f.app && f.whatsapp).length,
      unreachable: unreachable.length,
      whatsappConfirmed: families.filter((f) => f.whatsappConfirmed).length,
    },
    classes: [...rows.values()].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label)),
    unreachable,
  };
}
