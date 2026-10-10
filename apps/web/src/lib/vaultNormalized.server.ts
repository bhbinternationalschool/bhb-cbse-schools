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
import { deleteNamedIds, type NamedDeletes } from "@/lib/deskNamedDeletes.server";
import { getServerTenantContext } from "@/lib/serverTenant";
import { fetchAllPages } from "@/lib/supabase/pageAll";
import {
  settingsStampOf,
  writeDeskRows,
  writeDeskSettings,
  type StampedDeskPushResult,
} from "@/lib/deskStamps.server";
import { stampsOf } from "@/lib/rowStampWrite.server";
import type { RowConflicts, RowStamps } from "@/lib/rowStampClient";

/** Vault lists saved row by row with stamps (10 Oct 2026). */
export const VAULT_STAMPED_SLICES = ["documents"] as const;

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

/** The only vault table a desk save deletes from — by named id. */
export const VAULT_DELETABLE_TABLES = ["vault_desk_documents"] as const;

/**
 * Save the vault desk. Stamped (`opts.stamps`): only the documents named,
 * each at the stamp the browser loaded. Unstamped (older tabs, the one-time
 * blob cutover): new documents only (deskStamps.server).
 */
export async function pushVaultDeskToDb(
  state: VaultState,
  deletes: NamedDeletes = {},
  opts: { stamps?: RowStamps; settingsBase?: string | null } = {},
): Promise<StampedDeskPushResult> {
  if (!vaultDualWriteDbEnabled()) return { ok: true };
  const ctx = await resolveCtx();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };
  const { sb, tenantId } = ctx;
  const now = new Date().toISOString();

  const gone = new Set(deletes["vault_desk_documents"] ?? []);
  const documents = (state.documents ?? []).filter((d) => !gone.has(d.id));
  const settings = state.settings ?? { digestMobiles: "" };

  const stamped = opts.stamps !== undefined;
  const conflicts: RowConflicts = {};
  const w = await writeDeskRows(
    sb,
    tenantId,
    "vault_desk_documents",
    documents.map((d) => docToRow(tenantId, d)),
    stamped ? (opts.stamps!.documents ?? {}) : undefined,
  );
  if (!w.ok) return w;
  if (w.conflicts.length) conflicts.documents = w.conflicts;
  // No prune by absence: a document leaves the vault only when the user
  // deletes it, and that deletion arrives named.
  const del = await deleteNamedIds(sb, tenantId, "vault_desk_documents", [...gone]);
  if (!del.ok) return { ok: false, error: del.error || "vault_desk_documents: delete failed" };

  const set = await writeDeskSettings(
    sb,
    tenantId,
    "vault_desk_settings",
    {
      digest_mobiles: settings.digestMobiles || "",
      last_expiry_digest_at: settings.lastExpiryDigestAt || "",
    },
    stamped,
    opts.settingsBase,
  );
  if (!set.ok) return set;
  if (set.conflict) conflicts.settings = ["settings"];

  // Counted from the table: a stamped save carries only what changed.
  const all = await fetchAllPages<Record<string, unknown>>((from, to) =>
    sb
      .from("vault_desk_documents")
      .select("id, expires_on, reminder_days, created_at, updated_at, doc_type")
      .eq("tenant_id", tenantId)
      .order("id")
      .range(from, to),
  );
  if (!all.error) {
    const stored = all.rows.map((r) => rowToDoc(r));
    let lastDocumentAt: string | null = null;
    for (const d of stored) {
      const at = d.updatedAt || d.createdAt;
      if (at && (!lastDocumentAt || at > lastDocumentAt)) lastDocumentAt = at;
    }
    await sb.from("vault_desk_sync_meta").upsert(
      {
        tenant_id: tenantId,
        document_count: stored.length,
        expiring_soon_count: countExpiringSoon(stored),
        last_document_at: lastDocumentAt,
        updated_at: now,
      },
      { onConflict: "tenant_id" },
    );
  }

  return {
    ok: true,
    stamps: { documents: w.stamps },
    conflicts,
    settingsStamp: set.stamp,
    kept: w.kept,
  };
}

export async function fetchVaultDeskFromDb(): Promise<{
  bundle: VaultDeskBundle;
  meta: VaultDeskSyncMeta | null;
  stamps?: RowStamps;
  settingsStamp?: string;
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
    // Paged: PostgREST stops at 1,000 rows and calls it success.
    fetchAllPages<Record<string, unknown>>((from, to) =>
      sb.from("vault_desk_documents").select("*").eq("tenant_id", tenantId).order("id").range(from, to),
    ).then((r) => ({ data: r.rows, error: r.error ? { message: r.error } : null })),
    sb
      .from("vault_desk_settings")
      .select("digest_mobiles, last_expiry_digest_at, updated_at")
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
    stamps: { documents: stampsOf(docRows as Record<string, unknown>[]) },
    settingsStamp: settingsStampOf(settingsRow),
    ok: true,
  };
}
