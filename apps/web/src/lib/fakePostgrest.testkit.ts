/**
 * Test kit (not a test): a fake Supabase PostgREST behind `globalThis.fetch`,
 * plus a no-op `server-only`, so a self-test can run real server code —
 * route handlers, readers, caches — with no database and no network.
 *
 *   installServerOnlyStub();            // before importing *.server.ts
 *   const pg = installFakePostgrest();  // sets the env + fetch
 *   pg.tables.masters_desk_slices = { error: "timeout" };
 *   pg.rpc.desk_probe = (args) => "abc";
 *   pg.count("masters_desk_slices")     // requests seen for that table
 *
 * Never point this at a real URL: the env it sets is example.test.
 */
import Module from "node:module";

export function installServerOnlyStub(): void {
  const m = Module as unknown as { _load: (req: string, ...rest: unknown[]) => unknown };
  const orig = m._load;
  m._load = function (this: unknown, req: string, ...rest: unknown[]) {
    if (req === "server-only") return {};
    return orig.call(this, req, ...rest);
  };
}

export type FakeTable = unknown[] | { error: string };

export type FakePostgrest = {
  tables: Record<string, FakeTable>;
  rpc: Record<string, (args: Record<string, unknown>) => unknown>;
  /** Every request: "GET table", "POST rpc/name", … */
  log: string[];
  count(table: string): number;
  /** Held reads: while set, a GET of this table waits for the returned release. */
  hold(table: string): () => void;
};

export function installFakePostgrest(opts?: { tenantId?: string }): FakePostgrest {
  const tenantId = opts?.tenantId ?? "00000000-0000-4000-8000-000000000001";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.test";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
  const holds = new Map<string, Promise<void>>();
  const pg: FakePostgrest = {
    tables: { tenants: [{ id: tenantId }] },
    rpc: {},
    log: [],
    count: (table) => pg.log.filter((l) => l.endsWith(` ${table}`)).length,
    hold(table) {
      let release: () => void = () => {};
      holds.set(table, new Promise<void>((r) => (release = r)));
      return () => {
        holds.delete(table);
        release();
      };
    },
  };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  (globalThis as { fetch: unknown }).fetch = async (input: unknown, init?: { method?: string; body?: unknown }) => {
    const url = new URL(typeof input === "string" ? input : String((input as { url?: string }).url ?? input));
    if (url.hostname !== "example.test") throw new Error(`fake postgrest: refused ${url.href}`);
    const method = (init?.method || (input as { method?: string })?.method || "GET").toUpperCase();
    const path = url.pathname.replace(/^\/rest\/v1\//, "");
    if (path.startsWith("rpc/")) {
      const name = path.slice(4);
      pg.log.push(`POST rpc/${name}`);
      const fn = pg.rpc[name];
      if (!fn) return json({ message: `fake: no rpc ${name}`, code: "PGRST202" }, 404);
      try {
        const args = init?.body ? JSON.parse(String(init.body)) : {};
        return json(await fn(args));
      } catch (e) {
        return json({ message: e instanceof Error ? e.message : String(e), code: "P0001" }, 400);
      }
    }
    pg.log.push(`${method} ${path}`);
    const held = holds.get(path);
    if (held) await held;
    const t = pg.tables[path];
    if (t && !Array.isArray(t)) return json({ message: t.error, code: "57014" }, 500);
    if (method !== "GET" && method !== "HEAD") return json([], 201);
    return json(t ?? []);
  };
  return pg;
}
