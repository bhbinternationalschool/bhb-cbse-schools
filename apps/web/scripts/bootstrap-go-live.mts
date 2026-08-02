/**
 * Go-live bootstrap — link super admin, seed RBAC blob, verify Supabase.
 *
 * Run from apps/web:
 *   npx tsx scripts/bootstrap-go-live.mts
 *   npx tsx scripts/bootstrap-go-live.mts --email director@bhbinternational.school
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

function parseEmails(env: Record<string, string>, flagEmail?: string): string[] {
  if (flagEmail) return [flagEmail.trim().toLowerCase()];
  const raw = env.PROTECTED_SUPER_ADMIN_EMAILS || "";
  const list = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (list.length) return list;
  return ["director@bhbinternational.school"];
}

async function findAuthUserId(
  sb: ReturnType<typeof createClient>,
  email: string,
): Promise<string | null> {
  const { data, error } = await sb.auth.admin.listUsers({ perPage: 1000 });
  if (error) {
    console.warn("auth listUsers:", error.message);
    return null;
  }
  const hit = data.users.find(
    (u) => (u.email || "").toLowerCase() === email.toLowerCase(),
  );
  return hit?.id ?? null;
}

async function main() {
  const flagEmail = process.argv.find((a) => a.includes("@"));
  const env = loadEnv();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const emails = parseEmails(env, flagEmail);
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const { data: tenant, error: tErr } = await sb
    .from("tenants")
    .select("id, slug, name")
    .eq("slug", "bhb-international")
    .single();
  if (tErr || !tenant?.id) {
    console.error("Tenant bhb-international missing. Run supabase migrations first.");
    process.exit(1);
  }
  const tenantId = tenant.id as string;
  console.log("Tenant:", tenant.name, tenantId);

  let ownerRoleId: string | undefined;
  const { data: ownerRole } = await sb
    .from("roles")
    .select("id, code")
    .eq("code", "owner")
    .maybeSingle();
  ownerRoleId = ownerRole?.id as string | undefined;
  if (!ownerRoleId) {
    console.warn(
      "  roles.owner not readable via API — app RBAC blob will still grant owner to super admin emails.",
    );
  }

  const { defaultBuiltInRoles } = await import("../src/lib/rbac.ts");
  const rbacSeed = {
    version: 1 as const,
    roles: defaultBuiltInRoles(),
    assignments: [] as unknown[],
    audit: [
      {
        id: `audit_bootstrap_${Date.now()}`,
        at: new Date().toISOString(),
        by: "bootstrap-go-live",
        action: "seed_rbac",
        detail: "Default built-in roles for go-live",
      },
    ],
  };

  const { error: rbacErr } = await sb.from("rbac_state").upsert(
    {
      tenant_id: tenantId,
      state: rbacSeed,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id" },
  );
  if (rbacErr) {
    console.warn("rbac_state upsert:", rbacErr.message);
  } else {
    console.log("ok: rbac_state seeded with built-in roles");
  }

  for (const email of emails) {
    console.log("\n— Super admin:", email);
    let authUserId = await findAuthUserId(sb, email);

    if (!authUserId) {
      console.warn(
        `  No Supabase Auth user for ${email}. Create in Supabase Dashboard → Authentication, then re-run.`,
      );
    }

    const { data: existingProfile } = await sb
      .from("profiles")
      .select("id, auth_user_id, email, full_name")
      .eq("tenant_id", tenantId)
      .ilike("email", email)
      .maybeSingle();

    let profileId = existingProfile?.id as string | undefined;

    if (!profileId) {
      const { data: created, error: pErr } = await sb
        .from("profiles")
        .insert({
          tenant_id: tenantId,
          auth_user_id: authUserId,
          full_name: "Director",
          email,
          persona: "staff",
          is_active: true,
        })
        .select("id")
        .single();
      if (pErr) {
        console.error("  profile insert:", pErr.message);
        continue;
      }
      profileId = created?.id as string;
      console.log("  ok: profile created", profileId);
    } else {
      const { error: upErr } = await sb
        .from("profiles")
        .update({
          auth_user_id: authUserId ?? existingProfile?.auth_user_id,
          email,
          is_active: true,
          persona: "staff",
          full_name: existingProfile?.full_name || "Director",
          updated_at: new Date().toISOString(),
        })
        .eq("id", profileId);
      if (upErr) console.warn("  profile update:", upErr.message);
      else console.log("  ok: profile linked", profileId);
    }

    if (profileId && ownerRoleId) {
      const { error: aErr } = await sb.from("user_role_assignments").upsert(
        {
          profile_id: profileId,
          role_id: ownerRoleId,
          is_primary: true,
        },
        { onConflict: "profile_id,role_id" },
      );
      if (aErr) console.warn("  owner assignment:", aErr.message);
      else console.log("  ok: owner role assigned in Supabase");
    } else if (profileId) {
      console.log("  ok: profile ready (owner role via app RBAC for super admin email)");
    }
  }

  console.log("\nEnsuring desk cutover (backfill + seed)…");
  const { ensureDeskCutoverServer } = await import(
    "../src/lib/ensureDeskCutover.server"
  );
  const desk = await ensureDeskCutoverServer();
  const changed = desk.actions.filter((a) => a.action !== "skip");
  if (changed.length) {
    for (const a of changed) {
      console.log(`  ${a.module}: ${a.action} — ${a.detail}`);
    }
  } else {
    console.log("  desk already up to date");
  }

  console.log("\nDone. Next:");
  console.log("  1) Sign in as director (demo or Supabase Auth)");
  console.log("  2) Masters → Roles & permissions → Assignments");
  console.log("  3) npm run ensure:desk  (backfill desk + validate)");
  console.log("  4) ./scripts/deploy-online.sh");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
