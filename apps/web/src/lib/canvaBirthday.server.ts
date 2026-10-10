import "server-only";

/**
 * Birthday card made from the school's own Canva design.
 *
 * Once per person per day: read the design's fields, fill them (name, class,
 * photo …) as a new Canva design, export it as PNG, keep the PNG in the
 * private bucket and remember it in birthday_canva_cards. The signed card URL
 * the greeting sends then streams that file, so WhatsApp fetching it twice
 * never makes a second card.
 *
 * Any failure returns { ok: false } and the caller sends the built-in card
 * instead — a child is never left without a greeting because of Canva.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { getServerTenantContext } from "@/lib/serverTenant";
import { sanitizeMediaPath } from "@/lib/media";
import { TENANT } from "@/lib/types";
import {
  autofillCanvaDesign,
  exportCanvaPng,
  getCanvaDesignDataset,
  uploadCanvaAsset,
  appBase,
  type CanvaAutofillData,
} from "@/lib/canva.server";
import { canvaSubjectKey, planCanvaFill, type CanvaCardValues, type CanvaFillPlan } from "@/lib/canvaBirthday";
import { findBirthdayCardSubject, readBirthdayState } from "@/lib/birthday.server";
import { birthdayCardSigner } from "@/lib/birthdayCards";

const BUCKET = "school-files";

export type CanvaCardSubject = { subject: "student" | "staff"; id: string; date: string; age?: number | null };

/** The default line under the name when the office set none — same spirit as the built-in cards. */
const DEFAULT_WISH = "Wishing you a wonderful year ahead!";

function dateLabelFor(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
}

/** Everything the ERP can say about this birthday, plus the photo URL. */
export async function canvaCardValues(s: CanvaCardSubject, wish: string): Promise<{ values: CanvaCardValues; photoUrl: string } | { error: string }> {
  const subject = await findBirthdayCardSubject(s.subject === "staff" ? { date: s.date, staffId: s.id } : { date: s.date, studentId: s.id });
  if (!subject.ok) return { error: subject.error };
  return {
    photoUrl: subject.photoUrl,
    values: {
      name: subject.studentName,
      className: subject.className,
      age: s.age ?? null,
      wish: wish || DEFAULT_WISH,
      schoolName: TENANT.nameDisplay,
      dateLabel: dateLabelFor(s.date),
      // The short form: a designed card's signature box fits "Principal",
      // not "With warm wishes — Principal" (it was cut off on the first test card).
      signature: birthdayCardSigner((await readBirthdayState()).settings, s.subject),
    },
  };
}

let crestBytes: Uint8Array | null = null;
async function crest(): Promise<Uint8Array | null> {
  if (crestBytes) return crestBytes;
  try {
    crestBytes = new Uint8Array(await fs.readFile(path.join(process.cwd(), "public", "logo-crest.png")));
  } catch {
    try {
      const r = await fetch(`${appBase()}/logo-crest.png`);
      if (r.ok) crestBytes = new Uint8Array(await r.arrayBuffer());
    } catch {
      /* none */
    }
  }
  return crestBytes;
}

/** The person's photo, or null when there is none or it can't be fetched (the crest stands in). */
async function photoBytes(photoUrl: string): Promise<Uint8Array | null> {
  if (!photoUrl) return null;
  const url = photoUrl.startsWith("http") ? photoUrl : `${appBase()}${photoUrl.startsWith("/") ? "" : "/"}${photoUrl}`;
  try {
    const r = await fetch(url);
    const type = r.headers.get("content-type") || "";
    if (!r.ok || !type.startsWith("image/")) return null;
    return new Uint8Array(await r.arrayBuffer());
  } catch {
    return null;
  }
}

async function buildData(plan: CanvaFillPlan, photoUrl: string, label: string): Promise<CanvaAutofillData> {
  const data: CanvaAutofillData = {};
  for (const [field, text] of Object.entries(plan.text)) data[field] = { type: "text", text };
  const needs = new Set(Object.values(plan.images));
  let photoAsset = "";
  let crestAsset = "";
  if (needs.has("photo")) {
    const bytes = await photoBytes(photoUrl);
    if (bytes) photoAsset = await uploadCanvaAsset(bytes, `${label} photo`);
  }
  if (needs.has("logo") || (needs.has("photo") && !photoAsset)) {
    const bytes = await crest();
    if (bytes) crestAsset = await uploadCanvaAsset(bytes, "School crest");
  }
  for (const [field, kind] of Object.entries(plan.images)) {
    const asset = kind === "photo" ? photoAsset || crestAsset : crestAsset;
    if (asset) data[field] = { type: "image", asset_id: asset };
  }
  return data;
}

export type CanvaCardResult =
  | { ok: true; storagePath: string; canvaDesignId: string; reused: boolean; usesRemaining: number | null; plan: CanvaFillPlan | null }
  | { ok: false; error: string };

/**
 * The card for this person on this day from this design — made now, or the
 * one already made. `force` makes a fresh one (the office's "test card").
 */
export async function ensureCanvaBirthdayCard(s: CanvaCardSubject, sourceDesignId: string, wish: string, force = false): Promise<CanvaCardResult> {
  try {
    const ctx = await getServerTenantContext();
    if (!ctx) return { ok: false, error: "Tenant not configured" };
    const { sb, tenantId } = ctx;
    const subjectKey = canvaSubjectKey(s.subject, s.id);

    if (!force) {
      const { data: row } = await sb
        .from("birthday_canva_cards")
        .select("storage_path, canva_design_id")
        .eq("tenant_id", tenantId)
        .eq("subject_key", subjectKey)
        .eq("date", s.date)
        .eq("canva_source_design_id", sourceDesignId)
        .maybeSingle();
      if (row?.storage_path) {
        return { ok: true, storagePath: String(row.storage_path), canvaDesignId: String(row.canva_design_id || ""), reused: true, usesRemaining: null, plan: null };
      }
    }

    const v = await canvaCardValues(s, wish);
    if ("error" in v) return { ok: false, error: v.error };
    const dataset = await getCanvaDesignDataset(sourceDesignId);
    if (!Object.keys(dataset).length) {
      return { ok: false, error: "This Canva design has no data fields — connect fields such as name and class with Canva's Bulk create (Apps → Bulk create)" };
    }
    const plan = planCanvaFill(dataset, v.values);
    if (!Object.keys(plan.text).length && !Object.keys(plan.images).length) {
      return { ok: false, error: `None of the design's fields are ones the ERP fills (${Object.keys(dataset).join(", ")})` };
    }
    const data = await buildData(plan, v.photoUrl, v.values.name);
    const filled = await autofillCanvaDesign(sourceDesignId, `Birthday · ${v.values.name} · ${s.date}`, data);
    const png = await exportCanvaPng(filled.designId);

    const storagePath = sanitizeMediaPath(`birthday-cards/${s.date}/${subjectKey.replace(":", "-")}-${sourceDesignId}.png`);
    const up = await sb.storage.from(BUCKET).upload(storagePath, Buffer.from(png), { contentType: "image/png", upsert: true, cacheControl: "86400" });
    if (up.error) return { ok: false, error: `Card made in Canva but not saved: ${up.error.message}` };

    const { error } = await sb.from("birthday_canva_cards").upsert(
      {
        tenant_id: tenantId,
        subject_key: subjectKey,
        date: s.date,
        canva_source_design_id: sourceDesignId,
        canva_design_id: filled.designId,
        storage_path: storagePath,
        created_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id,subject_key,date,canva_source_design_id" },
    );
    if (error) return { ok: false, error: `Card saved but not recorded: ${error.message}` };
    return { ok: true, storagePath, canvaDesignId: filled.designId, reused: false, usesRemaining: filled.usesRemaining, plan };
  } catch (e) {
    return { ok: false, error: (e as Error)?.message || "Canva card failed" };
  }
}

/** The stored PNG for a card URL, or null (the route then draws the built-in card). */
export async function readCanvaBirthdayCard(subject: "student" | "staff", id: string, date: string, sourceDesignId: string): Promise<Uint8Array | null> {
  if (!sourceDesignId) return null;
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const { data: row } = await ctx.sb
    .from("birthday_canva_cards")
    .select("storage_path")
    .eq("tenant_id", ctx.tenantId)
    .eq("subject_key", canvaSubjectKey(subject, id))
    .eq("date", date)
    .eq("canva_source_design_id", sourceDesignId)
    .maybeSingle();
  if (!row?.storage_path) return null;
  const { data, error } = await ctx.sb.storage.from(BUCKET).download(String(row.storage_path));
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}
