/**
 * WhatsApp chatbot flow definitions (Masters config).
 * Built-in flows mirror production engines; custom flows are editable in the builder.
 */

import { CRM_BOT_QUICK_PROMPTS } from "@/lib/crmAdmissionBotEngine";
import { SIS_BOT_QUICK_PROMPTS } from "@/lib/sisParentBotEngine";
import { SURVEY_BOT_QUICK_PROMPTS } from "@/lib/surveyFieldBotEngine";
import {
  STAFF_BOT_OFFICE_PROMPTS,
  STAFF_BOT_OWNER_PROMPTS,
} from "@/lib/waStaffBotEngine";
import { TRANSPORT_BOT_PROMPTS } from "@/lib/waTransportBotEngine";
import { VISITOR_PURPOSE_OPTIONS } from "@/lib/waUnifiedBotEngine";

const STORAGE_KEY = "bhb_wa_chatbot_flows_v1";

export type WaChatbotAudience =
  | "parent"
  | "admission"
  | "staff"
  | "survey"
  | "visitor"
  | "transport"
  | "general";

export type WaChatbotNodeType =
  | "welcome"
  | "message"
  | "buttons"
  | "list"
  | "handoff"
  | "action";

export type WaChatbotButton = {
  id: string;
  title: string;
  keyword?: string;
  nextNodeId?: string;
};

export type WaChatbotListRow = {
  id: string;
  title: string;
  description?: string;
  keyword?: string;
  nextNodeId?: string;
};

export type WaChatbotNode = {
  id: string;
  type: WaChatbotNodeType;
  title: string;
  body: string;
  /** Visual builder position */
  x: number;
  y: number;
  buttons?: WaChatbotButton[];
  listRows?: WaChatbotListRow[];
  /** ERP action key e.g. fees.dues, admissions.status */
  actionKey?: string;
};

export type WaChatbotFlowStatus = "built_in" | "draft" | "published";

export type WaChatbotFlow = {
  id: string;
  name: string;
  description: string;
  audience: WaChatbotAudience;
  status: WaChatbotFlowStatus;
  enabled: boolean;
  entryNodeId: string;
  nodes: WaChatbotNode[];
  updatedAt: string;
  createdAt: string;
};

export type WaChatbotFlowsState = {
  version: 1;
  flows: WaChatbotFlow[];
};

export const WA_CHATBOT_AUDIENCE_OPTIONS: {
  id: WaChatbotAudience;
  label: string;
  hint: string;
}[] = [
  { id: "parent", label: "Enrolled parents (SIS)", hint: "Fee, homework, receipts" },
  { id: "admission", label: "Admission enquiries", hint: "CRM leads & registration" },
  { id: "staff", label: "Staff & office", hint: "Owner / office quick actions" },
  { id: "survey", label: "Field survey agents", hint: "Survey capture workflow" },
  { id: "visitor", label: "Unknown visitors", hint: "Welcome & purpose picker" },
  { id: "transport", label: "Transport drivers", hint: "Route & trip updates" },
  { id: "general", label: "General", hint: "Custom audience" },
];

export const WA_CHATBOT_NODE_PALETTE: {
  type: WaChatbotNodeType;
  label: string;
  hint: string;
}[] = [
  { type: "welcome", label: "Welcome", hint: "Greeting when chat opens" },
  { type: "buttons", label: "Reply buttons", hint: "Up to 3 quick-reply buttons" },
  { type: "list", label: "List menu", hint: "WhatsApp list picker rows" },
  { type: "message", label: "Text reply", hint: "Plain text response" },
  { type: "action", label: "ERP action", hint: "Fetch data from school ERP" },
  { type: "handoff", label: "Human handoff", hint: "Route to staff inbox" },
];

function nid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function node(
  type: WaChatbotNodeType,
  title: string,
  body: string,
  y: number,
  extra?: Partial<WaChatbotNode>,
): WaChatbotNode {
  return {
    id: nid("wcn"),
    type,
    title,
    body,
    x: 40,
    y,
    ...extra,
  };
}

function buildPromptFlow(opts: {
  id: string;
  name: string;
  description: string;
  audience: WaChatbotAudience;
  welcomeBody: string;
  prompts: { id: string; label: string; waKeyword: string; response: string }[];
}): WaChatbotFlow {
  const welcome = node("welcome", "Welcome", opts.welcomeBody, 40);
  const buttons: WaChatbotButton[] = opts.prompts.map((p) => ({
    id: `btn_${p.id}`,
    title: p.label.slice(0, 20),
    keyword: p.waKeyword,
  }));
  const menu = node("buttons", "Main menu", "Choose an option:", 160, {
    buttons,
  });
  const responses = opts.prompts.map((p, i) => {
    const n = node("message", p.label, p.response, 280 + i * 120);
    const btn = menu.buttons?.find((b) => b.id === `btn_${p.id}`);
    if (btn) btn.nextNodeId = n.id;
    return n;
  });
  const handoff = node(
    "handoff",
    "Talk to staff",
    "Connecting you to the school office. A staff member will reply shortly.",
    280 + opts.prompts.length * 120,
  );
  const humanBtn = menu.buttons?.find((b) => b.keyword === "HUMAN");
  if (humanBtn) humanBtn.nextNodeId = handoff.id;

  return {
    id: opts.id,
    name: opts.name,
    description: opts.description,
    audience: opts.audience,
    status: "built_in",
    enabled: true,
    entryNodeId: welcome.id,
    nodes: [welcome, menu, ...responses, handoff],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

function seedBuiltInFlows(): WaChatbotFlow[] {
  const parent = buildPromptFlow({
    id: "builtin_parent_sis",
    name: "Parent assistant (SIS)",
    description:
      "Enrolled parent bot — children, dues, pay link, receipts, school info.",
    audience: "parent",
    welcomeBody:
      "Namaste — parent assistant for enrolled students on this WhatsApp number.",
    prompts: SIS_BOT_QUICK_PROMPTS.map((p) => ({
      id: p.id,
      label: p.label,
      waKeyword: p.waKeyword,
      response: `*${p.label}*\n\nThis step calls ERP data for *${p.waKeyword}* at runtime (fees, SIS, receipts).`,
    })),
  });

  const admission = buildPromptFlow({
    id: "builtin_admissions_crm",
    name: "Admissions CRM bot",
    description: "Lead / enquiry bot — fee, register, docs, status, visit.",
    audience: "admission",
    welcomeBody: "Namaste — Admissions desk on WhatsApp.",
    prompts: CRM_BOT_QUICK_PROMPTS.map((p) => ({
      id: p.id,
      label: p.label,
      waKeyword: p.waKeyword,
      response: `*${p.label}*\n\nAdmissions engine handles *${p.waKeyword}* with live CRM data.`,
    })),
  });

  const survey = buildPromptFlow({
    id: "builtin_survey_field",
    name: "Field survey agent",
    description: "Survey capture — status, start, break, end, photo capture.",
    audience: "survey",
    welcomeBody: "Field survey assistant — reply with a keyword or tap a button.",
    prompts: SURVEY_BOT_QUICK_PROMPTS.map((p) => ({
      id: p.id,
      label: p.label,
      waKeyword: p.waKeyword,
      response: `*${p.label}*\n\nSurvey workflow step: ${p.waKeyword}.`,
    })),
  });

  const staffPrompts = [
    ...STAFF_BOT_OWNER_PROMPTS,
    ...STAFF_BOT_OFFICE_PROMPTS.filter(
      (p) => !STAFF_BOT_OWNER_PROMPTS.some((o) => o.id === p.id),
    ),
  ];
  const staff = buildPromptFlow({
    id: "builtin_staff",
    name: "Staff / owner bot",
    description: "Office & owner quick actions on WhatsApp.",
    audience: "staff",
    welcomeBody: "Staff assistant — choose a shortcut.",
    prompts: staffPrompts.map((p) => ({
      id: p.id,
      label: p.label,
      waKeyword: p.waKeyword,
      response: `*${p.label}*\n\nStaff engine: ${p.waKeyword}.`,
    })),
  });

  const visitorWelcome = node(
    "welcome",
    "Visitor welcome",
    "Namaste — welcome to our school. Your number is not on file yet.",
    40,
  );
  const visitorList = node(
    "list",
    "Purpose picker",
    "What brings you here today?",
    160,
    {
      listRows: VISITOR_PURPOSE_OPTIONS.map((p) => ({
        id: `purpose_${p.id}`,
        title: p.keyword,
        description: p.label,
        keyword: p.keyword,
      })),
    },
  );
  const visitorHandoff = node(
    "handoff",
    "Route to team",
    "Thanks — a team member will assist you shortly.",
    300,
  );
  for (const row of visitorList.listRows || []) {
    row.nextNodeId = visitorHandoff.id;
  }
  const visitor: WaChatbotFlow = {
    id: "builtin_visitor",
    name: "Visitor welcome",
    description: "Unknown number greeting + purpose list → staff routing.",
    audience: "visitor",
    status: "built_in",
    enabled: true,
    entryNodeId: visitorWelcome.id,
    nodes: [visitorWelcome, visitorList, visitorHandoff],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  const transport = buildPromptFlow({
    id: "builtin_transport",
    name: "Transport driver bot",
    description: "Driver trip updates — route, students, GPS check-in.",
    audience: "transport",
    welcomeBody: "Transport assistant for route drivers.",
    prompts: TRANSPORT_BOT_PROMPTS.map((p) => ({
      id: p.id,
      label: p.label,
      waKeyword: p.waKeyword,
      response: `*${p.label}*\n\nTransport module: ${p.waKeyword}.`,
    })),
  });

  return [parent, admission, survey, staff, visitor, transport];
}

export function waChatbotFlowsIsEmpty(state: WaChatbotFlowsState): boolean {
  return !state.flows.some((f) => f.status !== "built_in");
}

export function defaultWaChatbotFlowsState(): WaChatbotFlowsState {
  return { version: 1, flows: seedBuiltInFlows() };
}

export function loadWaChatbotFlows(): WaChatbotFlowsState {
  if (typeof window === "undefined") return defaultWaChatbotFlowsState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultWaChatbotFlowsState();
    const parsed = JSON.parse(raw) as WaChatbotFlowsState;
    if (!parsed?.flows?.length) return defaultWaChatbotFlowsState();
    const builtins = seedBuiltInFlows();
    const custom = parsed.flows.filter((f) => f.status !== "built_in");
    const builtinIds = new Set(builtins.map((b) => b.id));
    const merged = [
      ...builtins,
      ...custom.filter((f) => !builtinIds.has(f.id)),
    ];
    return { version: 1, flows: merged };
  } catch {
    return defaultWaChatbotFlowsState();
  }
}

export function writeWaChatbotFlowsLocalRaw(state: WaChatbotFlowsState) {
  if (typeof window === "undefined") return;
  const toSave = {
    ...state,
    flows: state.flows.filter((f) => f.status !== "built_in"),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
}

export function saveWaChatbotFlows(state: WaChatbotFlowsState) {
  writeWaChatbotFlowsLocalRaw(state);
}

export function audienceLabel(a: WaChatbotAudience): string {
  return WA_CHATBOT_AUDIENCE_OPTIONS.find((o) => o.id === a)?.label || a;
}

export function createWaChatbotFlow(
  state: WaChatbotFlowsState,
  opts: {
    name: string;
    description?: string;
    audience: WaChatbotAudience;
    fromTemplateId?: string;
  },
): { state: WaChatbotFlowsState; flow: WaChatbotFlow } {
  const template = opts.fromTemplateId
    ? state.flows.find((f) => f.id === opts.fromTemplateId)
    : null;
  const now = nowIso();
  let flow: WaChatbotFlow;

  if (template) {
    const idMap = new Map<string, string>();
    const nodes = template.nodes.map((n) => {
      const newId = nid("wcn");
      idMap.set(n.id, newId);
      return { ...n, id: newId };
    });
    nodes.forEach((n) => {
      n.buttons?.forEach((b) => {
        if (b.nextNodeId) b.nextNodeId = idMap.get(b.nextNodeId) || "";
      });
      n.listRows?.forEach((r) => {
        if (r.nextNodeId) r.nextNodeId = idMap.get(r.nextNodeId) || "";
      });
    });
    flow = {
      ...template,
      id: nid("wcf"),
      name: opts.name.trim() || `Copy of ${template.name}`,
      description: opts.description || template.description,
      audience: opts.audience,
      status: "draft",
      enabled: false,
      entryNodeId: idMap.get(template.entryNodeId) || nodes[0]?.id || "",
      nodes,
      createdAt: now,
      updatedAt: now,
    };
  } else {
    const welcome = node(
      "welcome",
      "Welcome",
      "Namaste — welcome to our school WhatsApp assistant.",
      40,
    );
    const menu = node("buttons", "Main menu", "How can we help?", 160, {
      buttons: [
        { id: nid("wcb"), title: "Get started", keyword: "START" },
        { id: nid("wcb"), title: "Talk to office", keyword: "HUMAN" },
      ],
    });
    flow = {
      id: nid("wcf"),
      name: opts.name.trim() || "New chatbot",
      description: opts.description || "",
      audience: opts.audience,
      status: "draft",
      enabled: false,
      entryNodeId: welcome.id,
      nodes: [welcome, menu],
      createdAt: now,
      updatedAt: now,
    };
  }

  return {
    state: { ...state, flows: [...state.flows, flow] },
    flow,
  };
}

export function updateWaChatbotFlow(
  state: WaChatbotFlowsState,
  flowId: string,
  patch: Partial<Pick<WaChatbotFlow, "name" | "description" | "audience" | "enabled" | "nodes" | "entryNodeId" | "status">>,
): WaChatbotFlowsState {
  return {
    ...state,
    flows: state.flows.map((f) => {
      if (f.id !== flowId || f.status === "built_in") return f;
      return {
        ...f,
        ...patch,
        updatedAt: nowIso(),
      };
    }),
  };
}

export function deleteWaChatbotFlow(
  state: WaChatbotFlowsState,
  flowId: string,
): WaChatbotFlowsState {
  return {
    ...state,
    flows: state.flows.filter(
      (f) => f.id !== flowId && f.status !== "built_in",
    ),
  };
}

export function duplicateWaChatbotFlow(
  state: WaChatbotFlowsState,
  flowId: string,
): { state: WaChatbotFlowsState; flow: WaChatbotFlow } | null {
  const src = state.flows.find((f) => f.id === flowId);
  if (!src) return null;
  return createWaChatbotFlow(state, {
    name: `Copy of ${src.name}`,
    description: src.description,
    audience: src.audience,
    fromTemplateId: flowId,
  });
}

export function newPaletteNode(
  type: WaChatbotNodeType,
  y: number,
): WaChatbotNode {
  const label =
    WA_CHATBOT_NODE_PALETTE.find((p) => p.type === type)?.label || type;
  return node(type, label, `Enter ${label.toLowerCase()} text…`, y, {
    buttons: type === "buttons" ? [{ id: nid("wcb"), title: "Option 1" }] : undefined,
    listRows:
      type === "list"
        ? [{ id: nid("wclr"), title: "Row 1", description: "" }]
        : undefined,
    actionKey: type === "action" ? "general.lookup" : undefined,
  });
}

export function reorderFlowNodes(
  nodes: WaChatbotNode[],
  fromIndex: number,
  toIndex: number,
): WaChatbotNode[] {
  const next = [...nodes];
  const [item] = next.splice(fromIndex, 1);
  if (!item) return nodes;
  next.splice(toIndex, 0, item);
  return next;
}
