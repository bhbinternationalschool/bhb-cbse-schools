/**
 * Smoke-test SIS + curriculum remote sync against live Supabase (service role).
 * Run: cd apps/web && npx tsx scripts/smoke-sis-remote.mts
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnv() {
  const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  const env: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    env[t.slice(0, i)] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

const env = loadEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing Supabase URL / service role");
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed += 1;
    console.error("FAIL:", msg);
  } else console.log("ok:", msg);
}

async function main() {
  const { data: tenant, error: tErr } = await sb
    .from("tenants")
    .select("id, slug")
    .eq("slug", "bhb-international")
    .single();
  assert(!tErr && !!tenant?.id, `tenant bhb-international (${tErr?.message ?? "ok"})`);
  if (!tenant?.id) process.exit(1);
  const tenantId = tenant.id as string;

  const hhId = `hh_smoke_${Date.now()}`;
  const stuId = `stu_smoke_${Date.now()}`;

  const { error: hhErr } = await sb.from("sis_households").upsert({
    id: hhId,
    tenant_id: tenantId,
    code: "SMOKE1",
    guardian_name: "Smoke Guardian",
    mobile: "9999999999",
    whatsapp_mobile: "9999999999",
    city: "Varanasi",
    state: "Uttar Pradesh",
  });
  assert(!hhErr, `upsert household (${hhErr?.message ?? "ok"})`);

  const { error: stuErr } = await sb.from("sis_students").upsert({
    id: stuId,
    tenant_id: tenantId,
    admission_no: `SMOKE-${Date.now()}`,
    full_name: "Smoke Student",
    status: "active",
    class_id: "cls_smoke",
    academic_year_code: "2025-26",
    student_type: "NEW",
    household_id: hhId,
  });
  assert(!stuErr, `upsert student (${stuErr?.message ?? "ok"})`);

  const { error: curErr } = await sb.from("student_curriculum").upsert(
    {
      tenant_id: tenantId,
      student_key: stuId,
      academic_year_code: "2025-26",
      chosen_subject_ids: ["sub_a", "sub_b"],
      confirmed_at: new Date().toISOString(),
      confirmed_by: "office",
    },
    { onConflict: "tenant_id,student_key,academic_year_code" },
  );
  assert(!curErr, `upsert curriculum (${curErr?.message ?? "ok"})`);

  const { data: pulled, error: pErr } = await sb
    .from("sis_students")
    .select("id, full_name")
    .eq("id", stuId)
    .single();
  assert(!pErr && pulled?.full_name === "Smoke Student", "pull student");

  const { data: cur, error: cErr } = await sb
    .from("student_curriculum")
    .select("chosen_subject_ids")
    .eq("student_key", stuId)
    .single();
  assert(
    !cErr && Array.isArray(cur?.chosen_subject_ids) && cur!.chosen_subject_ids.length === 2,
    "pull curriculum",
  );

  // cleanup
  await sb.from("student_curriculum").delete().eq("student_key", stuId);
  await sb.from("sis_students").delete().eq("id", stuId);
  await sb.from("sis_households").delete().eq("id", hhId);
  console.log("cleaned smoke rows");

  if (failed) {
    console.error(`\n${failed} failed`);
    process.exit(1);
  }
  console.log("\nSmoke remote sync passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
