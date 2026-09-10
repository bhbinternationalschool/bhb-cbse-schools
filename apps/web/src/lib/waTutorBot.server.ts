/**
 * Study help over WhatsApp, for the number the family already uses.
 *
 * Household-scoped, exactly like the app's tutor: the sender's number
 * identifies the family, a pass is per child, and the free hint allowance
 * is per household per day. Nothing here re-decides what a family may ask —
 * `answerParentTutor` is called in-process, so the allowance, the fair-use
 * ceiling, the model budget and the usage ledger are the SAME code the app
 * goes through. Two answers to "has this family paid for this" is the one
 * thing this must not add.
 *
 * Buying a pass reuses the app's order + Cashfree checkout path unchanged:
 * a pending order, a payment link whose link_id is the order id, and the
 * existing webhook that re-verifies with the gateway before activating.
 * No new payment code, and therefore no second place for a pass to be
 * activated wrongly.
 */

import "server-only";

import type { Household, SisStudent } from "@/lib/sis";
import { loadMasters } from "@/lib/masters";
import { classLabel as classLabelOf } from "@/lib/homework";
import { loadWaBotSlice, saveWaBotSlice } from "@/lib/waBotStore.server";
import {
  composeBuyLinkText,
  composeNeedsPassText,
  composePlansText,
  composeTutorStatus,
  parseWaTutorCommand,
  tutorSessionExpired,
  type WaTutorState,
} from "@/lib/waTutorBotEngine";
import {
  tutorMode as normalizeTutorMode,
  type TutorAllowance,
  type TutorMode,
} from "@/lib/tutorPlans";
import {
  currentTutorPass,
  insertTutorPassOrder,
  newTutorOrderId,
  setTutorOrderCheckoutUrl,
  tutorAllowance,
  tutorPlans,
} from "@/lib/tutorPasses.server";
import { answerParentTutor, parseTutorAsk } from "@/lib/tutorApi.server";
import { shouldUseCashfreeCheckout } from "@/lib/cashfree.server";
import { TENANT } from "@/lib/types";

type Slice = { version: 1; sessions: WaTutorState[] };

const EMPTY: Slice = { version: 1, sessions: [] };

async function readSessions(): Promise<Slice> {
  const s = await loadWaBotSlice<Slice>("tutor", EMPTY);
  return s?.version === 1 && Array.isArray(s.sessions) ? s : EMPTY;
}

async function writeSession(next: WaTutorState | null, mobile10: string) {
  const cur = await readSessions();
  const others = cur.sessions.filter((s) => s.mobile10 !== mobile10);
  await saveWaBotSlice<Slice>("tutor", {
    version: 1,
    // Bounded: one row per household that has used study help lately.
    sessions: (next ? [next, ...others] : others).slice(0, 500),
  });
}

export type WaTutorReply = { handled: boolean; replyText: string };

const NOT_HANDLED: WaTutorReply = { handled: false, replyText: "" };

function childLabel(s: SisStudent): string {
  return classLabelOf(loadMasters(), s.classId, s.sectionId).replace(" · ", " ");
}

/**
 * Ask the tutor through the app's own route handler.
 *
 * It answers with a Response — a 402 carrying `needsPass` when the
 * allowance is spent, JSON otherwise — which is exactly the distinction
 * this bot needs, so it is read rather than reproduced.
 */
async function askTutor(opts: {
  householdId: string;
  student: { id: string; name: string; classLabel: string };
  mode: TutorMode;
  message: string;
  language: string;
}): Promise<
  | { ok: true; reply: string }
  | { ok: false; needsPass: boolean; reason: string }
> {
  const res = await answerParentTutor({
    householdId: opts.householdId,
    student: opts.student,
    ask: parseTutorAsk({
      message: opts.message,
      mode: opts.mode,
      studentId: opts.student.id,
      language: opts.language,
    }),
    stream: false,
  });
  const json = (await res.json().catch(() => null)) as
    | { ok?: boolean; reply?: string; error?: string; needsPass?: boolean }
    | null;
  if (res.ok && json?.reply) return { ok: true, reply: json.reply };
  return {
    ok: false,
    needsPass: !!json?.needsPass,
    reason:
      json?.error ||
      "Study help could not answer just now. Please try again in a minute.",
  };
}

/**
 * Handle a study-help message, or say it is not ours.
 *
 * `handled: false` means the normal parent bot should carry on — which is
 * how a parent halfway through study help can still type DUES and get
 * their fees.
 */
export async function handleWaTutorInbound(opts: {
  household: Household;
  children: SisStudent[];
  mobile10: string;
  text: string;
}): Promise<WaTutorReply> {
  const kids = opts.children.filter((s) => s.status === "active");
  const sessions = await readSessions();
  const stored = sessions.sessions.find((s) => s.mobile10 === opts.mobile10) || null;
  const session = tutorSessionExpired(stored) ? null : stored;
  const cmd = parseWaTutorCommand(opts.text, !!session);
  if (cmd.kind === "none") return NOT_HANDLED;

  if (!kids.length) {
    return {
      handled: true,
      replyText:
        "Study help needs an enrolled child on this number. Please ask the school office to check the record.",
    };
  }

  const childRefs = kids.map((s) => ({
    id: s.id,
    name: s.fullName,
    classLabel: childLabel(s),
  }));
  const activeIndex = session
    ? Math.max(0, childRefs.findIndex((c) => c.id === session.studentId))
    : 0;
  const language = (opts.household.preferredLanguage || "en") === "hi" ? "hi" : "en";

  const statusFor = async (
    index: number,
    mode: TutorMode | null,
  ): Promise<string> => {
    const child = childRefs[index] || childRefs[0]!;
    let allowance: TutorAllowance | null = null;
    try {
      allowance = await tutorAllowance(opts.household.id, child);
    } catch {
      // A ledger read that fails must not hide the menu: the parent can
      // still choose a mode, and the ask itself re-checks the allowance.
      allowance = null;
    }
    return composeTutorStatus({
      guardianName: opts.household.guardianName || "Parent",
      children: childRefs.map((c) => ({ name: c.name, classLabel: c.classLabel })),
      activeChild: index,
      allowance,
      mode,
    });
  };

  if (cmd.kind === "close") {
    await writeSession(null, opts.mobile10);
    return {
      handled: true,
      replyText:
        "Study help closed. Reply *TUTOR* whenever you need it, or *MENU* for everything else.",
    };
  }

  if (cmd.kind === "open") {
    await writeSession(
      {
        mobile10: opts.mobile10,
        studentId: childRefs[activeIndex]?.id || childRefs[0]!.id,
        mode: session?.mode || "hint",
        updatedAt: new Date().toISOString(),
      },
      opts.mobile10,
    );
    return {
      handled: true,
      replyText: await statusFor(activeIndex, session?.mode || null),
    };
  }

  if (cmd.kind === "child") {
    const index = cmd.index - 1;
    if (index < 0 || index >= childRefs.length) {
      return {
        handled: true,
        replyText: `Pick a number between 1 and ${childRefs.length}.\n\n${childRefs
          .map((c, i) => `• *TUTOR ${i + 1}* — ${c.name} (${c.classLabel})`)
          .join("\n")}`,
      };
    }
    await writeSession(
      {
        mobile10: opts.mobile10,
        studentId: childRefs[index]!.id,
        mode: session?.mode || "hint",
        updatedAt: new Date().toISOString(),
      },
      opts.mobile10,
    );
    return { handled: true, replyText: await statusFor(index, session?.mode || null) };
  }

  const child = childRefs[activeIndex] || childRefs[0]!;

  if (cmd.kind === "plans") {
    const plans = tutorPlans();
    let pass = null;
    try {
      pass = await currentTutorPass(opts.household.id, child.id);
    } catch {
      pass = null;
    }
    return {
      handled: true,
      replyText: composePlansText({
        plans,
        childName: child.name,
        hasPass: !!pass,
        passEndsAt: pass?.endsAt,
      }),
    };
  }

  if (cmd.kind === "buy") {
    const plans = tutorPlans();
    const plan = plans[cmd.index - 1];
    if (!plan) {
      return {
        handled: true,
        replyText: composePlansText({
          plans,
          childName: child.name,
          hasPass: false,
        }),
      };
    }
    if (!shouldUseCashfreeCheckout()) {
      return {
        handled: true,
        replyText:
          "Online payment is not switched on yet — please ask the school office about a study pass.",
      };
    }
    const orderId = newTutorOrderId();
    const ins = await insertTutorPassOrder({
      id: orderId,
      householdId: opts.household.id,
      studentId: child.id,
      plan,
      createdBy: `${opts.household.guardianName || "Parent"} (WhatsApp)`,
    });
    if (!ins.ok) {
      return {
        handled: true,
        replyText:
          "The pass could not be started just now. Please try again in a minute.",
      };
    }
    try {
      const { createCashfreeCheckout } = await import(
        "@/lib/cashfreeCheckouts.server"
      );
      const { publicAppOrigin } = await import("@/lib/waSisBotServer");
      const origin = publicAppOrigin();
      // Same arguments the app's /api/v1/tutor/buy sends, so a pass bought
      // over WhatsApp is the same order, on the same pay page, activated by
      // the same webhook.
      const link = await createCashfreeCheckout({
        kind: "tutor_pass",
        ref: orderId,
        preferredId: orderId,
        amountPaise: plan.pricePaise,
        purpose: `AI tutor pass · ${plan.label} · ${child.name} (${child.classLabel}) · ${TENANT.nameDisplay}`,
        customerId: opts.household.id,
        customerName: opts.household.guardianName || "Parent",
        customerMobile: opts.mobile10,
        afterUrl: `${origin}/pay/tutor-pass/${orderId}`,
        origin,
        notes: {
          householdId: opts.household.id,
          studentId: child.id,
          planCode: plan.code,
        },
      });
      if (!link.ok) {
        return {
          handled: true,
          replyText:
            "The payment link could not be created just now. Please try again, or ask the school office.",
        };
      }
      await setTutorOrderCheckoutUrl(orderId, link.checkoutUrl);
      return {
        handled: true,
        replyText: composeBuyLinkText({
          planLabel: plan.label,
          amountPaise: plan.pricePaise,
          childName: child.name,
          url: link.checkoutUrl,
        }),
      };
    } catch (e) {
      console.error("[wa-tutor] checkout failed", e);
      return {
        handled: true,
        replyText:
          "The payment link could not be created just now. Please try again, or ask the school office.",
      };
    }
  }

  // ── A mode switch, or a question inside the open session ──────────────
  const mode: TutorMode =
    cmd.kind === "mode" ? normalizeTutorMode(cmd.mode).code : session?.mode || "hint";
  const question = cmd.kind === "mode" ? cmd.question : cmd.text;

  await writeSession(
    {
      mobile10: opts.mobile10,
      studentId: child.id,
      mode,
      updatedAt: new Date().toISOString(),
    },
    opts.mobile10,
  );

  if (!question) {
    // Mode chosen with nothing to answer yet — prompt rather than spend a
    // model call, and rather than an allowance, on an empty message.
    const info = normalizeTutorMode(mode);
    return {
      handled: true,
      replyText: [
        `*${info.label}* for ${child.name} (${child.classLabel}).`,
        "",
        `Type your question. ${info.prompt}`,
      ].join("\n"),
    };
  }

  const answer = await askTutor({
    householdId: opts.household.id,
    student: child,
    mode,
    message: question,
    language,
  });

  if (answer.ok) return { handled: true, replyText: answer.reply };

  return {
    handled: true,
    replyText: answer.needsPass
      ? composeNeedsPassText({
          mode,
          reason: answer.reason,
          childName: child.name,
          canBuy: shouldUseCashfreeCheckout(),
        })
      : answer.reason,
  };
}


/**
 * Tell the parent on WhatsApp that the pass is live.
 *
 * The buy message promises this, so it has to happen — a parent who paid
 * and heard nothing back on the thread they paid from has no way to know
 * whether it worked.
 *
 * Free text rather than a template, and that is sound HERE specifically:
 * the parent messaged the bot to buy moments earlier, so Meta's 24-hour
 * window is open. It is attempted, never depended on — the pass is already
 * active in the ledger, so a failed notice costs a message, not the
 * purchase. Called only on a FRESH activation, so a redelivered webhook
 * cannot message the family twice.
 */
export async function notifyTutorPassActive(opts: {
  orderId: string;
  endsAt: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const { getTutorPassOrder } = await import("@/lib/tutorPasses.server");
    const order = await getTutorPassOrder(opts.orderId);
    if (!order) return { ok: false, error: "Order not found" };

    const { ensureSchoolMirrorHydrated } = await import(
      "@/lib/schoolDataMirror.server"
    );
    await ensureSchoolMirrorHydrated().catch(() => false);
    const { loadSis } = await import("@/lib/sis");
    const sis = loadSis();
    const hh = (sis.households ?? []).find((h) => h.id === order.householdId);
    if (!hh) return { ok: false, error: "Household not found" };
    const kids = (sis.students ?? []).filter(
      (s) => s.householdId === hh.id && s.status === "active",
    );
    const child = kids.find((s) => s.id === order.studentId);

    // The same number-choosing rule the rest of the ERP uses, so a family
    // whose first number is not on WhatsApp still hears about their pass.
    const { householdCandidateNumbers, pickWaNumbers } = await import(
      "@/lib/waHouseholdNumbers"
    );
    const { listKnownNotOnWhatsApp } = await import(
      "@/lib/waNumberHealth.server"
    );
    const candidates = householdCandidateNumbers({
      household: hh,
      students: kids,
    });
    const knownBad = await listKnownNotOnWhatsApp(
      candidates.map((c) => c.mobile10),
    ).catch(() => new Set<string>());
    const choice = pickWaNumbers(candidates, knownBad);
    if (!choice.primary) return { ok: false, error: "No usable WhatsApp number" };

    const { passDaysLeft } = await import("@/lib/waTutorBotEngine");
    const days = passDaysLeft(opts.endsAt);
    const who = child?.fullName || "your child";
    // The order stores the plan CODE; its label lives with the plans.
    const planLabel =
      tutorPlans().find((p) => p.code === order.planCode)?.label ||
      `${order.days} day${order.days === 1 ? "" : "s"}`;
    const body = [
      `✅ *Study pass active* for ${who} — ${planLabel}.`,
      "",
      days > 0
        ? `Full study help is open for the next ${days} day${days === 1 ? "" : "s"}.`
        : "Full study help is open now.",
      "",
      "Reply *TUTOR* to start — teach a topic, worked examples, practice questions, or check your child's answer.",
    ].join("\n");

    const { sendWaWithFailover } = await import("@/lib/waSend");
    const r = await sendWaWithFailover({
      primaryMobile: choice.primary.mobile10,
      fallbackMobile: choice.fallback?.mobile10,
      body,
      clientMessageId: `tutor_pass_${opts.orderId}`,
    });
    if (!r.ok) return { ok: false, error: r.error };

    const { logHouseholdWaSend } = await import(
      "@/lib/householdMessageLog.server"
    );
    await logHouseholdWaSend({
      mobile: choice.primary.mobile10,
      purpose: "tutor",
      via: "text",
      preview: body,
      status: "sent",
      waMessageId: r.providerId,
    });
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Notify failed",
    };
  }
}
