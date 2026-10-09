/**
 * What staff ask the ERP to do better, and where they get stuck (director,
 * 9 Oct 2026: "AI watcher in every module … if a change is really needed,
 * ask the user what they want, note it, send it for building").
 *
 * Two lists, one store (module_local_state "module_requests", rbac settings):
 *
 *  - requests: a change a user asked for, written up by the module guide
 *    (lib/moduleRequestDraft.server.ts) after it asked what they actually
 *    want. The director approves, edits or rejects each one; an APPROVED
 *    request is the spec it is built to, as a pull request the director
 *    merges. Nothing is built from a request nobody approved: anyone signed
 *    in can type anything into the chat.
 *  - stuck: where people hit the same error again and again, counted per
 *    screen and message, so a confusing screen shows up without anyone
 *    having to complain.
 *
 * Pure: the server reads, applies one of these, and writes back.
 */

export type ModuleRequestKind = "change" | "bug" | "stuck";
export type ModuleRequestStatus = "new" | "approved" | "rejected" | "built";

export type ModuleRequest = {
  id: string;
  createdAt: string;
  byStaffId: string;
  byName: string;
  byRole: string;
  module: string;
  pathname: string;
  tab: string;
  pageLabel: string;
  kind: ModuleRequestKind;
  /** One line, for the inbox list. */
  title: string;
  /** What is wrong or missing, in the user's terms. */
  problem: string;
  /** What the user wants instead. */
  wanted: string;
  /** The guide's proposed change — what would be built. The director may edit it. */
  suggestion: string;
  /** The conversation it came from, shortened. */
  transcript: { role: "user" | "assistant"; text: string }[];
  status: ModuleRequestStatus;
  decidedAt: string;
  decidedBy: string;
  directorNote: string;
  prUrl: string;
};

export type StuckSignal = {
  key: string;
  module: string;
  pathname: string;
  message: string;
  count: number;
  users: string[];
  firstAt: string;
  lastAt: string;
};

export type ModuleRequestsState = { version: 1; requests: ModuleRequest[]; stuck: StuckSignal[] };

export const MODULE_REQUESTS_CAP = 1000;
export const STUCK_SIGNALS_CAP = 300;

const str = (v: unknown, max = 2000) => String(v ?? "").slice(0, max);
const STATUSES: ModuleRequestStatus[] = ["new", "approved", "rejected", "built"];
const KINDS: ModuleRequestKind[] = ["change", "bug", "stuck"];

export function emptyModuleRequestsState(): ModuleRequestsState {
  return { version: 1, requests: [], stuck: [] };
}

export function normalizeModuleRequestsState(raw: unknown): ModuleRequestsState {
  const r = (raw ?? {}) as Partial<ModuleRequestsState>;
  const requests = (Array.isArray(r.requests) ? r.requests : [])
    .filter((x) => x && typeof x.id === "string" && x.id)
    .map(
      (x): ModuleRequest => ({
        id: str(x.id, 40),
        createdAt: str(x.createdAt, 40),
        byStaffId: str(x.byStaffId, 60),
        byName: str(x.byName, 120),
        byRole: str(x.byRole, 60),
        module: str(x.module, 60),
        pathname: str(x.pathname, 200),
        tab: str(x.tab, 60),
        pageLabel: str(x.pageLabel, 120),
        kind: KINDS.includes(x.kind as ModuleRequestKind) ? (x.kind as ModuleRequestKind) : "change",
        title: str(x.title, 160),
        problem: str(x.problem),
        wanted: str(x.wanted),
        suggestion: str(x.suggestion, 4000),
        transcript: (Array.isArray(x.transcript) ? x.transcript : [])
          .slice(-12)
          .map((t) => ({ role: t?.role === "assistant" ? ("assistant" as const) : ("user" as const), text: str(t?.text, 600) })),
        status: STATUSES.includes(x.status as ModuleRequestStatus) ? (x.status as ModuleRequestStatus) : "new",
        decidedAt: str(x.decidedAt, 40),
        decidedBy: str(x.decidedBy, 120),
        directorNote: str(x.directorNote),
        prUrl: str(x.prUrl, 300),
      }),
    );
  const stuck = (Array.isArray(r.stuck) ? r.stuck : [])
    .filter((x) => x && typeof x.key === "string" && x.key)
    .map(
      (x): StuckSignal => ({
        key: str(x.key, 400),
        module: str(x.module, 60),
        pathname: str(x.pathname, 200),
        message: str(x.message, 300),
        count: Math.max(1, Math.floor(Number(x.count) || 1)),
        users: (Array.isArray(x.users) ? x.users : []).map((u) => str(u, 120)).slice(0, 20),
        firstAt: str(x.firstAt, 40),
        lastAt: str(x.lastAt, 40),
      }),
    );
  return { version: 1, requests, stuck };
}

/** A new request, newest first; the oldest DECIDED ones drop off past the cap. */
export function addModuleRequest(state: ModuleRequestsState, req: ModuleRequest): ModuleRequestsState {
  let requests = [req, ...state.requests.filter((r) => r.id !== req.id)];
  if (requests.length > MODULE_REQUESTS_CAP) {
    const open = requests.filter((r) => r.status === "new" || r.status === "approved");
    const done = requests.filter((r) => r.status !== "new" && r.status !== "approved");
    requests = [...open, ...done].slice(0, MODULE_REQUESTS_CAP);
  }
  return { ...state, requests };
}

/** The director's decision, an edit to what gets built, or a PR link once it is built. */
export function decideModuleRequest(
  state: ModuleRequestsState,
  input: {
    id: string;
    status?: ModuleRequestStatus;
    suggestion?: string;
    directorNote?: string;
    prUrl?: string;
    by: string;
    now: string;
  },
): { ok: true; state: ModuleRequestsState } | { ok: false; error: string } {
  const cur = state.requests.find((r) => r.id === input.id);
  if (!cur) return { ok: false, error: "Request not found" };
  if (input.status && !STATUSES.includes(input.status)) return { ok: false, error: "Unknown status" };
  const next: ModuleRequest = {
    ...cur,
    ...(input.suggestion !== undefined ? { suggestion: str(input.suggestion, 4000).trim() || cur.suggestion } : {}),
    ...(input.directorNote !== undefined ? { directorNote: str(input.directorNote).trim() } : {}),
    ...(input.prUrl !== undefined ? { prUrl: str(input.prUrl, 300).trim() } : {}),
    ...(input.status && input.status !== cur.status
      ? { status: input.status, decidedAt: input.now, decidedBy: input.by }
      : {}),
  };
  return { ok: true, state: { ...state, requests: state.requests.map((r) => (r.id === cur.id ? next : r)) } };
}

/** One more time someone hit this error on this screen. */
export function recordStuckSignal(
  state: ModuleRequestsState,
  input: { module: string; pathname: string; message: string; user: string; now: string },
): ModuleRequestsState {
  const message = str(input.message, 300).trim();
  if (!message) return state;
  const pathname = str(input.pathname, 200).split("?")[0] || "/";
  const key = `${pathname}|${message.toLowerCase()}`;
  const i = state.stuck.findIndex((s) => s.key === key);
  let stuck: StuckSignal[];
  if (i >= 0) {
    const s = state.stuck[i]!;
    const users = s.users.includes(input.user) ? s.users : [...s.users, input.user].slice(-20);
    stuck = [{ ...s, count: s.count + 1, users, lastAt: input.now }, ...state.stuck.slice(0, i), ...state.stuck.slice(i + 1)];
  } else {
    stuck = [
      { key, module: str(input.module, 60), pathname, message, count: 1, users: [input.user], firstAt: input.now, lastAt: input.now },
      ...state.stuck,
    ];
  }
  if (stuck.length > STUCK_SIGNALS_CAP) {
    stuck = [...stuck].sort((a, b) => b.lastAt.localeCompare(a.lastAt)).slice(0, STUCK_SIGNALS_CAP);
  }
  return { ...state, stuck };
}

/** Does this chat message sound like the user wants the ERP changed? */
export function soundsLikeChangeRequest(text: string): boolean {
  const t = text.toLowerCase();
  return (
    /\b(should|could you|can you (add|make|change)|please (add|make|change)|add (a|an|the)|there is no|there's no|no option|no way to|i can'?t|cannot|unable to|doesn'?t (work|let|allow)|not working|wish|would be (good|better|nice)|feature|enhance|improve|suggest)/.test(
      t,
    ) || /(चाहिए|होना चाहिए|नहीं हो रहा|नहीं हो पा रहा|ऑप्शन नहीं|विकल्प नहीं|जोड़ दो|जोड़ दीजिए|बदल दो|सुधार)/.test(text)
  );
}
