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
import { writeAudit } from "@/lib/audit.server";
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
  await ensureSisHydratedServer();
  const visible = loadSisForStaff().students.filter((s) => s.status === "active" && s.householdId);
  const visibleIds = new Set(visible.map((s) => s.id));
  const rows: { children: number; missing: string[] }[] = [];
  for (const hh of new Set(visible.map((s) => s.householdId))) {
    const kids = (await householdChildren(hh, sessionAy)).filter((k) => visibleIds.has(k.id));
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

async function saveStudent(
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
 * Only gaps are filled — a number already on the record is left alone.
 */
export async function saveFamilyAadhaar(
  children: SisStudent[],
  numbers: Record<string, string>,
  by: string,
): Promise<{ ok: true; saved: string[] } | { ok: false; error: string }> {
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(numbers)) {
    const n = aadhaarDigits(v);
    if (!n) continue;
    if (!aadhaarChecksumValid(n)) return { ok: false, error: "One of the Aadhaar numbers is not valid — please check the 12 digits." };
    if (k !== "father" && k !== "mother" && !children.some((c) => c.id === k)) continue;
    clean[k] = n;
  }
  if (!Object.keys(clean).length) return { ok: false, error: "No Aadhaar number to save." };

  const saved: string[] = [];
  for (const child of children) {
    const own = clean[child.id];
    const father = clean.father;
    const mother = clean.mother;
    if (!own && !father && !mother) continue;
    const r = await saveStudent(child.id, (s) => {
      const next: SisStudent = { ...s };
      if (own && !hasStoredAadhaar({ number: s.aadhaarNumber, last4: s.aadhaarLast4 })) {
        next.aadhaarNumber = own;
        next.aadhaarLast4 = own.slice(-4);
        next.aadhaarVerification = "received";
      }
      if (father && !hasStoredAadhaar({ number: s.fatherAadhaarNumber, last4: s.fatherAadhaarLast4 })) {
        next.fatherAadhaarNumber = father;
        next.fatherAadhaarLast4 = father.slice(-4);
        next.fatherAadhaarVerification = "received";
      }
      if (mother && !hasStoredAadhaar({ number: s.motherAadhaarNumber, last4: s.motherAadhaarLast4 })) {
        next.motherAadhaarNumber = mother;
        next.motherAadhaarLast4 = mother.slice(-4);
        next.motherAadhaarVerification = "received";
      }
      return next;
    });
    if (!r.ok) continue;
    saved.push(child.fullName);
    await writeAudit({
      module: "sis",
      action: "edit",
      entityType: "student",
      entityId: child.id,
      // Never the numbers themselves in the audit trail — which ones arrived.
      summary: `Aadhaar given by the family in the app: ${[own ? "child" : "", father ? "father" : "", mother ? "mother" : ""].filter(Boolean).join(", ")}`,
      before: {},
      after: { by },
    }).catch(() => null);
  }
  if (!saved.length) return { ok: false, error: "Could not save just now — please try again in a minute." };
  return { ok: true, saved };
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
