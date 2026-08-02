/**
 * School document vault (§21a) — statutory docs + expiry alerts.
 * Demo store: localStorage `bhb_vault_v1`.
 */

import { assertModulePermission } from "@/lib/rbacGuard";
import { TENANT } from "@/lib/types";
import {
  describeFilters,
  exportFilterReport,
  type ReportColumn,
} from "@/lib/reportExport";

const STORAGE_KEY = "bhb_vault_v1";

let serverVaultCache: VaultState | null = null;

export type VaultDocType =
  | "fire_noc"
  | "building_safety"
  | "land_lease"
  | "society_reg"
  | "udise"
  | "recognition"
  | "cbse_affiliation"
  | "bus_permit"
  | "insurance"
  | "puc"
  | "trust_pan"
  | "12a_80g"
  | "other";

export type VaultDocument = {
  id: string;
  docType: VaultDocType;
  title: string;
  fileUrl: string;
  fileName: string;
  issuedOn: string;
  expiresOn: string;
  reminderDays: number;
  ownerRole: string;
  note: string;
  createdAt: string;
  updatedAt: string;
};

export type VaultSettings = {
  /** Comma-separated mobiles for expiry WhatsApp digests */
  digestMobiles: string;
  lastExpiryDigestAt?: string;
};

export type VaultState = {
  version: 1;
  documents: VaultDocument[];
  settings: VaultSettings;
};

export const VAULT_DOC_TYPES: { id: VaultDocType; label: string }[] = [
  { id: "fire_noc", label: "Fire NOC" },
  { id: "building_safety", label: "Building safety" },
  { id: "land_lease", label: "Land / lease" },
  { id: "society_reg", label: "Society registration" },
  { id: "udise", label: "UDISE certificate" },
  { id: "recognition", label: "Recognition" },
  { id: "cbse_affiliation", label: "CBSE affiliation" },
  { id: "bus_permit", label: "Bus permit" },
  { id: "insurance", label: "Insurance" },
  { id: "puc", label: "PUC" },
  { id: "trust_pan", label: "Trust PAN" },
  { id: "12a_80g", label: "12A / 80G" },
  { id: "other", label: "Other" },
];

function nid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}
function nowIso() {
  return new Date().toISOString();
}
function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function vaultDocTypeLabel(id: VaultDocType): string {
  return VAULT_DOC_TYPES.find((t) => t.id === id)?.label ?? id;
}

export function emptyVaultState(): VaultState {
  return {
    version: 1,
    documents: [],
    settings: { digestMobiles: "" },
  };
}

export function loadVault(): VaultState {
  if (typeof window === "undefined") {
    if (serverVaultCache) return serverVaultCache;
    return emptyVaultState();
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyVaultState();
    const parsed = JSON.parse(raw) as Partial<VaultState>;
    return {
      version: 1,
      documents: Array.isArray(parsed.documents)
        ? (parsed.documents as VaultDocument[])
        : [],
      settings: {
        digestMobiles: parsed.settings?.digestMobiles ?? "",
        lastExpiryDigestAt: parsed.settings?.lastExpiryDigestAt,
      },
    };
  } catch {
    return emptyVaultState();
  }
}

export function saveVault(state: VaultState): void {
  if (!assertModulePermission("vault", "edit", "saveVault")) return;

  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  void import("@/lib/vaultPersistence").then(({ scheduleVaultSync }) => {
    scheduleVaultSync(state);
  });

}

export function writeVaultLocalRaw(state: VaultState) {
  if (typeof window === "undefined") {
    serverVaultCache = state;
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function vaultStateIsEmpty(state: VaultState): boolean {
  return (state.documents?.length ?? 0) === 0;
}


export function seedVaultIfEmpty(): VaultState {
  const existing = loadVault();
  if (existing.documents.length > 0) return existing;
  const today = todayIso();
  const y = Number(today.slice(0, 4));
  const docs: VaultDocument[] = [
    {
      id: nid("vdoc"),
      docType: "fire_noc",
      title: "Fire NOC — Main campus",
      fileUrl: "",
      fileName: "",
      issuedOn: `${y - 1}-04-01`,
      expiresOn: `${y}-03-31`,
      reminderDays: 45,
      ownerRole: "principal",
      note: "Renew before session start",
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
    {
      id: nid("vdoc"),
      docType: "building_safety",
      title: "Building safety certificate",
      fileUrl: "",
      fileName: "",
      issuedOn: `${y - 1}-06-15`,
      expiresOn: `${y + 1}-06-14`,
      reminderDays: 60,
      ownerRole: "admin",
      note: "",
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
    {
      id: nid("vdoc"),
      docType: "recognition",
      title: "UP Basic recognition",
      fileUrl: "",
      fileName: "",
      issuedOn: `${y - 2}-07-01`,
      expiresOn: "",
      reminderDays: 90,
      ownerRole: "principal",
      note: "No expiry — keep on file",
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
  ];
  const next = { ...existing, documents: docs };
  saveVault(next);
  return next;
}

export function upsertVaultDocument(
  input: Partial<VaultDocument> & {
    docType: VaultDocType;
    title: string;
  },
): { ok: true; document: VaultDocument } | { ok: false; error: string } {
  if (!input.title.trim()) return { ok: false, error: "Title required" };
  const state = loadVault();
  const now = nowIso();
  if (input.id) {
    const i = state.documents.findIndex((d) => d.id === input.id);
    if (i < 0) return { ok: false, error: "Document not found" };
    const document: VaultDocument = {
      ...state.documents[i],
      ...input,
      title: input.title.trim(),
      updatedAt: now,
    };
    const documents = [...state.documents];
    documents[i] = document;
    saveVault({ ...state, documents });
    return { ok: true, document };
  }
  const document: VaultDocument = {
    id: nid("vdoc"),
    docType: input.docType,
    title: input.title.trim(),
    fileUrl: input.fileUrl || "",
    fileName: input.fileName || "",
    issuedOn: input.issuedOn || "",
    expiresOn: input.expiresOn || "",
    reminderDays:
      typeof input.reminderDays === "number" ? input.reminderDays : 30,
    ownerRole: input.ownerRole || "principal",
    note: input.note || "",
    createdAt: now,
    updatedAt: now,
  };
  saveVault({ ...state, documents: [document, ...state.documents] });
  return { ok: true, document };
}

export function deleteVaultDocument(
  id: string,
): { ok: true } | { ok: false; error: string } {
  const state = loadVault();
  if (!state.documents.some((d) => d.id === id)) {
    return { ok: false, error: "Not found" };
  }
  saveVault({
    ...state,
    documents: state.documents.filter((d) => d.id !== id),
  });
  return { ok: true };
}

export type VaultExpiryStatus = "ok" | "due_soon" | "expired" | "none";

export function vaultExpiryStatus(
  doc: VaultDocument,
  asOf = todayIso(),
): VaultExpiryStatus {
  if (!doc.expiresOn) return "none";
  if (doc.expiresOn < asOf) return "expired";
  const rem = doc.reminderDays || 30;
  const soon = new Date(asOf + "T00:00:00");
  soon.setDate(soon.getDate() + rem);
  const soonYmd = soon.toISOString().slice(0, 10);
  if (doc.expiresOn <= soonYmd) return "due_soon";
  return "ok";
}

export function listVaultAlerts(
  state?: VaultState,
  asOf = todayIso(),
): VaultDocument[] {
  const vault = state ?? loadVault();
  return vault.documents
    .filter((d) => {
      const s = vaultExpiryStatus(d, asOf);
      return s === "expired" || s === "due_soon";
    })
    .sort((a, b) => (a.expiresOn || "9999").localeCompare(b.expiresOn || "9999"));
}

export type VaultReportId = "inventory" | "expiry_calendar";

export const VAULT_REPORTS: { id: VaultReportId; label: string; hint?: string }[] =
  [
    { id: "inventory", label: "Vault inventory", hint: "All documents" },
    {
      id: "expiry_calendar",
      label: "Expiry calendar",
      hint: "Expiring / expired with status",
    },
  ];

export function runVaultReport(
  id: VaultReportId,
  filters: { format: "excel" | "pdf"; vault?: VaultState },
): { ok: true; message: string } | { ok: false; error: string } {
  const vault = filters.vault ?? loadVault();
  const note = describeFilters([TENANT.shortName, todayIso()]);
  const asOf = todayIso();

  if (id === "inventory") {
    const rows = vault.documents.map((d) => ({
      type: vaultDocTypeLabel(d.docType),
      title: d.title,
      issued: d.issuedOn || "—",
      expires: d.expiresOn || "—",
      owner: d.ownerRole,
      status: vaultExpiryStatus(d, asOf),
    }));
    const r = exportFilterReport(
      {
        title: "Document vault inventory",
        subtitle: TENANT.shortName,
        filterNote: note,
        columns: [
          { key: "type", header: "Type" },
          { key: "title", header: "Title" },
          { key: "issued", header: "Issued" },
          { key: "expires", header: "Expires" },
          { key: "owner", header: "Owner" },
          { key: "status", header: "Status" },
        ],
        rows,
        fileBaseName: "vault_inventory",
      },
      filters.format,
    );
    return r.ok
      ? { ok: true, message: `Inventory: ${rows.length} doc(s)` }
      : r;
  }

  const rows = listVaultAlerts(vault, asOf).map((d) => ({
    type: vaultDocTypeLabel(d.docType),
    title: d.title,
    expires: d.expiresOn,
    status: vaultExpiryStatus(d, asOf),
    owner: d.ownerRole,
    reminder: d.reminderDays,
  }));
  const r = exportFilterReport(
    {
      title: "Vault expiry calendar",
      subtitle: TENANT.shortName,
      filterNote: note,
      columns: [
        { key: "status", header: "Status" },
        { key: "expires", header: "Expires" },
        { key: "type", header: "Type" },
        { key: "title", header: "Title" },
        { key: "owner", header: "Owner" },
        { key: "reminder", header: "Remind days", align: "right" },
      ],
      rows,
      fileBaseName: "vault_expiry",
    },
    filters.format,
  );
  return r.ok
    ? { ok: true, message: `Expiry alerts: ${rows.length}` }
    : r;
}

export function parseVaultDigestMobiles(raw: string): string[] {
  return raw
    .split(/[,;\s]+/)
    .map((m) => m.replace(/\D/g, ""))
    .filter((m) => m.length >= 10);
}

export function saveVaultDigestMobiles(digestMobiles: string): void {
  const state = loadVault();
  saveVault({
    ...state,
    settings: { ...state.settings, digestMobiles },
  });
}

export function markVaultExpiryDigestSent(): void {
  const state = loadVault();
  saveVault({
    ...state,
    settings: { ...state.settings, lastExpiryDigestAt: nowIso() },
  });
}

export function composeWhatsAppVaultExpiryDigest(input: {
  schoolName?: string;
  asOf?: string;
  docs: VaultDocument[];
}): string {
  const school = input.schoolName || TENANT.nameDisplay || TENANT.shortName;
  const asOf = input.asOf || todayIso();
  const lines = input.docs.slice(0, 12).map((d) => {
    const st = vaultExpiryStatus(d, asOf);
    const tag = st === "expired" ? "EXPIRED" : "DUE SOON";
    return `• [${tag}] ${d.title} (${vaultDocTypeLabel(d.docType)}) → ${d.expiresOn || "—"}`;
  });
  const more =
    input.docs.length > 12 ? `\n… +${input.docs.length - 12} more` : "";
  return [
    `*${school}*`,
    `Document vault — expiry digest`,
    `As of ${asOf}`,
    "",
    lines.join("\n") + more,
    "",
    "Open Vault → Alerts to renew / file updates.",
  ].join("\n");
}
