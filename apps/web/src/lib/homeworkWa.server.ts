import "server-only";

/**
 * Homework, on WhatsApp, to the parents of the section.
 *
 * Until now nothing sent it. The `bhb_homework_published` template has been
 * approved in both languages since August and the `auto_homework_published`
 * rule has sat in the automation seed the whole time, but nothing in the
 * codebase ever emitted the `homework.published` event the rule waits on —
 * so a published post reached parents as an app push and nothing else, and
 * production has one homework post with `whatsapp_notified_count` 0.
 *
 * This sends it directly, the way fee receipts are sent
 * (feeReceiptAutoWa.server.ts), rather than through the automation engine:
 * homework is due tomorrow, and an approval queue that a clerk clears the
 * next morning would deliver it after the child had left for school.
 *
 * Four rules:
 *
 *   the post comes FIRST. A teacher's homework is saved whether or not
 *     WhatsApp is reachable; every failure here is logged, never thrown back
 *     into the posting path;
 *   once per post. `claimSendOnce` stops two requests dispatching the same
 *     post, and `whatsappNotifiedAt` on the post stops a later re-publish;
 *   once per FAMILY, not per child. Two siblings in one section share a
 *     household and a phone;
 *   the family's own language, never the teacher's.
 */

import { getServerTenantContext } from "@/lib/serverTenant";
import { fetchServerBlob } from "@/lib/serverBlob";
import { claimSendOnce, releaseSendClaim } from "@/lib/waSendClaim.server";
import { waTemplateLanguageFor } from "@/lib/householdPrefs";
import { logHouseholdWaSend } from "@/lib/householdMessageLog.server";
import { householdWhatsApp, loadSis, type Household } from "@/lib/sis";
import { rosterForSection, type HomeworkPost } from "@/lib/homework";
import { sendWaWithFailover } from "@/lib/waSend";
import {
  normalizeWaTemplatesState,
  resolveTemplateForSend,
  templateFamilyReady,
  templateVariablePositions,
  type WaTemplatesState,
} from "@/lib/waTemplates";
import { TENANT } from "@/lib/types";
import { homeworkWaBody, homeworkWaDue, homeworkWaLine } from "@/lib/homeworkExpand";

/** Tells the family homework exists and sends them to the app. The floor. */
export const HOMEWORK_TEMPLATE_FAMILY = "homework_published";
/** Shows the book, the chapter and the work in WhatsApp itself. Preferred. */
export const HOMEWORK_TEMPLATE_FAMILY_FULL = "homework_published_full";

/**
 * Which homework template to use.
 *
 * The one that carries the chapter, as soon as Meta has approved it in BOTH
 * languages — a half-approved family would send Hindi households English.
 * Until then the older one keeps sending, so Meta's queue can take as long
 * as it likes without a single post going undelivered. Same arrangement as
 * chooseReceiptFamily().
 */
function chooseHomeworkFamily(state: WaTemplatesState): { familyKey: string; withChapter: boolean } {
  return templateFamilyReady(state, HOMEWORK_TEMPLATE_FAMILY_FULL).ready
    ? { familyKey: HOMEWORK_TEMPLATE_FAMILY_FULL, withChapter: true }
    : { familyKey: HOMEWORK_TEMPLATE_FAMILY, withChapter: false };
}

export type HomeworkWaResult = {
  families: number;
  sent: number;
  failed: number;
  skipped: number;
  /** Set when nothing was attempted at all, and why. */
  reason?: string;
};

/** One row per household of the section, each with its own phone and language. */
function familiesOfSection(post: HomeworkPost): { household: Household; mobile: string; children: string[] }[] {
  const sis = loadSis();
  // rosterForSection is already scoped to the section's academic year, so a
  // child's older rows cannot bring their family in twice.
  const students = rosterForSection(sis, post.sectionId, post.academicYearCode);
  const byHousehold = new Map<string, { household: Household; mobile: string; children: string[] }>();
  for (const s of students) {
    if (!s.householdId) continue;
    const household = sis.households.find((h) => h.id === s.householdId);
    if (!household) continue;
    const mobile = householdWhatsApp(household);
    if (!mobile) continue;
    const row = byHousehold.get(household.id);
    if (row) row.children.push(s.fullName);
    else byHousehold.set(household.id, { household, mobile, children: [s.fullName] });
  }
  return [...byHousehold.values()];
}

/** Stamp the post so a re-publish does not message the section again. */
async function markNotified(postId: string, count: number): Promise<void> {
  try {
    const ctx = await getServerTenantContext();
    if (!ctx) return;
    const { error } = await ctx.sb
      .from("homework_desk_posts")
      .update({ whatsapp_notified_at: new Date().toISOString(), whatsapp_notified_count: count })
      .eq("tenant_id", ctx.tenantId)
      .eq("id", postId);
    if (error) console.warn("[homeworkWa] could not stamp the post", error.message);
  } catch (e) {
    console.warn("[homeworkWa] could not stamp the post", (e as Error)?.message);
  }
}

/**
 * Message every family in the section. Never throws.
 *
 * Quiet hours are deliberately NOT consulted, for the same reason a receipt
 * ignores them: this is not the school deciding to write to a family, it is
 * work their child has to do, usually by tomorrow. Held until 8 a.m. it
 * would arrive after the child left for school. If a teacher posting at
 * eleven at night becomes a real complaint, the answer is to stop the
 * teacher posting at eleven, not to hold the homework.
 */
export async function sendHomeworkWhatsApp(input: {
  post: HomeworkPost;
  classLabel: string;
  subjectLabel: string;
  /** Written by the expansion; falls back to the plain body when absent. */
  bodyHi?: string;
  /** A person pressed send again, on purpose — skips the already-sent guard. */
  force?: boolean;
}): Promise<HomeworkWaResult> {
  const { post } = input;
  const empty: HomeworkWaResult = { families: 0, sent: 0, failed: 0, skipped: 0 };
  try {
    if (post.status !== "published") return { ...empty, reason: "Post is not published" };
    if (!input.force && post.whatsappNotifiedAt) {
      return { ...empty, reason: "Already sent for this post" };
    }

    const families = familiesOfSection(post);
    if (!families.length) return { ...empty, reason: "No family in this section has a WhatsApp number" };

    const { state: raw } = await fetchServerBlob<WaTemplatesState>("wa_templates_state");
    if (!raw) return { ...empty, families: families.length, reason: "Template registry unavailable" };
    // Normalise, never read the blob raw — a template added to the catalogue
    // since the blob was last saved is simply absent from it. See the same
    // note in feeReceiptAutoWa.server.ts, where reading raw silently cost
    // every receipt its PDF.
    const state = normalizeWaTemplatesState(raw);

    // One claim for the whole dispatch: two requests for the same post must
    // not each message forty families.
    const choice = chooseHomeworkFamily(state);

    // Looked up once for the whole section, not once per family: it is the
    // same book and the same chapter for every child in it.
    let chapterLine = "";
    if (choice.withChapter && post.aiTutorHint) {
      try {
        const { chapterLineForPost } = await import("@/lib/homeworkExpand.server");
        chapterLine = await chapterLineForPost({
          className: input.classLabel,
          subjectLabel: input.subjectLabel,
          aiTutorHint: post.aiTutorHint,
        });
      } catch (e) {
        console.warn("[homeworkWa] chapter line unavailable", (e as Error)?.message);
      }
    }

    const claim = await claimSendOnce(`homework:${post.id}`, post.teacherName || "homework", `${input.classLabel} · ${input.subjectLabel}`);
    if (!claim.ok) return { ...empty, families: families.length, reason: claim.message };

    let sent = 0;
    let failed = 0;
    let skipped = 0;
    try {
      for (const family of families) {
        const language = waTemplateLanguageFor(family.household);
        const expansion = {
          title: post.title,
          bodyEn: post.bodyEn,
          bodyHi: input.bodyHi || post.bodyHi || post.bodyEn,
        };

        // The whole message first. It carries the book, the chapter, what
        // the chapter covers and the teacher's own words; the template can
        // carry one line. A shut 24-hour window costs one refused send,
        // which Meta does not bill.
        let r = await sendWaWithFailover({
          primaryMobile: family.mobile,
          fallbackMobile: family.household.altMobile || undefined,
          body: homeworkWaBody({ expansion, language, schoolName: TENANT.nameDisplay }),
          clientMessageId: `homework:${post.id}:${family.household.id}`,
        });
        let via: "text" | "template" = "text";
        let templateName = "";

        if (!r.ok && /24h|window|session/i.test(r.error || "")) {
          const resolved = resolveTemplateForSend({ state, familyKey: choice.familyKey, language });
          if (!resolved.ok) {
            // Named, not swallowed: a template that is approved at Meta and
            // stale here reads as a 24-hour-window error, which points at
            // the wrong thing entirely.
            console.warn("[homeworkWa] no usable template:", resolved.reason);
            skipped += 1;
            continue;
          }
          // templateVariablePositions fills only the names this template's
          // body actually uses, so the same map serves both families — and
          // substitutes an em dash for anything missing, which is why the
          // chapter line is allowed to come back empty.
          const values = templateVariablePositions(resolved.template, {
            classLabel: input.classLabel,
            subject: input.subjectLabel,
            // Subject first, so the line is complete on its own and carries
            // the subject even when no book resolved. "📘 —" reads like
            // something went wrong, and repeating the subject in the
            // greeting as well only to repeat it here reads like a machine.
            chapterLine: [input.subjectLabel, chapterLine].filter(Boolean).join(" · "),
            // With its own chapter line above it, the work no longer has to
            // carry the chapter too.
            homeworkTitle: choice.withChapter ? post.title || homeworkWaLine(post) : homeworkWaLine(post),
            dueDate: homeworkWaDue(post.dueAt, language),
            schoolName: TENANT.nameDisplay,
          });
          templateName = resolved.template.metaName;
          via = "template";
          r = await sendWaWithFailover({
            primaryMobile: family.mobile,
            fallbackMobile: family.household.altMobile || undefined,
            template: {
              name: templateName,
              language: resolved.template.metaLanguage || resolved.template.language,
              components: [
                {
                  type: "body",
                  parameters: Object.keys(values)
                    .sort((a, b) => Number(a) - Number(b))
                    .map((k) => ({ type: "text", text: values[k]! })),
                },
              ],
            },
            fromPhoneNumberId: resolved.sender?.phoneNumberId,
            clientMessageId: `homework:${post.id}:${family.household.id}:t`,
          });
        }

        if (r.ok) sent += 1;
        else failed += 1;

        await logHouseholdWaSend({
          mobile: family.mobile,
          purpose: HOMEWORK_TEMPLATE_FAMILY,
          via,
          templateName,
          preview: `${input.classLabel} · ${input.subjectLabel} · ${homeworkWaLine(post)}`,
          status: r.ok ? "sent" : "failed",
          error: r.error,
          waMessageId: r.providerId,
        }).catch(() => undefined);
      }
    } finally {
      await releaseSendClaim(`homework:${post.id}`).catch(() => undefined);
    }

    if (sent > 0) await markNotified(post.id, sent);
    return { families: families.length, sent, failed, skipped };
  } catch (e) {
    console.warn("[homeworkWa] dispatch failed", (e as Error)?.message);
    return { ...empty, reason: (e as Error)?.message || "Dispatch failed" };
  }
}
