/**
 * One-off: send the UDISE+ / APAAR message (udiseNudge.ts) now to every
 * parent inside WhatsApp's 24-hour window whose child has an open UDISE+ gap.
 *
 *   npx tsx scripts/udise-nudge-window.mts            # dry run: prints, sends nothing
 *   npx tsx scripts/udise-nudge-window.mts --send     # sends
 *
 * Same rules as the live path: the family's language, only what each child
 * needs, never mid exam drill, never at night, never someone who said STOP,
 * never a family already sent it in the last 7 days. Reads the database;
 * writes nothing to it — the sends are recorded afterwards from the JSON
 * this prints (household_message_log, purpose udise_nudge).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

import { composeUdiseNudge, udiseNudgeLogLine, udiseNudgeNeeds } from "../src/lib/udiseNudge";

const SEND = process.argv.includes("--send");
const env = Object.fromEntries(
  readFileSync(path.join(process.cwd(), ".env.local"), "utf8")
    .split("\n")
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]),
);
const TENANT = "6558f3c4-6d12-4636-bf53-17423b0eaad3";
const AY = "2026-27";
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const last10 = (s: string | null | undefined) => (s || "").replace(/\D/g, "").slice(-10);
const blank = (s: string | null | undefined) => /^\s*$|^(na|n\/a|nil|null|none|-+|\*+|0+)$/i.test(s || "");

async function all<T>(q: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await q(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

const now = new Date();
const istHour = new Date(now.getTime() + 5.5 * 3600_000).getUTCHours();
if (istHour >= 20 || istHour < 8) throw new Error(`It is ${istHour}:00 IST — not sending at night.`);
const since = new Date(now.getTime() - 24 * 3600_000).toISOString();

type Win = { mobile_e164: string; last_inbound_at: string; opted_out_at: string | null };
const win = (await all<Win>((a, b) => sb.from("wa_contact_state").select("mobile_e164,last_inbound_at,opted_out_at").eq("tenant_id", TENANT).gt("last_inbound_at", since).range(a, b)))
  .filter((w) => !w.opted_out_at);
type Stu = { id: string; full_name: string; household_id: string; class_id: string; section_id: string; pen: string; apaar_id: string; aadhaar_last4: string; father_aadhaar_last4: string; mother_aadhaar_last4: string; dob: string | null; father_mobile: string; mother_mobile: string; profile: Record<string, string> | null; status: string };
const students = await all<Stu>((a, b) => sb.from("sis_students").select("id,full_name,household_id,class_id,section_id,pen,apaar_id,aadhaar_last4,father_aadhaar_last4,mother_aadhaar_last4,dob,father_mobile,mother_mobile,profile,status").eq("tenant_id", TENANT).eq("academic_year_code", AY).eq("status", "active").range(a, b));
type Hh = { id: string; guardian_name: string; mobile: string; whatsapp_mobile: string; alt_mobile: string; address: string; pincode: string; preferred_language: string };
const households = await all<Hh>((a, b) => sb.from("sis_households").select("id,guardian_name,mobile,whatsapp_mobile,alt_mobile,address,pincode,preferred_language").eq("tenant_id", TENANT).range(a, b));
const classes = await all<{ id: string; name: string }>((a, b) => sb.from("masters_desk_classes").select("id,name").eq("tenant_id", TENANT).range(a, b));
const sections = await all<{ id: string; name: string }>((a, b) => sb.from("masters_desk_sections").select("id,name").eq("tenant_id", TENANT).range(a, b));
const today = new Date(now.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
const drills = await all<{ mobile10: string }>((a, b) => sb.from("exam_drill_sessions").select("mobile10").eq("tenant_id", TENANT).is("ended_at", null).gte("paper_date", today).range(a, b));
const inDrill = new Set(drills.map((d) => d.mobile10));
const recent = await all<{ household_id: string }>((a, b) =>
  sb.from("household_message_log").select("household_id").eq("tenant_id", TENANT).eq("status", "sent")
    .or("purpose.eq.udise_nudge,template_name.eq.bhb_udise_docs_request")
    .gt("created_at", new Date(now.getTime() - 7 * 86400_000).toISOString()).range(a, b));
const recentlyAsked = new Set(recent.map((r) => r.household_id));

const cls = new Map(classes.map((c) => [c.id, c.name]));
const sec = new Map(sections.map((s) => [s.id, s.name]));
const hhById = new Map(households.map((h) => [h.id, h]));
const numToHh = new Map<string, string>();
for (const h of households) for (const n of [h.mobile, h.whatsapp_mobile, h.alt_mobile]) if (last10(n).length === 10) numToHh.set(last10(n), h.id);
for (const s of students) for (const n of [s.father_mobile, s.mother_mobile]) if (last10(n).length === 10 && !numToHh.has(last10(n))) numToHh.set(last10(n), s.household_id);

function gapsOf(s: Stu): string[] {
  const hasPen = !blank(s.pen);
  const hasApaar = !blank(s.apaar_id);
  if (hasPen && hasApaar) return [];
  const p = s.profile ?? {};
  const g: string[] = [];
  const hasAadhaar = /\d{4}/.test(s.aadhaar_last4 || "") || /\d{12}/.test(p.aadhaarNumber || "");
  if (!hasAadhaar) g.push("student_aadhaar");
  else if (p.aadhaarVerification !== "verified_udise") g.push("student_aadhaar_unverified");
  if (!hasPen) g.push("pen");
  if (!hasApaar) g.push("apaar");
  const parent = [s.father_aadhaar_last4, s.mother_aadhaar_last4].some((x) => /\d{4}/.test(x || "")) || [p.fatherAadhaarNumber, p.motherAadhaarNumber].some((x) => /\d{12}/.test(x || ""));
  if (!hasApaar && !parent) g.push("parent_aadhaar");
  return g;
}

// One number per family: the one that wrote most recently.
const byHh = new Map<string, Win>();
for (const w of win.sort((a, b) => b.last_inbound_at.localeCompare(a.last_inbound_at))) {
  const hh = numToHh.get(last10(w.mobile_e164));
  if (hh && !byHh.has(hh)) byHh.set(hh, w);
}

type Plan = { hh: string; mobile: string; guardian: string; lang: "en" | "hi"; closesIst: string; text: string; log: string; attach: boolean; skip: string };
const plans: Plan[] = [];
for (const [hhId, w] of byHh) {
  const h = hhById.get(hhId);
  const kids = students.filter((s) => s.household_id === hhId);
  const lang: "en" | "hi" = h?.preferred_language === "en" ? "en" : "hi";
  const needs = udiseNudgeNeeds(
    kids.map((s) => ({
      name: s.full_name,
      classLabel: `${cls.get(s.class_id) ?? ""} ${sec.get(s.section_id) ?? ""}`.trim(),
      gaps: gapsOf(s),
      hasDob: !!s.dob,
      hasAddress: !!(h?.address && h?.pincode) || !!(s.profile?.permanentAddress),
    })),
    lang,
  );
  if (!needs.length) continue;
  const m10 = last10(w.mobile_e164);
  const closes = new Date(Date.parse(w.last_inbound_at) + 24 * 3600_000 + 5.5 * 3600_000).toISOString().slice(11, 16);
  const skip = inDrill.has(m10) ? "exam drill open" : recentlyAsked.has(hhId) ? "asked in the last 7 days" : "";
  const attach = needs.some((n) => n.consent);
  plans.push({
    hh: hhId, mobile: m10, guardian: h?.guardian_name || "", lang, closesIst: closes, attach, skip,
    text: composeUdiseNudge({ guardianName: (h?.guardian_name || "").replace(/^(MR|MRS|MS)\.?\s+/i, "").replace(/\s+/g, " ").trim(), needs, language: lang, consentAttached: attach }),
    log: udiseNudgeLogLine(needs),
  });
}

const toSend = plans.filter((p) => !p.skip);
console.log(`In window: ${win.length} numbers · families with an open child: ${plans.length} · to send: ${toSend.length} · skipped: ${plans.length - toSend.length}`);
for (const p of plans.filter((x) => x.skip)) console.log(`  SKIP ${p.guardian} (${p.mobile}): ${p.skip}`);
for (const p of toSend) console.log(`  ${p.mobile} · window closes ${p.closesIst} IST · ${p.lang} · ${p.log}`);
console.log("\n--- sample ---\n" + (toSend[0]?.text ?? ""));

if (!SEND) {
  console.log("\nDry run. Nothing sent. Re-run with --send.");
  process.exit(0);
}

const ver = env.WHATSAPP_GRAPH_VERSION || "v21.0";
const phoneId = env.WHATSAPP_PHONE_ID!;
const token = env.WHATSAPP_TOKEN!;
const graph = (p: string, body: BodyInit, json = true) =>
  fetch(`https://graph.facebook.com/${ver}/${phoneId}/${p}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, ...(json ? { "Content-Type": "application/json" } : {}) },
    body,
  });

// The form is uploaded once and sent by media id.
let mediaId = "";
{
  const fd = new FormData();
  fd.append("messaging_product", "whatsapp");
  fd.append("type", "application/pdf");
  fd.append("file", new Blob([readFileSync(path.join(process.cwd(), "public", "docs", "apaar-consent-refusal-form.pdf"))], { type: "application/pdf" }), "APAAR-Consent-Refusal-Form.pdf");
  const r = await graph("media", fd, false);
  const j = (await r.json()) as { id?: string; error?: { message: string } };
  if (!r.ok || !j.id) throw new Error(`Form upload failed: ${j.error?.message || r.status}`);
  mediaId = j.id;
}

const results: { hh: string; mobile: string; ok: boolean; id: string; docOk: boolean; error: string; log: string }[] = [];
for (const p of toSend) {
  const r = await graph("messages", JSON.stringify({ messaging_product: "whatsapp", to: `91${p.mobile}`, type: "text", text: { body: p.text, preview_url: false } }));
  const j = (await r.json()) as { messages?: { id: string }[]; error?: { message: string } };
  const ok = r.ok && !!j.messages?.[0]?.id;
  let docOk = false;
  if (ok && p.attach) {
    const caption = p.lang === "hi"
      ? "शिक्षा मंत्रालय — APAAR ID सहमति / असहमति फ़ॉर्म (Annexure-1)। भरकर, हस्ताक्षर करके इसकी फ़ोटो भेजें।"
      : "Ministry of Education — APAAR ID consent / refusal form (Annexure-1). Please fill in, sign and send a photo.";
    const d = await graph("messages", JSON.stringify({ messaging_product: "whatsapp", to: `91${p.mobile}`, type: "document", document: { id: mediaId, filename: "APAAR-Consent-Refusal-Form.pdf", caption } }));
    docOk = d.ok;
  }
  results.push({ hh: p.hh, mobile: p.mobile, ok, id: j.messages?.[0]?.id ?? "", docOk, error: j.error?.message ?? "", log: p.log });
  console.log(`${ok ? "SENT" : "FAIL"} ${p.mobile}${p.attach ? (docOk ? " + form" : " (form failed)") : ""}${ok ? "" : ` — ${j.error?.message}`}`);
  await new Promise((res) => setTimeout(res, 400));
}
console.log("\nRESULTS_JSON " + JSON.stringify(results));
