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
  /** Dated snapshot taken before this table was overwritten, if one was. */
  snapshot?: string | null;
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

/**
 * How far a table is allowed to shrink in one sync before the sync refuses.
 *
 * The mirror is a full replace: delete this tenant's rows, insert the new set.
 * That faithfully copies a catastrophe. On 2026-09-06 the fee lines table in
 * Postgres was emptied, the 20:30 sync dutifully wrote 0 rows to BigQuery, and
 * the last good copy of 1,913 fee lines was gone from the one place anybody
 * would look for a backup. What actually saved the data was BigQuery TIME
 * TRAVEL — a storage-engine side effect with a seven-day horizon, not
 * something anyone had designed as a safety net.
 *
 * So the sync now stops instead of copying a collapse. A table that has lost
 * more than this fraction of its rows since the last sync is refused, loudly,
 * and the mirror keeps yesterday's copy until a person looks at it.
 */
const COLLAPSE_FLOOR = 0.5;

/** Tables this small are noisy — a genuine 2-row table halving is not news. */
const COLLAPSE_MIN_ROWS = 20;

async function bqRowCount(bqTable: string, tenantSlug: string): Promise<number | null> {
  const bq = getBigQueryClient();
  const datasetId = bigQueryDatasetId();
  const [exists] = await bq.dataset(datasetId).table(bqTable).exists();
  if (!exists) return null;
  const [rows] = await bq.query({
    query: `select count(*) as n from \`${bigQueryProjectId()}.${datasetId}.${bqTable}\` where tenant_slug = @tenantSlug`,
    params: { tenantSlug },
    location: process.env.BIGQUERY_LOCATION || "asia-south1",
  });
  const n = (rows?.[0] as { n?: number | string } | undefined)?.n;
  return n === undefined ? null : Number(n);
}

/**
 * A dated, immutable copy taken BEFORE the mirror is overwritten.
 *
 * A mirror is not a backup: it is only ever as good as its last write, and its
 * last write is exactly what you cannot trust after an incident. A BigQuery
 * table snapshot costs delta storage only, cannot be overwritten by the next
 * sync, and expires on its own after 35 days.
 *
 * Best-effort by design — a failed snapshot must not stop the sync, only be
 * reported. Losing today's snapshot is a smaller problem than a mirror that
 * silently stops updating.
 */
async function snapshotBeforeOverwrite(bqTable: string): Promise<string | null> {
  const bq = getBigQueryClient();
  const projectId = bigQueryProjectId();
  const datasetId = bigQueryDatasetId();
  const [exists] = await bq.dataset(datasetId).table(bqTable).exists();
  if (!exists) return null;

  const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const snap = `${bqTable}__snap_${day}`;
  await bq.query({
    query:
      `create snapshot table if not exists \`${projectId}.${datasetId}.${snap}\` ` +
      `clone \`${projectId}.${datasetId}.${bqTable}\` ` +
      `options (expiration_timestamp = timestamp_add(current_timestamp(), interval 35 day))`,
    location: process.env.BIGQUERY_LOCATION || "asia-south1",
  });
  return snap;
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

    // Refuse to copy a collapse. See COLLAPSE_FLOOR.
    const before = await bqRowCount(opts.def.bqTable, opts.tenantSlug);
    if (
      before !== null &&
      before >= COLLAPSE_MIN_ROWS &&
      rows.length < before * COLLAPSE_FLOOR
    ) {
      return {
        ...base,
        ok: false,
        rowCount: rows.length,
        durationMs: Date.now() - started,
        error:
          `REFUSED: ${opts.def.pgTable} has ${rows.length} rows but the mirror holds ${before}. ` +
          `That is a collapse, not a sync — the mirror keeps its copy. Check Postgres before ` +
          `re-running; on 2026-09-06 this exact shape overwrote the last good copy of 1,913 fee lines.`,
      };
    }

    // A dated copy the next sync cannot touch, taken before anything is
    // overwritten. Best-effort: never let it stop the sync.
    let snapshot: string | null = null;
    try {
      snapshot = await snapshotBeforeOverwrite(opts.def.bqTable);
    } catch (e) {
      console.warn(
        `[bq-sync] snapshot of ${opts.def.bqTable} failed (continuing): ` +
          (e instanceof Error ? e.message : String(e)),
      );
    }

    await deleteTenantRowsFromBq(opts.def.bqTable, opts.tenantSlug);
    await insertRowsBq(opts.def.bqTable, rows);

    return {
      ...base,
      rowCount: rows.length,
      durationMs: Date.now() - started,
      snapshot,
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
