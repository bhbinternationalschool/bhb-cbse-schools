/**
 * RBAC catalog completeness (director, 12 Oct 2026: "proper RBAC — every
 * function of every module grantable, like the old ERP").
 *
 * A function in lib/rbacFeatureCatalog enforces nothing until a screen gates
 * its tabs through it and its API routes accept it — and a tab no function
 * lists can only be opened by the whole module (how App pop-ups and Parents
 * on app ended up out of the office's reach). This fails CI when:
 *
 *  1. a tab declared by a screen in lib/rbacScreenTabs.ts maps to no catalog
 *     function and has no whole-module exemption with a reason; or an
 *     exemption is stale (no such tab) or contradicts a function;
 *  2. a registered screen does not gate its tabs at all;
 *  3. a catalog function is malformed (id, module, actions, duplicate) or
 *     lists an API route that does not exist;
 *  4. an app/api route file calls no auth gate and is not on the public
 *     allowlist below (with its reason).
 *
 * Run: npx tsx src/lib/rbacCatalogCompleteness.selftest.ts
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

import { RBAC_FEATURE_ACTIONS, RBAC_MODULES, moduleForMastersTab, type RbacModule } from "./rbac";
import {
  RBAC_FEATURES,
  RBAC_WHOLE_MODULE_TABS,
  featuresForMastersTab,
  featuresForTab,
} from "./rbacFeatures";
import { SESSION_ONLY_ROUTE_BASELINE } from "./rbacRouteBaseline";
import { RBAC_SCREEN_TABS } from "./rbacScreenTabs";

console.log("rbacCatalogCompleteness.selftest.ts");

const SRC = join(__dirname, "..");
const failures: string[] = [];
const fail = (msg: string) => failures.push(msg);

/* ── Tab extraction from source ───────────────────────────────────────── */

function parse(file: string): ts.SourceFile {
  const abs = join(SRC, file);
  return ts.createSourceFile(abs, readFileSync(abs, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function tabsDeclared(file: string, tabType?: string, tabList?: string): string[] {
  const sf = parse(file);
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (tabType && ts.isTypeAliasDeclaration(n) && n.name.text === tabType) {
      const types = ts.isUnionTypeNode(n.type) ? n.type.types : [n.type];
      for (const t of types) {
        if (ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal)) out.push(t.literal.text);
      }
    }
    if (tabList && ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === tabList && n.initializer) {
      const ids = (m: ts.Node) => {
        if (
          ts.isPropertyAssignment(m) &&
          ts.isIdentifier(m.name) &&
          m.name.text === "id" &&
          ts.isStringLiteral(m.initializer)
        ) {
          out.push(m.initializer.text);
        }
        ts.forEachChild(m, ids);
      };
      ids(n.initializer);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return [...new Set(out)];
}

const TAB_GATES = /\b(visibleModuleTabs|canSeeModuleTab|canWriteModuleTab|canAccessMastersTab)\(/;

/* ── 1 + 2: every screen tab is a function's or an explicit exemption ── */

const screenTabs = new Set<string>(); // "module|tab"
let tabCount = 0;
for (const screen of RBAC_SCREEN_TABS) {
  const file = join(SRC, screen.file);
  if (!existsSync(file)) {
    fail(`${screen.screen}: ${screen.file} does not exist (lib/rbacScreenTabs.ts is stale)`);
    continue;
  }
  const tabs = tabsDeclared(screen.file, screen.tabType, screen.tabList);
  if (tabs.length === 0) {
    fail(`${screen.screen}: no tabs found in ${screen.file} under ${screen.tabType ?? screen.tabList}`);
    continue;
  }
  const gateFile = screen.gatedBy ?? screen.file;
  if (!TAB_GATES.test(readFileSync(join(SRC, gateFile), "utf8"))) {
    fail(`${screen.screen}: ${gateFile} never gates its tabs (visibleModuleTabs / canSeeModuleTab …)`);
  }
  for (const tab of tabs) {
    tabCount += 1;
    const tabModule: RbacModule = screen.masters
      ? moduleForMastersTab(tab)
      : (screen.tabModules?.[tab] ?? screen.module);
    screenTabs.add(`${tabModule}|${tab}`);
    const fns = screen.masters && tabModule === "masters" ? featuresForMastersTab(tab) : featuresForTab(tabModule, tab);
    const exempt = RBAC_WHOLE_MODULE_TABS.find((e) => e.module === tabModule && e.tab === tab);
    if (fns.length === 0 && !exempt) {
      fail(
        `${screen.screen} tab "${tab}" (${tabModule}): no catalog function lists it — add one to ` +
          `lib/rbacFeatureCatalog/*, or a ${"wholeModuleOnly"} exemption with the reason`,
      );
    }
    if (fns.length > 0 && exempt) {
      fail(`${screen.screen} tab "${tab}" (${tabModule}): exempted as whole-module-only but ${fns[0]!.id} opens it`);
    }
  }
}
/* ── 1b: every screen with tabs is registered (auto-discovered) ─────── */

/**
 * Screens with a tab bar that are not module screens: their tabs are the
 * signed-in person's own pages, or sub-views inside a registered screen's
 * tab (gated by that tab), so there is nothing to grant.
 */
const NOT_RBAC_SCREENS: Record<string, string> = {
  "components/staff/MyPayWorkspace.tsx": "the signed-in person's own attendance, leave, payslips and advances",
  "components/reports/ReportsCenterWorkspace.tsx": "hub views (dashboard / catalog / recent); each report is gated by its module (REPORTS_CENTER_RBAC_MODULES)",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/(Workspace|Tabs)\.tsx$/.test(name)) out.push(p);
  }
  return out;
}
/** Tab ids a file declares: a `…Tab` string union, or a TABS-like const of `{ id }`. */
function discoveredTabs(file: string): string[] {
  const sf = parse(file);
  const out = new Set<string>();
  const visit = (n: ts.Node) => {
    if (ts.isTypeAliasDeclaration(n) && /Tab$/.test(n.name.text) && ts.isUnionTypeNode(n.type)) {
      for (const t of n.type.types) {
        if (ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal)) out.add(t.literal.text);
      }
    }
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && /^[A-Z_]*TABS?$|TAB_ITEMS$/.test(n.name.text) && n.initializer) {
      const ids = (m: ts.Node) => {
        if (ts.isPropertyAssignment(m) && ts.isIdentifier(m.name) && m.name.text === "id" && ts.isStringLiteral(m.initializer)) {
          out.add(m.initializer.text);
        }
        ts.forEachChild(m, ids);
      };
      ids(n.initializer);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return [...out];
}
const registeredFiles = new Set(RBAC_SCREEN_TABS.flatMap((x) => [x.file, ...(x.gatedBy ? [x.gatedBy] : [])]));
let discovered = 0;
for (const abs of walk(join(SRC, "components"))) {
  const file = relative(SRC, abs);
  if (discoveredTabs(file).length < 2) continue;
  discovered += 1;
  if (registeredFiles.has(file)) continue;
  if (NOT_RBAC_SCREENS[file]) continue;
  fail(
    `${file} has a tab bar but is not in lib/rbacScreenTabs.ts — register its tabs (and give each a ` +
      `function or exemption), or list it in NOT_RBAC_SCREENS with the reason`,
  );
}
for (const f of Object.keys(NOT_RBAC_SCREENS)) {
  if (!existsSync(join(SRC, f))) fail(`NOT_RBAC_SCREENS lists ${f}, which no longer exists`);
}

for (const e of RBAC_WHOLE_MODULE_TABS) {
  if (!e.reason || e.reason.trim().length < 12) fail(`exemption ${e.module}|${e.tab} needs a real reason`);
  if (!screenTabs.has(`${e.module}|${e.tab}`)) fail(`exemption ${e.module}|${e.tab} names no screen tab (stale)`);
}
const exemptKeys = RBAC_WHOLE_MODULE_TABS.map((e) => `${e.module}|${e.tab}`);
assert.equal(new Set(exemptKeys).size, exemptKeys.length, "duplicate whole-module exemption");

/* ── 3: catalog functions are well formed; their routes exist ─────────── */

const apiRoot = join(SRC, "app", "api");
function routeFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) routeFiles(p, out);
    else if (name === "route.ts") out.push(p);
  }
  return out;
}
const ROUTE_FILES = routeFiles(apiRoot);
/** Each route as URL segments, e.g. ["api","data","[collection]"]. */
const ROUTE_SEGMENTS = ROUTE_FILES.map((f) =>
  ["api", ...relative(apiRoot, f).split("/").slice(0, -1)].filter((s) => !/^\(.*\)$/.test(s)),
);
function routeExists(prefix: string): boolean {
  const want = prefix.replace(/^\//, "").replace(/\/$/, "").split("/");
  return ROUTE_SEGMENTS.some(
    (segs) =>
      segs.length >= want.length &&
      want.every((w, i) => segs[i] === w || /^\[.+\]$/.test(segs[i]!)),
  );
}

const validActions = new Set(RBAC_FEATURE_ACTIONS.map((a) => a.id));
const moduleIds = new Set(RBAC_MODULES.map((m) => m.id));
const seen = new Set<string>();
for (const f of RBAC_FEATURES) {
  if (seen.has(f.id)) fail(`duplicate function id ${f.id}`);
  seen.add(f.id);
  if (!moduleIds.has(f.module)) fail(`${f.id}: unknown module ${f.module}`);
  if (!f.id.startsWith(`${f.module}.`)) fail(`${f.id}: id must start with "${f.module}."`);
  if (!f.label.trim() || !f.blurb.trim()) fail(`${f.id}: label and blurb are required`);
  if (f.actions.length === 0) fail(`${f.id}: no actions`);
  for (const a of f.actions) if (!validActions.has(a)) fail(`${f.id}: unknown action ${a}`);
  if (!f.tabs?.length && !f.routes?.length && !f.slices?.length) {
    fail(`${f.id}: opens nothing (no tabs, routes or slices)`);
  }
  for (const r of f.routes ?? []) {
    if (!r.startsWith("/api/")) fail(`${f.id}: route ${r} must be an /api/ path`);
    else if (r.startsWith("/api/school-data/")) fail(`${f.id}: ${r} — desk routes are never opened by a function`);
    else if (!routeExists(r)) fail(`${f.id}: route ${r} has no app/api/**/route.ts`);
  }
}

/* ── 4: every API route calls an auth gate, or is public on purpose ──── */

/** Calls that authenticate (and, for staff, authorise) a request. */
const AUTH_GATES = new RegExp(
  "\\b(" +
    [
      "requireStaffPermission",
      "requireStaffPermissionOrFeature",
      "requireAnyStaffPermission",
      "requireStaffApi",
      "requireWaStaffApi",
      "requireStaffPrincipal",
      "requireStaff",
      "requireJobSecret",
      "requireParentHousehold",
      "requireIntegrationHealthApi",
      "resolveApiAuth",
      "authorizeSchoolDataDesk",
      "authorizePaymentLinkAccess",
      "authorizeDocumentAction",
      "authorizeChatThread",
      "deskReadGate",
      "deskWriteGate",
      "invRoute",
      "parentHouseholdFrom",
      "getDemoSession",
      "getSession",
      "getSessionBundle",
      "verifyParentOtp",
      "verifyMetaSignature",
      "verifyCashfreeSignature",
      "verifyRazorpaySignature",
      "verifyPayoutWebhook",
      "verifyGoogleLeadWebhookKey",
      "verifyPunchSignature",
      "verifyReceiptLinkToken",
      "verifyBriefLinkToken",
      "verifyBusTrackToken",
      "verifyClassMediaLink",
      "verifyPlayPurchase",
      "verifyCertificate",
    ].join("|") +
    ")\\(",
);

/**
 * Routes that are public (or authenticate inside a library call this scan
 * cannot see) on purpose. Path relative to app/api, without /route.ts.
 */
const PUBLIC_API_ROUTES: Record<string, string> = {
  "ai/config": "says which AI providers are configured; no school data",
  "school-data/mirror": "retired stub since the DB cutover; returns constants only",
  "app-version": "the app's update check runs before login",
  "public/app-version": "the app's update check runs before login",
  "auth/demo": "sign-in itself (refused in production by the route)",
  "client-metrics":
    "telemetry: any signed-in session, checked in lib/clientMetrics.server (sessionFromRequest, 401 otherwise); reads no school data, writes one log line",
  "data/views/versions":
    "the change signal (data-layer 1.3): any signed-in STAFF session (or API key) by design, checked in the route (resolveApiAuth 401, parents 403); answers a timestamp and a count per desk, no rows",
  "data/views/masters":
    "reference view (data-layer 1.4): gated in lib/data/server/views.ts by the masters-desk rule (lib/mastersReadScope.server: requireStaffPermission(masters, view) = full, other staff = teaching subset; 401/403 parents/mirror secret refused)",
  "data/views/staff-list":
    "reference view (data-layer 1.4): any staff session, gated in lib/data/server/views.ts (requireStaffApi; parents 403, mirror secret 403); a redacted directory, no personal fields",
  "data/views/rbac":
    "reference view (data-layer 1.4): gated in lib/data/server/views.ts — requireStaffPermission(settings, view) = whole desk, other staff = own rows only (the rbac desk's rule)",
  "data/views/module-registry":
    "reference view (data-layer 1.4): any staff session, gated in lib/data/server/views.ts (requireStaffApi); which modules are switched on, no rows",
  "auth/first-login/request-otp": "sign-in: sends an OTP to a registered number",
  "auth/link/office": "parent number linking before login; the office approves",
  "auth/link/start": "parent number linking before login; a code goes to the registered phone",
  "auth/link/verify": "parent number linking before login; checks the code",
  "auth/otp/request": "sign-in: sends an OTP to a registered number",
  "auth/resolve-identifier": "sign-in: resolves a login name to its channel",
  "auth/session": "reads or clears the caller's own session cookie",
  "auth/staff-otp/request": "sign-in: sends an OTP to a registered staff number",
  "integrations/google/classroom/callback": "OAuth callback, checked against the state cookie",
  "integrations/social/meta-oauth/callback": "OAuth callback, checked against the state cookie",
  lookup: "IFSC / ISBN / PIN lookups of public data, rate limited",
  "maps/config": "returns whether maps are configured, no data",
  "maps/place-details": "Google Places proxy, rate limited",
  "maps/places-autocomplete": "Google Places proxy, rate limited",
  "maps/road-distance": "Google distance proxy, rate limited",
  "public/admission-registration": "the website's public admission form",
  "public/careers": "the website's public careers form",
  "public/enquiry": "the website's public enquiry form",
  "public/punch-screen/pair": "office punch screen pairing by one-time code",
  "public/punch-screen": "office punch screen, by its paired device token",
  "public/visitor": "the gate's public visitor self-registration",
  "transport/fleet-edge": "Fleet Edge device push, checked by the ingest key",
  "transport/fleet-edge/alerts": "Fleet Edge device push, checked by the ingest key",
  "transport/fleet-edge/live": "Fleet Edge device push, checked by the ingest key",
  "transport/fleet-edge/live/alerts": "re-export of transport/fleet-edge/alerts",
  "v1/health": "liveness probe, no data",
  "v1/openapi": "the API description, no data",
  voice: "returns whether speech is configured, no data",
  "whatsapp/webhook": "re-export of wa/webhook (Meta signature checked there)",
};

/**
 * Gates that tie a route to an RBAC module or function (or to a kind of
 * caller with its own rule: a cron secret, a parent household, a signed
 * webhook, a mobile feature, a super-admin check).
 */
const MODULE_GATES = new RegExp(
  "\\b(" +
    [
      "requireStaffPermission",
      "requireStaffPermissionOrFeature",
      "assertPermission",
      "authorizeSchoolDataDesk",
      "deskReadGate",
      "deskWriteGate",
      "deskFeatureGateFor",
      "requireAnyStaffPermission",
      "invRoute",
      "requireWaStaffApi",
      "requireJobSecret",
      "requireParentHousehold",
      "parentHouseholdFrom",
      "verify[A-Z][A-Za-z]+",
      "assertMobileFeature",
      "hasPermission",
      "requireStaffPrincipal",
      "authorizeDocumentAction",
      "authorizeChatThread",
      "authorizePaymentLinkAccess",
      "assertSchoolWide",
      "staffSectionScope",
      "featureAccess",
      "hasFeaturePermission",
      "orCommsFunction",
      "isSuperAdmin[A-Za-z]*",
      "isProtectedSuperAdmin[A-Za-z]*",
    ].join("|") +
    ")\\(",
);
const baseline = new Set(SESSION_ONLY_ROUTE_BASELINE);

let gated = 0;
let sessionOnly = 0;
for (const f of ROUTE_FILES) {
  const rel = relative(apiRoot, f).replace(/\/route\.ts$/, "");
  const src = readFileSync(f, "utf8");
  if (PUBLIC_API_ROUTES[rel]) continue;
  if (!AUTH_GATES.test(src)) {
    fail(`app/api/${rel}: calls no auth gate — gate it, or add it to PUBLIC_API_ROUTES with the reason`);
    continue;
  }
  gated += 1;
  if (MODULE_GATES.test(src)) {
    if (baseline.has(rel)) fail(`app/api/${rel} now names its module — remove it from SESSION_ONLY_ROUTE_BASELINE`);
    continue;
  }
  sessionOnly += 1;
  if (!baseline.has(rel)) {
    fail(
      `app/api/${rel}: signed in, but names no RBAC module or function — gate it with ` +
        `requireStaffPermission(module, action) (or a desk / function gate)`,
    );
  }
}
for (const rel of SESSION_ONLY_ROUTE_BASELINE) {
  if (!existsSync(join(apiRoot, rel, "route.ts"))) fail(`SESSION_ONLY_ROUTE_BASELINE lists app/api/${rel}, which no longer exists`);
}
for (const rel of Object.keys(PUBLIC_API_ROUTES)) {
  if (!existsSync(join(apiRoot, rel, "route.ts"))) fail(`PUBLIC_API_ROUTES lists app/api/${rel}, which no longer exists`);
}

/* ── Report ───────────────────────────────────────────────────────────── */

if (failures.length) {
  console.error(`\n${failures.length} RBAC completeness failure(s):`);
  for (const m of failures) console.error(`  ✗ ${m}`);
  process.exit(1);
}
console.log(
  `  ✓ ${tabCount} screen tabs across ${RBAC_SCREEN_TABS.length} screens map to ${RBAC_FEATURES.length} functions ` +
    `(${RBAC_WHOLE_MODULE_TABS.length} whole-module-only with reasons)`,
);
console.log(`  ✓ ${discovered} screens with tab bars discovered, all registered or exempt`);
console.log(
  `  ✓ ${gated} API routes gated (${gated - sessionOnly} name a module/function; ${sessionOnly} session-only, frozen baseline), ` +
    `${Object.keys(PUBLIC_API_ROUTES).length} public on purpose`,
);
console.log("rbacCatalogCompleteness.selftest.ts: OK");
