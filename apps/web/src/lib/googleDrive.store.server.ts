/**
 * Google Drive connection store — Supabase-backed (public.google_drive_connection),
 * not disk. See docs/GOOGLE_DRIVE_DOCUMENTS_PLAN.md — deliberately not following
 * googleClassroom.store.server.ts's .data/*.json pattern, which does not survive
 * Cloud Run's ephemeral filesystem.
 */

import { getServerTenantContext } from "@/lib/serverTenant";

export type GoogleDriveConnection = {
  email: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  connectedBy: string | null;
  connectedAt: string;
  updatedAt: string;
};

function rowToConnection(row: {
  email: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  connected_by: string | null;
  connected_at: string;
  updated_at: string;
}): GoogleDriveConnection {
  return {
    email: row.email,
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    expiresAt: row.expires_at,
    connectedBy: row.connected_by,
    connectedAt: row.connected_at,
    updatedAt: row.updated_at,
  };
}

export async function getDriveConnection(): Promise<GoogleDriveConnection | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const { data, error } = await ctx.sb
    .from("google_drive_connection")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();
  if (error || !data) return null;
  return rowToConnection(data);
}

export async function upsertDriveConnection(input: {
  email: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  connectedBy?: string | null;
}): Promise<boolean> {
  const ctx = await getServerTenantContext();
  if (!ctx) return false;
  const { error } = await ctx.sb.from("google_drive_connection").upsert(
    {
      tenant_id: ctx.tenantId,
      email: input.email,
      access_token: input.accessToken,
      refresh_token: input.refreshToken,
      expires_at: input.expiresAt,
      connected_by: input.connectedBy ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id" },
  );
  return !error;
}

/** Update just the access token after a refresh — leaves refresh_token untouched. */
export async function updateDriveAccessToken(
  accessToken: string,
  expiresAt: string,
): Promise<boolean> {
  const ctx = await getServerTenantContext();
  if (!ctx) return false;
  const { error } = await ctx.sb
    .from("google_drive_connection")
    .update({
      access_token: accessToken,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", ctx.tenantId);
  return !error;
}
