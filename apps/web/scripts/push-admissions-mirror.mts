/**
 * Push CRM admissions into Supabase admissions_state (canonical) + school mirror.
 *
 * Run from apps/web:
 *   npx tsx scripts/push-admissions-mirror.mts
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  normalizeAdmissionsState,
  type AdmissionsState,
} from "../src/lib/admissions";

type SchoolMirrorBundle = {
  version: 1;
  updatedAt: string;
  sis: unknown | null;
  fees: unknown | null;
  payments: unknown | null;
  masters: unknown | null;
  admissions: AdmissionsState | null;
};

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

function readAdmissionsFromArg(): AdmissionsState {
  const fromIdx = process.argv.indexOf("--from");
  const rel =
    fromIdx >= 0 ? process.argv[fromIdx + 1] : "data/leads/admissions_leads_seed.json";
  const file = resolve(process.cwd(), rel || "data/leads/admissions_leads_seed.json");
  const raw = JSON.parse(readFileSync(file, "utf8")) as {
    state?: Partial<AdmissionsState>;
  };
  if (!raw.state) {
    throw new Error(`No state in ${file}`);
  }
  return normalizeAdmissionsState(raw.state);
}

async function main() {
  const env = loadEnv();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
    process.exit(1);
  }

  const admissions = readAdmissionsFromArg();
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const { data: tenant, error: tErr } = await sb
    .from("tenants")
    .select("id, slug")
    .eq("slug", "bhb-international")
    .single();
  if (tErr || !tenant?.id) {
    console.error("Tenant bhb-international missing:", tErr?.message);
    process.exit(1);
  }

  const tenantId = tenant.id as string;
  const now = new Date().toISOString();
  const bytes = Buffer.byteLength(JSON.stringify(admissions));
  console.log(
    `Pushing ${admissions.leads.length} leads (${(bytes / 1024 / 1024).toFixed(2)} MB) to admissions_state…`,
  );

  const { error: admErr } = await sb.from("admissions_state").upsert(
    {
      tenant_id: tenantId,
      state: admissions,
      updated_at: now,
    },
    { onConflict: "tenant_id" },
  );
  if (admErr) {
    console.error(
      "admissions_state upsert failed:",
      admErr.message,
      "\nRun supabase/migrations/20260727130000_admissions_state.sql in the SQL editor first.",
    );
    process.exit(1);
  }

  const { data: mirrorRow } = await sb
    .from("school_mirror_state")
    .select("state")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  const cur = (mirrorRow?.state as SchoolMirrorBundle | null) ?? null;
  const mirrorNext: SchoolMirrorBundle = {
    version: 1,
    updatedAt: now,
    sis: cur?.sis ?? null,
    fees: cur?.fees ?? null,
    payments: cur?.payments ?? null,
    masters: cur?.masters ?? null,
    admissions,
  };

  const { error: mirrorErr } = await sb.from("school_mirror_state").upsert(
    {
      tenant_id: tenantId,
      state: mirrorNext,
      updated_at: now,
    },
    { onConflict: "tenant_id" },
  );
  if (mirrorErr) {
    console.warn("school_mirror_state upsert warning:", mirrorErr.message);
  }

  const { data: check } = await sb
    .from("admissions_state")
    .select("state, updated_at")
    .eq("tenant_id", tenantId)
    .single();

  const leads =
    (check?.state as AdmissionsState | null)?.leads?.length ?? 0;
  console.log(
    JSON.stringify(
      {
        ok: true,
        tenantId,
        table: "admissions_state",
        leadCount: leads,
        householdCount:
          (check?.state as AdmissionsState | null)?.households?.length ?? 0,
        updatedAt: check?.updated_at,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
