import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * The production Supabase project.
 *
 * Hardcoded, not read from configuration, and that is the point: this is the
 * value the guard below compares against, and a safety guard that depends on
 * someone remembering to set an env var is not a guard. The ref is already
 * public — it is the host in NEXT_PUBLIC_SUPABASE_URL, shipped to every
 * browser — so there is nothing secret about naming it here.
 */
const PRODUCTION_PROJECT_REF = "ymamhlcrjsuilzdonkzl";

/**
 * Whether this process is a developer's machine rather than the deployed app.
 *
 * `next dev` sets NODE_ENV to "development"; the Cloud Run image runs
 * `next start`, where it is "production". Nothing else distinguishes them —
 * both read the same .env.local and the same service-role key.
 */
function isLocalDevProcess(): boolean {
  return process.env.NODE_ENV !== "production";
}

function pointsAtProduction(url: string): boolean {
  return url.includes(PRODUCTION_PROJECT_REF);
}

/**
 * The escape hatch, for the rare deliberate case — a data repair run from a
 * laptop, say. It has to be set per command, in the shell, by someone who
 * meant it. Do not put it in .env.local: leaving it on permanently is the
 * same as not having the guard.
 */
function overrideEnabled(): boolean {
  return process.env.ALLOW_LOCAL_PROD_WRITES === "1";
}

function refusal(what: string): Error {
  return new Error(
    `Refusing ${what}: this is a local dev server writing to the PRODUCTION ` +
      `database. On 2026-09-06 a local process emptied every fee receipt's ` +
      `lines and tenders — 1,913 rows, ₹20.8 lakh of collections left with no ` +
      `student, head or month. Reads are allowed; writes are not. If you ` +
      `genuinely mean to write to production, run the command with ` +
      `ALLOW_LOCAL_PROD_WRITES=1.`,
  );
}

/** PostgREST builder methods that change data. */
const WRITE_METHODS = new Set(["insert", "update", "upsert", "delete"]);

function guardTableBuilder<T extends object>(builder: T, table: string): T {
  return new Proxy(builder, {
    get(target, prop, receiver) {
      if (typeof prop === "string" && WRITE_METHODS.has(prop)) {
        return () => {
          throw refusal(`${prop} on ${table}`);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      // Filter builders return `this`, so binding to the real target keeps the
      // chain working — and keeps it unguarded past the first hop, which is
      // fine: the write methods are only ever reached from the table builder.
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as T;
}

const STORAGE_WRITE_METHODS = new Set([
  "upload",
  "uploadToSignedUrl",
  "update",
  "move",
  "copy",
  "remove",
  "createSignedUploadUrl",
]);

function guardStorage<T extends object>(storage: T): T {
  return new Proxy(storage, {
    get(target, prop, receiver) {
      if (prop === "from") {
        return (bucket: string) => {
          const bucketApi = (target as { from: (b: string) => object }).from(
            bucket,
          );
          return new Proxy(bucketApi, {
            get(bTarget, bProp, bReceiver) {
              if (typeof bProp === "string" && STORAGE_WRITE_METHODS.has(bProp)) {
                return () => {
                  throw refusal(`storage ${bProp} on bucket ${bucket}`);
                };
              }
              const v = Reflect.get(bTarget, bProp, bReceiver);
              return typeof v === "function" ? v.bind(bTarget) : v;
            },
          });
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as T;
}

/**
 * A client that can read production but cannot change it.
 *
 * `rpc` is blocked wholesale rather than by an allowlist of read-only
 * functions. Some of them write — `replace_fee_desk_voucher_lines` is the one
 * that matters — and a list that has to be kept in step with every new
 * migration is a list that will be wrong on the day it counts.
 */
export function readOnlyProductionClient(sb: SupabaseClient): SupabaseClient {
  return new Proxy(sb, {
    get(target, prop, receiver) {
      if (prop === "from") {
        return (table: string) =>
          guardTableBuilder(
            (target as unknown as { from: (t: string) => object }).from(table),
            table,
          );
      }
      if (prop === "rpc") {
        return (fn: string) => {
          throw refusal(`rpc ${fn}`);
        };
      }
      if (prop === "storage") {
        return guardStorage(target.storage as unknown as object);
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as SupabaseClient;
}

/**
 * Whether a client built for `url` in this process must be read-only.
 *
 * Exported for the self-test — the decision is the whole guard, and it is
 * worth pinning independently of the Proxy machinery around it.
 */
export function shouldBeReadOnly(
  url: string,
  opts?: { nodeEnv?: string; override?: boolean },
): boolean {
  const dev = opts?.nodeEnv !== undefined
    ? opts.nodeEnv !== "production"
    : isLocalDevProcess();
  const override = opts?.override ?? overrideEnabled();
  return dev && pointsAtProduction(url) && !override;
}

export function createServiceSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  if (!shouldBeReadOnly(url)) return client;
  console.warn(
    "[supabase] local dev pointed at the PRODUCTION database — writes are blocked. " +
      "Set ALLOW_LOCAL_PROD_WRITES=1 for a deliberate repair.",
  );
  return readOnlyProductionClient(client);
}
