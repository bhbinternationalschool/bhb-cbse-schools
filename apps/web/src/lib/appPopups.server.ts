import { aadhaarChecksumValid, aadhaarDigits } from "@/lib/aadhaar";
import { apaarConsentPending } from "@/lib/apaarConsent";
import { fileConsentRecord } from "@/lib/apaarConsent.server";
import {
  aadhaarInScope,
  childrenOnRoll,
  countAadhaarGaps,
  type AadhaarGapCounts,
  normalizeAppPopupsState,
  popupApplies,
  type AppPopup,
  type AppPopupAudience,
  type AppPopupsState,
  type PopupEvent,
  type RuleFacts,
} from "@/lib/appPopups";
import { aadhaarSlot, popupOutcome, sortResponses, type ResponseRow } from "@/lib/appPopupResponses";
import { writeAudit } from "@/lib/audit.server";
import { loadMasters } from "@/lib/masters";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { fetchAllPages } from "@/lib/supabase/pageAll";
import { readModuleLocalState, writeModuleLocalState } from "@/lib/moduleLocalState.server";
import { REQUIRED_STUDENT_DOCS } from "@/lib/parentProfile";
import { getServerTenantContext } from "@/lib/serverTenant";
import { docHasFile, hasStoredAadhaar, loadSis, loadSisForStaff, type SisStudent } from "@/lib/sis";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { pushSisToDb, rowToStudent } from "@/lib/sisNormalized.server";

/**
 * Server side of app pop-ups (lib/appPopups): who should see which pop-up,
 * and saving what a family answers — Aadhaar numbers onto the children's
 * records, an APAAR consent the same way WhatsApp records it, and the
 * shown/dismissed/done events in app_popup_events.
 */

export { childrenOnRoll };

export async function readAppPopups(): Promise<AppPopupsState | null> {
  const row = await readModuleLocalState<unknown>("app_popups");
  return row ? normalizeAppPopupsState(row.state) : null;
}

export async function writeAppPopups(state: AppPopupsState): Promise<{ ok: boolean; error?: string }> {
  const w = await writeModuleLocalState("app_popups", state);
  return w.ok ? { ok: true } : { ok: false, error: w.error };
}

/** The family's children who are on roll, one row each (see childrenOnRoll). */
export async function householdChildren(householdId: string, sessionAy: string): Promise<SisStudent[]> {
  await ensureSisHydratedServer();
  return childrenOnRoll(
    loadSis().students.filter((s) => s.householdId === householdId),
    sessionAy,
  );
}

export function missingDocKeys(s: SisStudent): string[] {
  return REQUIRED_STUDENT_DOCS.filter((k) => {
    const d = s.docs?.[k];
    return !d || !docHasFile(d) || d.status === "missing" || d.status === "rejected";
  });
}

/** What the rules see for this family now. */
export function familyFacts(children: SisStudent[], customConsentKeys: string[]): RuleFacts {
  const missingAadhaar: string[] = [];
  for (const c of children) {
    if (!hasStoredAadhaar({ number: c.aadhaarNumber, last4: c.aadhaarLast4 })) missingAadhaar.push(c.id);
  }
  // A parent's number is on every child's record; any one of them counts.
  if (children.length && !children.some((c) => hasStoredAadhaar({ number: c.fatherAadhaarNumber, last4: c.fatherAadhaarLast4 }))) {
    missingAadhaar.push("father");
  }
  if (children.length && !children.some((c) => hasStoredAadhaar({ number: c.motherAadhaarNumber, last4: c.motherAadhaarLast4 }))) {
    missingAadhaar.push("mother");
  }
  return {
    missingDocs: children.filter((c) => missingDocKeys(c).length > 0).map((c) => c.id),
    missingAadhaar,
    // A consent of the school's own is "pending" until this family answers
    // its pop-up (the done event); APAAR is pending by the children's records.
    pendingConsents: [...(apaarConsentPending(children).length ? ["apaar"] : []), ...customConsentKeys.filter((k) => k !== "apaar")],
  };
}

/**
 * Aadhaar gaps across the school, one row per child of this session (most
 * children carry a row per academic year — counting rows would count them
 * twice), the Play review family left out.
 */
export async function schoolAadhaarGaps(sessionAy: string): Promise<AadhaarGapCounts> {
  // Hydrate once and group in memory. Asking householdChildren per family
  // re-checked the store with the database every time — ~160 round trips,
  // and the App pop-ups page took 45–70 s to open (10–11 Oct 2026).
  await ensureSisHydratedServer();
  const visible = loadSisForStaff().students.filter((s) => s.status === "active" && s.householdId);
  const visibleIds = new Set(visible.map((s) => s.id));
  const families = new Set(visible.map((s) => s.householdId));
  const kidsOf = new Map<string, SisStudent[]>();
  for (const k of childrenOnRoll(loadSis().students.filter((s) => families.has(s.householdId)), sessionAy)) {
    if (!visibleIds.has(k.id)) continue;
    kidsOf.set(k.householdId, [...(kidsOf.get(k.householdId) ?? []), k]);
  }
  const rows: { children: number; missing: string[] }[] = [];
  for (const hh of families) {
    const kids = kidsOf.get(hh) ?? [];
    rows.push({ children: kids.length, missing: familyFacts(kids, []).missingAadhaar });
  }
  return countAadhaarGaps(rows);
}

export async function readPopupEvents(subjectKey: string): Promise<PopupEvent[] | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const { data, error } = await ctx.sb
    .from("app_popup_events")
    .select("popup_id, event, created_at")
    .eq("tenant_id", ctx.tenantId)
    .eq("subject_key", subjectKey)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) return null;
  return (data ?? []).map((r) => ({
    popupId: String(r.popup_id),
    event: r.event as PopupEvent["event"],
    // IST day, so "once a day" turns over at Indian midnight.
    createdAt: new Date(new Date(String(r.created_at)).getTime() + 330 * 60_000).toISOString(),
  }));
}

export async function recordPopupEvent(
  popupId: string,
  subjectKey: string,
  event: PopupEvent["event"],
  value: Record<string, unknown> = {},
): Promise<boolean> {
  const ctx = await getServerTenantContext();
  if (!ctx) return false;
  const { error } = await ctx.sb.from("app_popup_events").insert({ tenant_id: ctx.tenantId, popup_id: popupId, subject_key: subjectKey, event, value });
  if (error) console.warn("[app-popups] event not recorded", popupId, event, error.message);
  return !error;
}

export type PopupForApp = Pick<
  AppPopup,
  "id" | "title" | "titleHi" | "body" | "bodyHi" | "imageUrl" | "form" | "consentText" | "consentTextHi" | "ctaLabel" | "ctaRoute"
> & { targets: { key: string; label: string; labelHi: string }[] };

/** The pop-ups this person should see now, newest first, with whom each one is about. */
export function popupsFor(
  state: AppPopupsState,
  who: { audience: AppPopupAudience; children: SisStudent[]; today: string },
  events: PopupEvent[],
): PopupForApp[] {
  const customKeys = state.popups.filter((p) => p.form === "consent" && p.consentKey && p.consentKey !== "apaar").map((p) => p.consentKey);
  const facts = who.audience === "parents" ? familyFacts(who.children, customKeys) : { missingDocs: [], missingAadhaar: [], pendingConsents: customKeys };
  const classIds = who.children.map((c) => c.classId).filter(Boolean);
  const name = (id: string) => who.children.find((c) => c.id === id)?.fullName || "Child";
  return [...state.popups]
    .sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt))
    .filter((p) => popupApplies(p, { audience: who.audience, classIds, facts, today: who.today }, events))
    .map((p) => {
      let targets: PopupForApp["targets"] = [];
      if (p.form === "aadhaar") {
        targets = aadhaarInScope(facts.missingAadhaar, p.aadhaarScope).map((k) =>
          k === "father"
            ? { key: k, label: "Father", labelHi: "पिता" }
            : k === "mother"
              ? { key: k, label: "Mother", labelHi: "माता" }
              : { key: k, label: name(k), labelHi: name(k) },
        );
      } else if (p.form === "documents") {
        targets = facts.missingDocs.map((k) => ({ key: k, label: name(k), labelHi: name(k) }));
      }
      return {
        id: p.id,
        title: p.title,
        titleHi: p.titleHi,
        body: p.body,
        bodyHi: p.bodyHi,
        imageUrl: p.imageUrl,
        form: p.form,
        consentText: p.consentText,
        consentTextHi: p.consentTextHi,
        ctaLabel: p.ctaLabel,
        ctaRoute: p.ctaRoute,
        targets,
      };
    })
    // An Aadhaar or documents form with nobody missing has nothing to ask.
    .filter((p) => (p.form === "aadhaar" || p.form === "documents" ? p.targets.length > 0 : true));
}

export async function saveStudent(
  studentId: string,
  change: (s: SisStudent) => SisStudent,
): Promise<{ ok: true; before: SisStudent; after: SisStudent } | { ok: false }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false };
  // The stored row, not the cached copy: its version is what the guarded
  // push checks, so a stale copy is refused rather than written over.
  const { data } = await ctx.sb.from("sis_students").select("*").eq("tenant_id", ctx.tenantId).eq("id", studentId).maybeSingle();
  if (!data) return { ok: false };
  const before = rowToStudent(data as Parameters<typeof rowToStudent>[0]);
  const after = change(before);
  const push = await pushSisToDb({ households: [], students: [after] });
  if (!push.ok || push.studentCount < 1) return { ok: false };
  return { ok: true, before, after };
}

/**
 * Aadhaar numbers a family typed: the child's onto that child; the father's
 * and mother's onto every child of theirs (where the ERP keeps them).
 *
 * Fills gaps, and lets the family CORRECT a number that is on the record but
 * not yet verified by the school (status "received" or blank) — 12 Oct 2026:
 * a mistyped number used to be locked in, the pop-up stopped asking for it
 * and a re-entry was silently ignored while the app said "saved". A number
 * the office has verified for UDISE+ ("verified_udise") is never replaced
 * from the app; the family is told to contact the office instead.
 */
export type AadhaarSaveOutcome = { key: string; who: string; status: "saved" | "corrected" | "unchanged" | "kept_verified"; last4: string };

export async function saveFamilyAadhaar(
  children: SisStudent[],
  numbers: Record<string, string>,
  by: string,
): Promise<{ ok: true; saved: string[]; outcomes: AadhaarSaveOutcome[] } | { ok: false; error: string }> {
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(numbers)) {
    const n = aadhaarDigits(v);
    if (!n) continue;
    if (!aadhaarChecksumValid(n)) return { ok: false, error: "One of the Aadhaar numbers is not valid — please check the 12 digits." };
    if (k !== "father" && k !== "mother" && !children.some((c) => c.id === k)) continue;
    clean[k] = n;
  }
  if (!Object.keys(clean).length) return { ok: false, error: "No Aadhaar number to save." };

  const outcomes = new Map<string, AadhaarSaveOutcome>();
  const note = (key: string, who: string, status: AadhaarSaveOutcome["status"], n: string) => {
    // A person shared by several children (a parent) reports its strongest result once.
    const rank = { kept_verified: 3, corrected: 2, saved: 1, unchanged: 0 } as const;
    const prev = outcomes.get(key);
    if (!prev || rank[status] > rank[prev.status]) outcomes.set(key, { key, who, status, last4: n.slice(-4) });
  };
  /** What to do with one Aadhaar field: write it, or why not. */
  const decide = (stored: { number?: string; last4?: string; verification?: string }, incoming: string) => {
    const has = hasStoredAadhaar({ number: stored.number, last4: stored.last4 });
    if (!has) return "saved" as const;
    const same = (stored.number || "").replace(/\D/g, "") === incoming;
    if (same) return "unchanged" as const;
    if (stored.verification === "verified_udise") return "kept_verified" as const;
    return "corrected" as const;
  };

  const saved: string[] = [];
  for (const child of children) {
    const own = clean[child.id];
    const father = clean.father;
    const mother = clean.mother;
    if (!own && !father && !mother) continue;
    const r = await saveStudent(child.id, (s) => {
      const next: SisStudent = { ...s };
      if (own) {
        const d = decide({ number: s.aadhaarNumber, last4: s.aadhaarLast4, verification: s.aadhaarVerification }, own);
        note(child.id, child.fullName, d, own);
        if (d === "saved" || d === "corrected") {
          next.aadhaarNumber = own;
          next.aadhaarLast4 = own.slice(-4);
          next.aadhaarVerification = "received";
        }
      }
      if (father) {
        const d = decide({ number: s.fatherAadhaarNumber, last4: s.fatherAadhaarLast4, verification: s.fatherAadhaarVerification }, father);
        note("father", "Father", d, father);
        if (d === "saved" || d === "corrected") {
          next.fatherAadhaarNumber = father;
          next.fatherAadhaarLast4 = father.slice(-4);
          next.fatherAadhaarVerification = "received";
        }
      }
      if (mother) {
        const d = decide({ number: s.motherAadhaarNumber, last4: s.motherAadhaarLast4, verification: s.motherAadhaarVerification }, mother);
        note("mother", "Mother", d, mother);
        if (d === "saved" || d === "corrected") {
          next.motherAadhaarNumber = mother;
          next.motherAadhaarLast4 = mother.slice(-4);
          next.motherAadhaarVerification = "received";
        }
      }
      return next;
    });
    if (!r.ok) continue;
    saved.push(child.fullName);
    const changed = [...outcomes.values()].filter((o) => o.status === "saved" || o.status === "corrected");
    await writeAudit({
      module: "sis",
      action: "edit",
      entityType: "student",
      entityId: child.id,
      // Never the numbers themselves in the audit trail — which ones arrived, and whether they corrected one.
      summary: `Aadhaar given by the family in the app: ${[own ? "child" : "", father ? "father" : "", mother ? "mother" : ""].filter(Boolean).join(", ")}${changed.some((o) => o.status === "corrected") ? " (corrected an unverified number)" : ""}`,
      before: {},
      after: { by },
    }).catch(() => null);
  }
  if (!saved.length) return { ok: false, error: "Could not save just now — please try again in a minute." };
  return { ok: true, saved, outcomes: [...outcomes.values()] };
}

/** APAAR consent from the app, recorded exactly as the WhatsApp answer is (with its printable record). */
export async function saveApaarConsentFromApp(
  children: SisStudent[],
  answer: "given" | "refused",
  by: string,
  hindi: boolean,
): Promise<{ ok: boolean; saved: string[] }> {
  const at = new Date().toISOString();
  const saved: string[] = [];
  for (const child of apaarConsentPending(children)) {
    const fileId = await fileConsentRecord(child, answer, at, by, hindi).catch(() => "");
    const r = await saveStudent(child.id, (s) => ({ ...s, apaarConsent: answer, apaarConsentAt: at, apaarConsentBy: by, apaarConsentFileId: fileId }));
    if (!r.ok) continue;
    saved.push(child.fullName);
    await writeAudit({
      module: "sis",
      action: "edit",
      entityType: "student",
      entityId: child.id,
      summary: `APAAR consent ${answer === "given" ? "GIVEN" : "REFUSED"} by parent in the app`,
      before: { apaarConsent: r.before.apaarConsent || "" },
      after: { apaarConsent: answer, apaarConsentAt: at, apaarConsentBy: by },
    }).catch(() => null);
  }
  return { ok: saved.length > 0, saved };
}

/**
 * The Responses list for one pop-up (lib/appPopupResponses): every family
 * that met it, and — for a rule pop-up — every family the rule still matches,
 * seen or not. Full Aadhaar numbers never leave the server here.
 */
export async function popupResponses(popup: AppPopup, sessionAy: string): Promise<ResponseRow[] | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const { data, error } = await ctx.sb
    .from("app_popup_events")
    .select("subject_key, event, value, created_at")
    .eq("tenant_id", ctx.tenantId)
    .eq("popup_id", popup.id)
    .order("created_at", { ascending: true })
    .limit(20000);
  if (error) return null;
  type Ev = { shown: number; dismissed: number; done: number; first: string; last: string; doneAt: string; gave: Set<string> };
  const byFamily = new Map<string, Ev>();
  for (const r of data ?? []) {
    const key = String(r.subject_key);
    if (!key.startsWith("hh:")) continue;
    const hh = key.slice(3);
    const e = byFamily.get(hh) ?? { shown: 0, dismissed: 0, done: 0, first: "", last: "", doneAt: "", gave: new Set<string>() };
    const at = String(r.created_at);
    if (r.event === "shown") {
      e.shown += 1;
      e.first ||= at;
      e.last = at;
    } else if (r.event === "dismissed") e.dismissed += 1;
    else if (r.event === "done") {
      e.done += 1;
      e.doneAt = at;
      const v = (r.value ?? {}) as { aadhaarFor?: unknown };
      if (Array.isArray(v.aadhaarFor)) for (const k of v.aadhaarFor) e.gave.add(String(k));
    }
    byFamily.set(hh, e);
  }

  await ensureSisHydratedServer();
  await ensureSchoolMirrorHydrated();
  const sis = loadSis();
  const masters = loadMasters();
  // The stored rows, not this server's cached copy: a number a parent saved a
  // minute ago (on another server) must show here, not read as missing.
  const read = await fetchAllPages<Record<string, unknown>>((from, to) =>
    ctx.sb.from("sis_students").select("*").eq("tenant_id", ctx.tenantId).order("id").range(from, to),
  );
  if (read.error) return null;
  const students = read.rows.map((r) => rowToStudent(r as Parameters<typeof rowToStudent>[0]));
  const kidsOf = new Map<string, SisStudent[]>();
  for (const s of childrenOnRoll(students.filter((x) => x.householdId), sessionAy)) {
    kidsOf.set(s.householdId, [...(kidsOf.get(s.householdId) ?? []), s]);
  }
  const pendingFor = (kids: SisStudent[]) => {
    if (popup.targetMode !== "rule") return false;
    const f = familyFacts(kids, popup.consentKey && popup.consentKey !== "apaar" ? [popup.consentKey] : []);
    if (popup.rule === "missing_aadhaar") return aadhaarInScope(f.missingAadhaar, popup.aadhaarScope).length > 0;
    if (popup.rule === "missing_docs") return f.missingDocs.length > 0;
    if (popup.rule === "consent_pending") return (popup.consentKey || "apaar") === "apaar" && f.pendingConsents.includes("apaar");
    return false;
  };
  const families = new Set<string>(byFamily.keys());
  if (popup.targetMode === "rule") for (const [hh, kids] of kidsOf) if (pendingFor(kids)) families.add(hh);

  const className = (classId: string, sectionId: string) => {
    const c = masters.classes.find((x) => x.id === classId)?.name || "";
    const sec = masters.sections.find((x) => x.id === sectionId)?.name || "";
    return [c, sec].filter(Boolean).join("-");
  };
  const rows: ResponseRow[] = [];
  for (const hh of families) {
    const kids = kidsOf.get(hh) ?? [];
    const e = byFamily.get(hh) ?? { shown: 0, dismissed: 0, done: 0, first: "", last: "", doneAt: "", gave: new Set<string>() };
    const house = sis.households.find((h) => h.id === hh);
    rows.push({
      householdId: hh,
      family: house?.guardianName || kids[0]?.fatherName || kids[0]?.fullName || hh,
      outcome: popupOutcome({ shown: e.shown, dismissed: e.dismissed, done: e.done }, pendingFor(kids)),
      shown: e.shown,
      later: e.dismissed,
      firstSeen: e.first,
      lastSeen: e.last,
      doneAt: e.doneAt,
      gave: [...e.gave],
      children: kids.map((k) => ({
        id: k.id,
        name: k.fullName,
        classLabel: className(k.classId, k.sectionId),
        child: aadhaarSlot(k.aadhaarNumber, k.aadhaarLast4, k.aadhaarVerification),
        father: aadhaarSlot(k.fatherAadhaarNumber, k.fatherAadhaarLast4, k.fatherAadhaarVerification),
        mother: aadhaarSlot(k.motherAadhaarNumber, k.motherAadhaarLast4, k.motherAadhaarVerification),
      })),
    });
  }
  return sortResponses(rows);
}

/**
 * The office checked a number against the card and entered it on UDISE+:
 * mark it verified. A parent's number is marked on every child of the family.
 */
export async function markAadhaarVerified(
  studentId: string,
  who: "child" | "father" | "mother",
  by: string,
): Promise<{ ok: true; marked: number } | { ok: false; error: string }> {
  await ensureSisHydratedServer();
  const student = loadSis().students.find((s) => s.id === studentId);
  if (!student) return { ok: false, error: "Student not found" };
  const ids =
    who === "child" || !student.householdId
      ? [studentId]
      : [...new Set(loadSis().students.filter((s) => s.householdId === student.householdId).map((s) => s.id))];
  let marked = 0;
  for (const id of ids) {
    const r = await saveStudent(id, (s) => {
      const next: SisStudent = { ...s };
      if (who === "child" && hasStoredAadhaar({ number: s.aadhaarNumber, last4: s.aadhaarLast4 })) next.aadhaarVerification = "verified_udise";
      if (who === "father" && hasStoredAadhaar({ number: s.fatherAadhaarNumber, last4: s.fatherAadhaarLast4 })) next.fatherAadhaarVerification = "verified_udise";
      if (who === "mother" && hasStoredAadhaar({ number: s.motherAadhaarNumber, last4: s.motherAadhaarLast4 })) next.motherAadhaarVerification = "verified_udise";
      return next;
    });
    if (!r.ok) continue;
    const field = who === "child" ? "aadhaarVerification" : who === "father" ? "fatherAadhaarVerification" : "motherAadhaarVerification";
    if (r.before[field] === r.after[field]) continue;
    marked += 1;
    await writeAudit({
      module: "sis",
      action: "edit",
      entityType: "student",
      entityId: id,
      summary: `${who === "child" ? "Child's" : who === "father" ? "Father's" : "Mother's"} Aadhaar marked verified on UDISE+`,
      before: { [field]: r.before[field] },
      after: { [field]: r.after[field], by },
    }).catch(() => null);
  }
  if (!marked) return { ok: false, error: "Nothing to mark — no number on record, or already verified." };
  return { ok: true, marked };
}
