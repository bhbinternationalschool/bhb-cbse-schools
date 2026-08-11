/**
 * Document vault desk — Supabase normalized tables (vault_desk_*).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  VaultDocType,
  VaultDocument,
  VaultSettings,
  VaultState,
} from "@/lib/vault";
import { vaultDualWriteDbEnabled } from "@/lib/vaultDbConfig";
import { getServerTenantContext } from "@/lib/serverTenant";

export type VaultDeskSyncMeta = {
  documentCount: number;
  expiringSoonCount: number;
  lastDocumentAt: string | null;
  updatedAt: string;
};

export type VaultDeskBundle = {
  documents: VaultDocument[];
  settings: VaultSettings;
};

const META_SELECT =
  "document_count, expiring_soon_count, last_document_at, updated_at";

async function resolveCtx(): Promise<{
  sb: SupabaseClient;
  tenantId: string;
} | null> {
  return getServerTenantContext();
}

/**
 * Delete rows the client no longer holds — never on an empty payload.
 *
 * An empty keep-set means every stored row is "stale", so this deleted the
 * entire table. That is never what a sync means: a client with nothing to say
 * is a client whose cache was dropped, not an instruction to erase the
 * school's records.
 *
 * It is not hypothetical. On 2026-08-11 the attendance register for the
 * previous day was gone — pushed away by a phone whose localStorage had been
 * dropped on quota, with the emptiness check running AFTER the delete. This
 * same function is copied into 20 modules and called from 86 places, almost
 * none of them guarded, covering bank and cash ledgers, payroll runs, fee
 * cheques, library issues and 1,919 admission records.
 *
 * This floor stops the catastrophic case everywhere at once. It does NOT make
 * a partial payload safe — a client holding 3 of 900 rows still prunes 897.
 * That needs per-module scoping, the way attendance now prunes only within
 * the dates its payload covers. See docs/TODO.md.
 *
 * The read error is also surfaced now. It was discarded, which happened to
 * fail safe here (no data → nothing deleted), but "we could not read the
 * table" and "the table is empty" must not be the same value in a function
 * that deletes.
 */
async function deleteStale(
  sb: SupabaseClient,
  tenantId: string,
  table: string,
  keepIds: Set<string>,
) {
  if (keepIds.size === 0) {
    console.warn(
      `[${table}] refusing to prune: the payload holds no ids at all. ` +
        "An empty client is not an instruction to delete every row.",
    );
    return;
  }
  const { data, error } = await sb
    .from(table)
    .select("id")
    .eq("tenant_id", tenantId);
  if (error) {
    console.error(
      `[${table}] prune skipped — could not read existing ids:`,
      error.message,
    );
    return;
  }
  const stale = (data ?? [])
    .map((r) => String((r as { id: string }).id))
    .filter((id) => !keepIds.has(id));
  if (stale.length > 0) {
    await sb.from(table).delete().in("id", stale);
  }
}

async function upsertChunks(
  sb: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
  chunk = 200,
): Promise<{ ok: boolean; error?: string }> {
  for (let i = 0; i < rows.length; i += chunk) {
    const { error } = await sb.from(table).upsert(rows.slice(i, i + chunk));
    if (error) return { ok: false, error: error.message };
  }
  return { ok: true };
}

function dateOrNull(v: string): string | null {
  const t = (v || "").trim();
  return t ? t.slice(0, 10) : null;
}

function docToRow(tenantId: string, d: VaultDocument): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    id: d.id,
    tenant_id: tenantId,
    doc_type: d.docType,
    title: d.title || "",
    file_url: d.fileUrl || "",
    file_name: d.fileName || "",
    issued_on: dateOrNull(d.issuedOn),
    expires_on: dateOrNull(d.expiresOn),
    reminder_days: d.reminderDays ?? 30,
    owner_role: d.ownerRole || "",
    note: d.note || "",
    created_at: d.createdAt || now,
    updated_at: d.updatedAt || now,
  };
}

function rowToDoc(r: Record<string, unknown>): VaultDocument {
  const docType = String(r.doc_type) as VaultDocType;
  return {
    id: String(r.id),
    docType,
    title: String(r.title || ""),
    fileUrl: String(r.file_url || ""),
    fileName: String(r.file_name || ""),
    issuedOn: r.issued_on ? String(r.issued_on).slice(0, 10) : "",
    expiresOn: r.expires_on ? String(r.expires_on).slice(0, 10) : "",
    reminderDays: Number(r.reminder_days ?? 30),
    ownerRole: String(r.owner_role || ""),
    note: String(r.note || ""),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

function countExpiringSoon(docs: VaultDocument[]): number {
  const today = new Date().toISOString().slice(0, 10);
  return docs.filter((d) => {
    if (!d.expiresOn) return false;
    const remindFrom = new Date(d.expiresOn);
    remindFrom.setDate(remindFrom.getDate() - (d.reminderDays || 30));
    const remindYmd = remindFrom.toISOString().slice(0, 10);
    return today >= remindYmd && d.expiresOn >= today;
  }).length;
}

export async function pushVaultDeskToDb(
  state: VaultState,
): Promise<{ ok: boolean; error?: string }> {
  if (!vaultDualWriteDbEnabled()) return { ok: true };
  const ctx = await resolveCtx();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };
  const { sb, tenantId } = ctx;
  const now = new Date().toISOString();

  const documents = state.documents ?? [];
  const settings = state.settings ?? { digestMobiles: "" };

  await deleteStale(
    sb,
    tenantId,
    "vault_desk_documents",
    new Set(documents.map((d) => d.id)),
  );

  const r = await upsertChunks(
    sb,
    "vault_desk_documents",
    documents.map((d) => docToRow(tenantId, d)),
  );
  if (!r.ok) return r;

  await sb.from("vault_desk_settings").upsert(
    {
      tenant_id: tenantId,
      digest_mobiles: settings.digestMobiles || "",
      last_expiry_digest_at: settings.lastExpiryDigestAt || "",
      updated_at: now,
    },
    { onConflict: "tenant_id" },
  );

  let lastDocumentAt: string | null = null;
  for (const d of documents) {
    const at = d.updatedAt || d.createdAt;
    if (at && (!lastDocumentAt || at > lastDocumentAt)) lastDocumentAt = at;
  }

  await sb.from("vault_desk_sync_meta").upsert(
    {
      tenant_id: tenantId,
      document_count: documents.length,
      expiring_soon_count: countExpiringSoon(documents),
      last_document_at: lastDocumentAt,
      updated_at: now,
    },
    { onConflict: "tenant_id" },
  );

  return { ok: true };
}

export async function fetchVaultDeskFromDb(): Promise<{
  bundle: VaultDeskBundle;
  meta: VaultDeskSyncMeta | null;
  ok: boolean;
}> {
  const ctx = await resolveCtx();
  const empty: VaultDeskBundle = {
    documents: [],
    settings: { digestMobiles: "" },
  };
  if (!ctx) return { bundle: empty, meta: null, ok: false };
  const { sb, tenantId } = ctx;

  const [docRes, settingsRes, metaRes] = await Promise.all([
    sb.from("vault_desk_documents").select("*").eq("tenant_id", tenantId),
    sb
      .from("vault_desk_settings")
      .select("digest_mobiles, last_expiry_digest_at")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    sb
      .from("vault_desk_sync_meta")
      .select(META_SELECT)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);

  if (docRes.error || settingsRes.error || metaRes.error) {
    console.warn(
      "[vault-db] fetchVaultDeskFromDb query error",
      docRes.error || settingsRes.error || metaRes.error,
    );
    return { bundle: empty, meta: null, ok: false };
  }

  const docRows = docRes.data;
  const settingsRow = settingsRes.data;
  const metaRow = metaRes.data;

  const settingsRowTyped = settingsRow as {
    digest_mobiles?: string;
    last_expiry_digest_at?: string;
  } | null;

  return {
    bundle: {
      documents: (docRows ?? []).map((r) => rowToDoc(r as Record<string, unknown>)),
      settings: {
        digestMobiles: String(settingsRowTyped?.digest_mobiles || ""),
        lastExpiryDigestAt:
          String(settingsRowTyped?.last_expiry_digest_at || "") || undefined,
      },
    },
    meta: metaRow
      ? {
          documentCount: (metaRow as { document_count: number }).document_count,
          expiringSoonCount: (metaRow as { expiring_soon_count: number })
            .expiring_soon_count,
          lastDocumentAt: (metaRow as { last_document_at: string | null })
            .last_document_at,
          updatedAt: String((metaRow as { updated_at: string }).updated_at),
        }
      : null,
    ok: true,
  };
}
