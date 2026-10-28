/**
 * Server side of linking an unknown parent number by WhatsApp questions.
 * The rules and the conversation are in lib/waNumberVerify.ts.
 *
 *  - inviteNumberForVerify: one WhatsApp (template parent_number_check) to a
 *    number that asked the app for an OTP and is not on record. Called by the
 *    OTP route and by the office's "Ask on WhatsApp" button.
 *  - tryWaNumberVerify: called by the WhatsApp webhook BEFORE the ordinary
 *    bot. Handles a message only when this number has a live conversation;
 *    everything else falls through untouched.
 *  - notifyNumberLinked: the office approved a request — tell the parent.
 *
 * State: module_local_state "parent_wa_verify" (server-written). Links go
 * into "parent_linked_mobiles" exactly like the app's own link flow, so login
 * (resolveHouseholdByMobileServer) and the office's Comms card see them.
 */

import { fetchMastersDeskFromDb } from "@/lib/mastersNormalized.server";
import { childrenOnRoll } from "@/lib/appPopups";
import { readModuleLocalState, writeModuleLocalState } from "@/lib/moduleLocalState.server";
import { readParentLinks, registeredMobileOf, requestOfficeLink, writeParentLinks } from "@/lib/parentNumberLink.server";
import { linkedHousehold, maskMobile, withLinked } from "@/lib/parentNumberLink";
import { resolveHouseholdByMobileServer } from "@/lib/parentHousehold.server";
import { normalizeUnknownLoginState, setUnknownLoginDone } from "@/lib/loginUnknownNumbers";
import { loadSis, type SisStudent } from "@/lib/sis";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { resolveLoginAcademicYearCode } from "@/lib/workspaceSession.server";
import { fetchServerBlob } from "@/lib/serverBlob";
import {
  normalizeWaTemplatesState,
  resolveTemplateForSend,
  templateVariablePositions,
  WA_PARENT_APP_URL,
  type WaTemplatesState,
} from "@/lib/waTemplates";
import { buildWaTemplateBodyComponent, sendWaWithFailover, sendWhatsAppText, waNormalizeLocal10 } from "@/lib/waSend";
import { TENANT } from "@/lib/types";
import {
  advance,
  afterFailedCheck,
  answersSummary,
  canInvite,
  emptyWaVerifyState,
  linkedReply,
  liveSession,
  newInvite,
  normalizeWaVerifyState,
  verifyAnswers,
  withSession,
  type WaVerifySession,
  type WaVerifyState,
} from "@/lib/waNumberVerify";

const KEY = "parent_wa_verify" as const;
/**
 * Automatic invitations per hour, across all numbers. Anyone can type any
 * number into the app; without a cap the school could be made to send paid
 * WhatsApp templates to strangers in bulk. The office's button is not capped.
 */
const AUTO_INVITES_PER_HOUR = 20;

/** null = could not read (never "nobody was asked"). */
async function readState(): Promise<WaVerifyState | null> {
  const row = await readModuleLocalState<unknown>(KEY);
  if (!row) return null;
  return row.state ? normalizeWaVerifyState(row.state) : emptyWaVerifyState();
}

async function writeState(state: WaVerifyState): Promise<boolean> {
  return (await writeModuleLocalState(KEY, state)).ok;
}

/** The current conversation (or last result) per number, for the office card. */
export async function readWaVerifySessions(): Promise<WaVerifySession[] | null> {
  const s = await readState();
  return s ? s.sessions : null;
}

async function sendTemplate(familyKey: string, to: string, values: Record<string, string>, tag: string): Promise<{ ok: boolean; error?: string }> {
  const { state: raw } = await fetchServerBlob<WaTemplatesState>("wa_templates_state");
  const tpl = resolveTemplateForSend({ state: normalizeWaTemplatesState(raw), familyKey, language: "hi" });
  if (!tpl.ok) return { ok: false, error: `template ${familyKey} not ready: ${tpl.reason}` };
  const positions = templateVariablePositions(tpl.template, values);
  const r = await sendWaWithFailover({
    primaryMobile: to,
    template: {
      name: tpl.template.metaName,
      language: tpl.template.metaLanguage || tpl.template.language,
      components: [buildWaTemplateBodyComponent(Object.keys(positions).sort((a, b) => Number(a) - Number(b)), positions)],
    },
    fromPhoneNumberId: tpl.sender?.phoneNumberId,
    clientMessageId: `${familyKey}_${to}_${tag}`,
  });
  return r.ok ? { ok: true } : { ok: false, error: r.error || "send failed" };
}

/** Free text first (inside Meta's 24 h window), the template when the window is closed. */
async function textOrTemplate(to: string, text: string, familyKey: string, values: Record<string, string>, tag: string): Promise<{ ok: boolean; error?: string }> {
  const t = await sendWhatsAppText({ toMobile: to, body: text, clientMessageId: `${familyKey}_${to}_${tag}_txt` });
  if (t.ok) return { ok: true };
  return sendTemplate(familyKey, to, values, tag);
}

export type InviteResult = { status: "sent" | "skipped" | "failed"; reason: string };

/**
 * Ask an unknown number on WhatsApp whether it belongs to a parent.
 * Never throws; a number that is known, linked, invalid, mid-conversation or
 * asked in the last few days is skipped (unless the office forces a re-ask).
 */
export async function inviteNumberForVerify(mobile10: string, source: "login" | "office", force = false): Promise<InviteResult> {
  try {
    const state = await readState();
    if (!state) return { status: "failed", reason: "could not read the conversation list" };
    const now = Date.now();
    const can = canInvite(state, mobile10, now, force);
    if (!can.ok) return { status: "skipped", reason: can.reason };
    if (source === "login") {
      const lastHour = state.sessions.filter((x) => x.source === "login" && now - Date.parse(x.invitedAt) < 3600_000).length;
      if (lastHour >= AUTO_INVITES_PER_HOUR) return { status: "skipped", reason: "hourly limit for automatic messages reached" };
    }
    if (await resolveHouseholdByMobileServer(mobile10)) return { status: "skipped", reason: "number is already on record" };
    const links = await readParentLinks();
    if (links && linkedHousehold(links, mobile10)) return { status: "skipped", reason: "number is already linked" };

    const sent = await sendTemplate("parent_number_check", mobile10, { schoolName: TENANT.nameDisplay }, String(now));
    if (!sent.ok) return { status: "failed", reason: sent.error ?? "send failed" };
    const ok = await writeState(withSession(state, newInvite(mobile10, source, new Date(now).toISOString())));
    return ok ? { status: "sent", reason: "" } : { status: "failed", reason: "sent, but the conversation could not be saved" };
  } catch (e) {
    return { status: "failed", reason: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Children on roll and their class names. Classes come from the database:
 * loadMasters() is browser state and is EMPTY on the server, which would make
 * every class answer "wrong" (found 14 Oct on production data). A failed
 * read is null — the check then goes to the office rather than guessing.
 */
async function onRoll(): Promise<{ onRoll: SisStudent[]; classNameOf: (id: string) => string } | null> {
  await ensureSisHydratedServer();
  const ay = (await resolveLoginAcademicYearCode(undefined).catch(() => null)) || "";
  const masters = await fetchMastersDeskFromDb();
  const list = (masters.bundle?.classes ?? []) as { id: string; name: string }[];
  if (masters.readFailed || list.length === 0) return null;
  const classes = new Map(list.map((c) => [c.id, c.name]));
  return { onRoll: childrenOnRoll(loadSis().students, ay), classNameOf: (id) => classes.get(id) ?? "" };
}

async function markLoginHandled(mobile10: string, note: string): Promise<void> {
  const row = await readModuleLocalState<unknown>("login_unknown_numbers");
  if (!row) return;
  const next = setUnknownLoginDone(normalizeUnknownLoginState(row.state), {
    mobile10,
    app: "parent",
    done: true,
    by: "WhatsApp check",
    note,
    now: new Date().toISOString(),
  });
  await writeModuleLocalState("login_unknown_numbers", next);
}

async function toOffice(session: WaVerifySession, note: string): Promise<void> {
  await requestOfficeLink({
    mobile: session.mobile10,
    childName: session.answers.childName,
    dob: session.answers.dob,
    className: session.answers.className,
    note: `WhatsApp check — ${note} Answers: ${answersSummary(session.answers)}`.slice(0, 300),
    ip: `wa:${session.mobile10}`,
  });
}

export type VerifyTurn = { handled: boolean; outcome?: "asked" | "linked" | "office" | "declined"; error?: string };

/** One inbound WhatsApp message. handled:false = not ours, let the ordinary bot answer. */
export async function tryWaNumberVerify(input: { fromWaId: string; text?: string }): Promise<VerifyTurn> {
  const mobile10 = waNormalizeLocal10(input.fromWaId);
  const text = String(input.text ?? "").trim();
  if (!/^\d{10}$/.test(mobile10) || !text) return { handled: false };
  const state = await readState();
  if (!state) return { handled: false };
  const nowMs = Date.now();
  const session = liveSession(state, mobile10, nowMs);
  if (!session) return { handled: false };
  const nowIso = new Date(nowMs).toISOString();

  let step = advance(session, text, nowIso);
  let outcome: VerifyTurn["outcome"] = step.session.step === "declined" ? "declined" : "asked";

  if (step.action === "verify") {
    const ctx = await onRoll();
    const roll = ctx?.onRoll ?? [];
    const households = new Map(loadSis().households.map((h) => [h.id, h]));
    const check = ctx
      ? verifyAnswers(roll, step.session.answers, ctx.classNameOf, (st) => households.get(st.householdId)?.guardianName ?? "")
      : ({ kind: "unreadable" } as const);
    if (check.kind === "unreadable") {
      step = { session: { ...step.session, step: "office", result: "sent to office: class list could not be read" }, reply: "", action: "office", officeNote: "The school's class list could not be read, so the answers were not checked." };
    } else if (check.kind === "verified") {
      const child = check.student;
      const household = households.get(child.householdId);
      const links = await readParentLinks();
      if (!household || !links) {
        step = { session: { ...step.session, step: "office", result: "sent to office: could not save the link" }, reply: "", action: "office", officeNote: "Answers matched but the link could not be saved." };
      } else {
        const saved = await writeParentLinks(
          withLinked(links, {
            mobile10,
            householdId: household.id,
            childName: child.fullName,
            via: "wa_questions",
            linkedAt: nowIso,
            by: "WhatsApp questions",
          }),
        );
        if (!saved) {
          step = { session: { ...step.session, step: "office", result: "sent to office: could not save the link" }, reply: "", action: "office", officeNote: "Answers matched but the link could not be saved." };
        } else {
          step = {
            session: { ...step.session, step: "linked", result: `linked to ${child.fullName}'s family (${household.code || household.id})` },
            reply: linkedReply(child.fullName.split(/\s+/)[0] ?? "", WA_PARENT_APP_URL),
            action: "none",
          };
          outcome = "linked";
          await markLoginHandled(mobile10, `linked by WhatsApp check to ${child.fullName}`);
          // The family's own number hears about it at once.
          const registered = registeredMobileOf(household, roll.filter((s) => s.householdId === household.id));
          if (registered && registered !== mobile10) {
            const guardian = household.guardianName || "अभिभावक";
            await textOrTemplate(
              registered,
              `नमस्ते ${guardian} जी 🙏\n\n${TENANT.nameDisplay} के पैरेंट ऐप में आपके परिवार (${child.fullName}) के खाते से एक नया नंबर *${maskMobile(mobile10)}* जोड़ा गया है।\n\nअगर यह आपकी जानकारी में नहीं है, तो तुरंत स्कूल कार्यालय से संपर्क करें।`,
              "parent_number_added",
              { guardianName: guardian, newNumber: maskMobile(mobile10), childName: child.fullName, schoolName: TENANT.nameDisplay },
              nowIso,
            ).catch(() => null);
          }
        }
      }
    } else {
      step = afterFailedCheck(step.session, check.why, nowIso);
    }
  }

  if (step.action === "office") {
    outcome = "office";
    await toOffice(step.session, step.officeNote ?? "");
    if (!step.reply) step = { ...step, reply: "धन्यवाद 🙏 आपकी जानकारी स्कूल कार्यालय को भेज दी गई है। जाँच के बाद आपको इसी नंबर पर संदेश मिलेगा।" };
  }

  const saved = await writeState(withSession(state, step.session));
  if (!saved) return { handled: true, outcome, error: "conversation not saved" };
  if (step.reply) {
    const r = await sendWhatsAppText({ toMobile: mobile10, body: step.reply, clientMessageId: `numverify_${mobile10}_${nowMs}` });
    if (!r.ok) return { handled: true, outcome, error: r.error };
  }
  return { handled: true, outcome };
}

/** The office approved a link request: tell the new number it can log in. */
export async function notifyNumberLinked(mobile10: string, childName: string): Promise<{ ok: boolean; error?: string }> {
  const first = childName.split(/\s+/)[0] ?? "";
  const r = await textOrTemplate(
    mobile10,
    linkedReply(first, WA_PARENT_APP_URL),
    "parent_number_linked",
    { childName: childName || "आपके बच्चे", schoolName: TENANT.nameDisplay },
    String(Date.now()),
  );
  const state = await readState();
  const s = state?.sessions.find((x) => x.mobile10 === mobile10);
  if (state && s) {
    await writeState(withSession(state, { ...s, step: "linked", updatedAt: new Date().toISOString(), result: `approved by the office (${childName})` }));
  }
  return r;
}

