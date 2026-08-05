/**
 * Server-only Postgres pool (Supabase DIRECT_URL / DATABASE_URL).
 */

import type { Pool, QueryResult } from "pg";

let pool: Pool | null = null;
let poolInit: Promise<Pool | null> | null = null;

export function postgresConfigured(): boolean {
  return !!(
    process.env.DIRECT_URL?.trim() || process.env.DATABASE_URL?.trim()
  );
}

async function initPool(): Promise<Pool | null> {
  const url =
    process.env.DIRECT_URL?.trim() || process.env.DATABASE_URL?.trim();
  if (!url) return null;

  const { Pool: PgPool } = await import("pg");
  const p = new PgPool({
    connectionString: url,
    max: 3,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
    ssl: url.includes("supabase.co")
      ? { rejectUnauthorized: false }
      : undefined,
  });
  p.on("error", (err) => {
    console.error("[postgres-pool]", err.message);
  });
  return p;
}

export async function getPostgresPool(): Promise<Pool | null> {
  if (pool) return pool;
  if (!poolInit) {
    poolInit = initPool().then((p) => {
      pool = p;
      return p;
    });
  }
  return poolInit;
}

export async function pgQuery<T extends Record<string, unknown> = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  const p = await getPostgresPool();
  if (!p) {
    throw new Error("DATABASE_URL or DIRECT_URL not configured");
  }
  return p.query<T>(sql, params);
}

export async function closePostgresPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    poolInit = null;
  }
}
