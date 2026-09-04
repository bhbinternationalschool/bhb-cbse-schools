import { getServerTenantContext } from "@/lib/serverTenant";
import { deleteDriveFile } from "@/lib/googleDrive.server";
(async () => {
  const ctx = await getServerTenantContext();
  const { data } = await ctx!.sb.from("drive_archive").select("id, drive_file_id").eq("tenant_id", ctx!.tenantId).eq("kind", "receipt");
  let deleted = 0, failed = 0;
  for (const r of (data ?? []) as { id: string; drive_file_id: string }[]) {
    if (r.drive_file_id) { const d = await deleteDriveFile(r.drive_file_id); if (!d.ok) { failed++; continue; } deleted++; }
    await ctx!.sb.from("drive_archive").delete().eq("id", r.id);
  }
  console.log(`purged: deleted ${deleted}, failed ${failed}`);
})();
