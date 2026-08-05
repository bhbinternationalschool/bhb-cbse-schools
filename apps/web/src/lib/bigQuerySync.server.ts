/**
 * Nightly Supabase Postgres → BigQuery export (tenant-scoped).
 */

import {
  BIGQUERY_SYNC_TABLES,
  type BigQuerySyncTableDef,
} from "@/lib/bigQuerySyncCatalog";
import {
  bigQueryDatasetId,
  bigQueryProjectId,
  bigQuerySyncConfigured,
  ensureBigQueryDataset,
  getBigQueryClient,
} from "@/lib/bigQueryClient.server";
import { closePostgresPool, pgQuery, postgresConfigured } from "@/lib/postgresPool.server";

const INSERT_BATCH = 400;

export type BigQuerySyncTableResult = {
  id: string;
  pgTable: string;
  bqTable: string;
  rowCount: number;
  durationMs: number;
  ok: boolean;
  error?: string;
};

export type BigQuerySyncRunResult = {
  ok: boolean;
  ranAt: string;
  tenantSlug: string;
  tenantId: string;
  dryRun: boolean;
  tables: BigQuerySyncTableResult[];
  error?: string;
};

function tenantSlugFromEnv(): string {
  return (
    process.env.BIGQUERY_TENANT_SLUG?.trim() ||
    process.env.NEXT_PUBLIC_TENANT_SLUG?.trim() ||
    "bhb-international"
  );
}

function serializeCell(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (Buffer.isBuffer(value)) return value.toString("base64");
  if (Array.isArray(value)) return JSON.stringify(value);
  if (typeof value === "object") return JSON.stringify(value);
  return value;
}

function serializeRow(
  row: Record<string, unknown>,
  tenantSlug: string,
  syncedAt: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    tenant_slug: tenantSlug,
    _synced_at: syncedAt,
  };
  for (const [key, value] of Object.entries(row)) {
    out[key] = serializeCell(value);
  }
  return out;
}

async function resolveTenantId(slug: string): Promise<string> {
  const res = await pgQuery<{ id: string }>(
    `select id::text as id from public.tenants where slug = $1 limit 1`,
    [slug],
  );
  const id = res.rows[0]?.id;
  if (!id) {
    throw new Error(`Tenant not found for slug: ${slug}`);
  }
  return id;
}

async function countTenantRows(
  pgTable: string,
  tenantId: string,
): Promise<number> {
  const res = await pgQuery<{ c: string }>(
    `select count(*)::text as c from public.${pgTable} where tenant_id = $1::uuid`,
    [tenantId],
  );
  return Number(res.rows[0]?.c || 0);
}

async function fetchTenantRows(
  def: BigQuerySyncTableDef,
  tenantId: string,
): Promise<Record<string, unknown>[]> {
  const order = def.orderBy ? ` order by ${def.orderBy}` : "";
  const res = await pgQuery<Record<string, unknown>>(
    `select * from public.${def.pgTable} where tenant_id = $1::uuid${order}`,
    [tenantId],
  );
  return res.rows;
}

async function deleteTenantRowsFromBq(
  bqTable: string,
  tenantSlug: string,
): Promise<void> {
  const bq = getBigQueryClient();
  const projectId = bigQueryProjectId();
  const datasetId = bigQueryDatasetId();
  const fq = `\`${projectId}.${datasetId}.${bqTable}\``;

  const [exists] = await bq.dataset(datasetId).table(bqTable).exists();
  if (!exists) return;

  await bq.query({
    query: `delete from ${fq} where tenant_slug = @tenantSlug`,
    params: { tenantSlug },
    location: process.env.BIGQUERY_LOCATION || "asia-south1",
  });
}

async function ensureBqTable(
  bqTable: string,
  sample?: Record<string, unknown>,
): Promise<void> {
  const ds = getBigQueryClient().dataset(bigQueryDatasetId());
  const table = ds.table(bqTable);
  const [exists] = await table.exists();
  if (exists) return;

  const schema = sample
    ? Object.entries(sample).map(([name, value]) => ({
        name,
        type: inferBqType(value),
      }))
    : [
        { name: "tenant_slug", type: "STRING" },
        { name: "_synced_at", type: "TIMESTAMP" },
      ];

  await table.create({ schema });
}

function inferBqType(value: unknown): string {
  if (typeof value === "number") {
    return Number.isInteger(value) ? "INTEGER" : "FLOAT";
  }
  if (typeof value === "boolean") return "BOOL";
  return "STRING";
}

async function insertRowsBq(
  bqTable: string,
  rows: Record<string, unknown>[],
): Promise<void> {
  if (!rows.length) return;

  await ensureBqTable(bqTable, rows[0]);

  const table = getBigQueryClient()
    .dataset(bigQueryDatasetId())
    .table(bqTable);

  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    const batch = rows.slice(i, i + INSERT_BATCH);
    await table.insert(batch, {
      skipInvalidRows: false,
      ignoreUnknownValues: true,
    });
  }
}

async function syncOneTable(opts: {
  def: BigQuerySyncTableDef;
  tenantId: string;
  tenantSlug: string;
  syncedAt: string;
  dryRun: boolean;
}): Promise<BigQuerySyncTableResult> {
  const started = Date.now();
  const base = {
    id: opts.def.id,
    pgTable: opts.def.pgTable,
    bqTable: opts.def.bqTable,
    rowCount: 0,
    durationMs: 0,
    ok: true,
  };

  try {
    if (opts.dryRun) {
      const count = await countTenantRows(opts.def.pgTable, opts.tenantId);
      return { ...base, rowCount: count, durationMs: Date.now() - started };
    }

    const raw = await fetchTenantRows(opts.def, opts.tenantId);
    const rows = raw.map((r) =>
      serializeRow(r, opts.tenantSlug, opts.syncedAt),
    );

    await deleteTenantRowsFromBq(opts.def.bqTable, opts.tenantSlug);
    await insertRowsBq(opts.def.bqTable, rows);

    return {
      ...base,
      rowCount: rows.length,
      durationMs: Date.now() - started,
    };
  } catch (e) {
    return {
      ...base,
      ok: false,
      durationMs: Date.now() - started,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function runBigQueryNightlySync(opts?: {
  tenantSlug?: string;
  dryRun?: boolean;
  tableIds?: string[];
}): Promise<BigQuerySyncRunResult> {
  const ranAt = new Date().toISOString();
  const tenantSlug = opts?.tenantSlug?.trim() || tenantSlugFromEnv();
  const dryRun = !!opts?.dryRun;

  if (!postgresConfigured()) {
    return {
      ok: false,
      ranAt,
      tenantSlug,
      tenantId: "",
      dryRun,
      tables: [],
      error: "DATABASE_URL or DIRECT_URL not configured",
    };
  }

  if (!dryRun && !bigQuerySyncConfigured()) {
    return {
      ok: false,
      ranAt,
      tenantSlug,
      tenantId: "",
      dryRun,
      tables: [],
      error:
        "BigQuery not configured — set BIGQUERY_PROJECT_ID, BIGQUERY_DATASET, and credentials",
    };
  }

  let tenantId = "";
  const tables: BigQuerySyncTableResult[] = [];

  try {
    tenantId = await resolveTenantId(tenantSlug);

    if (!dryRun) {
      await ensureBigQueryDataset();
    }

    const defs = opts?.tableIds?.length
      ? BIGQUERY_SYNC_TABLES.filter((t) => opts.tableIds!.includes(t.id))
      : BIGQUERY_SYNC_TABLES;

    for (const def of defs) {
      const result = await syncOneTable({
        def,
        tenantId,
        tenantSlug,
        syncedAt: ranAt,
        dryRun,
      });
      tables.push(result);
    }

    const failed = tables.filter((t) => !t.ok);
    return {
      ok: failed.length === 0,
      ranAt,
      tenantSlug,
      tenantId,
      dryRun,
      tables,
      error:
        failed.length > 0
          ? `${failed.length} table(s) failed: ${failed.map((f) => f.id).join(", ")}`
          : undefined,
    };
  } catch (e) {
    return {
      ok: false,
      ranAt,
      tenantSlug,
      tenantId,
      dryRun,
      tables,
      error: e instanceof Error ? e.message : String(e),
    };
  } finally {
    await closePostgresPool();
  }
}
