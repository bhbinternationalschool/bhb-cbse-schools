/**
 * concession-template-apply — data-layer 2.2f (MONEY): applying a concession
 * template (Fees → Bulk & PDC → Concession templates,
 * POST /api/fees/tools/concession-templates {action:"apply"}) lands ALL or
 * NONE of its grants.
 *
 *  1. All or none. Masters is put in the state production was in on 13 Oct
 *     2026: one class link in the stored classSubjects slice without
 *     `isOptional`, so the derived row tables refuse the next sync. The
 *     principal applies a template to two children. The answer is a refusal
 *     and NOTHING is stored: no grant for either child, no template rule.
 *     (Before 2.2f the apply re-sent the whole grants list and synced the
 *     row tables in a second call: the grants were written, the sync failed,
 *     and the clerk was told "nothing was granted" — a discount on two
 *     families' bills that nobody knew was there.)
 *  2. With Masters healthy, the same apply grants both children in one go:
 *     the rule and two grants, each a kernel element (`_rev` 1); no other
 *     grant's `_rev` moves.
 * Everything is put back (the bad link, the grants, the rule; the template is
 * switched off).
 */
import type { APIRequestContext } from "@playwright/test";
import { E2E_TENANT_SLUG } from "../fixture";
import { expect, fx, openAs, test } from "../support";

type Row = Record<string, unknown> & { id: string; _rev?: number };
const API = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const svc = { apikey: KEY, Authorization: `Bearer ${KEY}`, "content-type": "application/json" };

async function restJson(path: string, init: RequestInit = {}): Promise<unknown> {
  if (!/^http:\/\/127\.0\.0\.1[:/]/.test(API)) throw new Error(`refusing a non-local database: ${API}`);
  const res = await fetch(`${API}/rest/v1/${path}`, { ...init, headers: { ...svc, ...(init.headers ?? {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path}: ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

async function tenantId(): Promise<string> {
  const rows = (await restJson(`tenants?slug=eq.${E2E_TENANT_SLUG}&select=id`)) as { id: string }[];
  if (!rows[0]) throw new Error("no e2e tenant");
  return rows[0].id;
}

async function slicePayload(tenant: string, key: string): Promise<Row[]> {
  const rows = (await restJson(`masters_desk_slices?tenant_id=eq.${tenant}&slice_key=eq.${key}&select=payload`)) as { payload: Row[] }[];
  return rows[0]?.payload ?? [];
}

async function setSlicePayload(tenant: string, key: string, payload: Row[]): Promise<void> {
  await restJson(`masters_desk_slices?tenant_id=eq.${tenant}&slice_key=eq.${key}`, { method: "PATCH", body: JSON.stringify({ payload }) });
}

async function resync(tenant: string): Promise<void> {
  await restJson("rpc/masters_sync_rows_from_slices", { method: "POST", body: JSON.stringify({ p_tenant_id: tenant }) });
}

async function list(req: APIRequestContext, collection: string): Promise<Row[]> {
  const res = await req.get(`/api/data/${collection}?limit=1000`);
  expect(res.status(), `GET ${collection}`).toBe(200);
  return ((await res.json()) as { rows: Row[] }).rows;
}

const BAD_LINK = "e2e_tpl_bad_link";

test.describe.configure({ mode: "serial" });

test("a concession template applies all or none: a refused write stores no grant; a healthy one stores every grant", async ({ browser }) => {
  const a = await openAs(browser, "principal");
  const req = a.page.request;
  const tenant = await tenantId();
  const ay = fx.sessions.principal.academicYearCode;
  const pool = fx.sis.students.filter((s) => s.status === "active" && s.academicYearCode === ay).slice(0, 40);
  const tools = await req.get("/api/fees/tools/concession-templates");
  expect(tools.status()).toBe(200);
  const heads = ((await tools.json()) as { feeHeads: { id: string }[] }).feeHeads;
  const post = (data: Record<string, unknown>) => req.post("/api/fees/tools/concession-templates", { data });

  // A template on a head two of these children are billed on (found by preview).
  let template: { id: string; ruleCode: string } | null = null;
  let children: string[] = [];
  const made: string[] = [];
  try {
    for (const head of heads.slice(0, 8)) {
      const created = await post({
        action: "create",
        name: `E2E 2.2f template ${Date.now().toString(36)}`,
        ground: "merit",
        mode: "percent",
        value: 10,
        feeHeadIds: [head.id],
        siblingChildNo: null,
        endPolicy: "session_end",
        autoApproveMaxPaise: null,
        defaultReason: "e2e 2.2f",
      });
      const text = await created.text();
      expect(created.status(), `create template: ${text.slice(0, 300)}`).toBe(200);
      const t = (JSON.parse(text) as { template: { id: string; ruleCode: string } }).template;
      made.push(t.id);
      const preview = await post({ action: "apply", templateId: t.id, studentIds: pool.map((c) => c.id), fromMonth: "2026-04", reason: "e2e 2.2f", preview: true });
      const ptext = await preview.text();
      expect(preview.status(), `preview: ${ptext.slice(0, 300)}`).toBe(200);
      const grantable = ((JSON.parse(ptext) as { rows: { studentId: string; action: string }[] }).rows ?? []).filter((r) => r.action === "grant");
      if (grantable.length >= 2) {
        template = t;
        children = grantable.slice(0, 2).map((r) => r.studentId);
        break;
      }
    }
    expect(template, "a fee head two children are billed on").toBeTruthy();
    const tpl = template!;
    const ourRules = async () => (await list(req, "masters.concessions")).filter((r) => String(r.code ?? "").toUpperCase() === tpl.ruleCode.toUpperCase());
    const grantsBefore = await list(req, "masters.concession-grants");
    const ruleIdsOf = async () => new Set((await ourRules()).map((r) => r.id));
    const newGrants = async () => {
      const rules = await ruleIdsOf();
      return (await list(req, "masters.concession-grants")).filter((g) => rules.has(String(g.concessionId)) || (!grantsBefore.some((b) => b.id === g.id) && children.includes(String(g.studentId))));
    };
    const apply = () => post({ action: "apply", templateId: tpl.id, studentIds: children, fromMonth: "2026-04", reason: "e2e 2.2f", preview: false });

    await test.step("1. Masters' row tables refuse the next sync → the apply is refused and NOTHING is stored", async () => {
      const links0 = await slicePayload(tenant, "classSubjects");
      const first = links0[0];
      // The 13 Oct 2026 state: one stored class link without isOptional.
      const bad: Row = { id: BAD_LINK, classId: String(first.classId), subjectId: String(first.subjectId), isActive: false, periodsPerWeek: 0 };
      await setSlicePayload(tenant, "classSubjects", [...links0, bad]);
      try {
        const res = await apply();
        const text = await res.text();
        expect(res.status(), `refused: ${text.slice(0, 300)}`).toBeGreaterThanOrEqual(400);
        expect(await newGrants(), "no grant for either child").toEqual([]);
        expect(await ourRules(), "no template rule").toEqual([]);
      } finally {
        await setSlicePayload(tenant, "classSubjects", (await slicePayload(tenant, "classSubjects")).filter((l) => l.id !== BAD_LINK));
        await resync(tenant);
      }
    });

    await test.step("2. Masters healthy → the same apply stores the rule and both grants, each a kernel element", async () => {
      const res = await apply();
      const text = await res.text();
      expect(res.status(), `applied: ${text.slice(0, 300)}`).toBe(200);
      expect((JSON.parse(text) as { granted?: number }).granted).toBe(2);
      const grants = await newGrants();
      expect(grants.map((g) => String(g.studentId)).sort()).toEqual([...children].sort());
      for (const g of grants) expect(g._rev, `grant ${g.id} is a kernel element`).toBe(1);
      expect((await ourRules()).length, "the template's rule").toBe(1);
      const now = new Map((await list(req, "masters.concession-grants")).map((g) => [g.id, g._rev]));
      expect(grantsBefore.filter((b) => now.get(b.id) !== b._rev).map((b) => b.id), "no other grant was re-written").toEqual([]);
    });
  } finally {
    // Our grants and rules out of the stored lists (directly: the kernel never
    // empties a list), the row tables re-synced, the templates deleted.
    const codes = new Set<string>();
    for (const id of made) {
      const rows = (await restJson(`fee_concession_templates?id=eq.${id}&select=*`)) as Row[];
      for (const r of rows) codes.add(String(r.rule_code ?? "").toUpperCase());
      await restJson(`fee_concession_templates?id=eq.${id}`, { method: "DELETE" });
    }
    const rules = await slicePayload(tenant, "concessions");
    const ruleIds = new Set(rules.filter((r) => codes.has(String(r.code ?? "").toUpperCase())).map((r) => r.id));
    if (ruleIds.size) {
      await setSlicePayload(tenant, "concessions", rules.filter((r) => !ruleIds.has(r.id)));
      const grants = await slicePayload(tenant, "concessionGrants");
      await setSlicePayload(tenant, "concessionGrants", grants.filter((g) => !ruleIds.has(String(g.concessionId))));
      await resync(tenant);
    }
    await a.context.close();
  }
});
