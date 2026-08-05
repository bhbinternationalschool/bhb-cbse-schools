/**
 * Google BigQuery client — server-only.
 */

import { BigQuery } from "@google-cloud/bigquery";

let client: BigQuery | null = null;

export function bigQueryProjectId(): string {
  return (process.env.BIGQUERY_PROJECT_ID || "").trim();
}

export function bigQueryDatasetId(): string {
  return (process.env.BIGQUERY_DATASET || "bhb_erp").trim();
}

export function bigQueryLocation(): string {
  return (process.env.BIGQUERY_LOCATION || "asia-south1").trim();
}

export function bigQuerySyncConfigured(): boolean {
  if (!bigQueryProjectId() || !bigQueryDatasetId()) return false;
  if (process.env.BIGQUERY_SERVICE_ACCOUNT_JSON?.trim()) return true;
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim()) return true;
  // Cloud Run / GCE — application default credentials
  if (process.env.K_SERVICE?.trim() || process.env.GOOGLE_CLOUD_PROJECT?.trim()) {
    return true;
  }
  return false;
}

function parseServiceAccountJson(): Record<string, unknown> | null {
  const raw = process.env.BIGQUERY_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function getBigQueryClient(): BigQuery {
  if (client) return client;

  const projectId = bigQueryProjectId();
  const creds = parseServiceAccountJson();
  client = creds
    ? new BigQuery({ projectId, credentials: creds })
    : new BigQuery({ projectId });

  return client;
}

export async function ensureBigQueryDataset(): Promise<void> {
  const bq = getBigQueryClient();
  const datasetId = bigQueryDatasetId();
  const ds = bq.dataset(datasetId);
  const [exists] = await ds.exists();
  if (!exists) {
    await bq.createDataset(datasetId, { location: bigQueryLocation() });
  }
}
