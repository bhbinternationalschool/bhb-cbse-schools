"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { ModuleTabs, type ModuleTabItem } from "@/components/ui/ModuleTabs";
import { ErpWorkspaceShell } from "@/components/ui/erp-workspace-shell";
import { ModuleDashboardHost } from "@/components/dashboard/ModuleDashboardHost";
import { useModuleTabQuery } from "@/lib/useModuleTabQuery";
import {
  composeWhatsAppVaultExpiryDigest,
  deleteVaultDocument,
  listVaultAlerts,
  markVaultExpiryDigestSent,
  parseVaultDigestMobiles,
  runVaultReport,
  saveVaultDigestMobiles,
  seedVaultIfEmpty,
  upsertVaultDocument,
  vaultDocTypeLabel,
  vaultExpiryStatus,
  VAULT_DOC_TYPES,
  VAULT_REPORTS,
  type VaultDocType,
  type VaultDocument,
  type VaultReportId,
  type VaultState,
} from "@/lib/vault";
import { readImageAsDataUrl } from "@/lib/homework";
import { openWaMe, waMeUrl } from "@/lib/waMe";
import { btn, btnOutline, field } from "@/components/ui/erp-ui";

type VaultTab = "dashboard" | "alerts" | "documents" | "add" | "reports";

const TABS: ModuleTabItem[] = [
  { id: "dashboard", label: "Dashboard", tone: "navy" },
  { id: "alerts", label: "Alerts", tone: "rose" },
  { id: "documents", label: "Documents", tone: "navy" },
  { id: "add", label: "Add", tone: "teal" },
  { id: "reports", label: "Reports", tone: "slate" },
];

function statusLabel(status: ReturnType<typeof vaultExpiryStatus>): string {
  if (status === "expired") return "Expired";
  if (status === "due_soon") return "Due soon";
  if (status === "ok") return "OK";
  return "No expiry";
}

function statusTone(status: ReturnType<typeof vaultExpiryStatus>): string {
  if (status === "expired") return "text-[#b42318]";
  if (status === "due_soon") return "text-[#b45309]";
  if (status === "ok") return "text-[#0f7a4c]";
  return "text-[var(--muted)]";
}

function DocRow({
  doc,
  onEdit,
  onDelete,
}: {
  doc: VaultDocument;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const status = vaultExpiryStatus(doc);
  return (
    <li className="rounded-xl border border-[rgba(32,48,80,0.1)] bg-white px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-[var(--brand-deep)]">
            {doc.title}
          </p>
          <p className="text-xs text-[var(--muted)]">
            {vaultDocTypeLabel(doc.docType)} · owner {doc.ownerRole}
          </p>
          <p className="text-xs text-[var(--muted)]">
            Issued {doc.issuedOn || "—"} · Expires {doc.expiresOn || "—"} ·{" "}
            <span className={statusTone(status)}>{statusLabel(status)}</span>
          </p>
          {doc.note ? (
            <p className="mt-1 text-sm text-[var(--brand-deep)]">{doc.note}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btnOutline} onClick={onEdit}>
            Edit
          </button>
          <button
            type="button"
            className="text-xs text-[#b42318] underline"
            onClick={onDelete}
          >
            Delete
          </button>
        </div>
      </div>
    </li>
  );
}

export function VaultWorkspace() {
  const [tab, setTab] = useModuleTabQuery<VaultTab>("dashboard", [
    "dashboard",
    "alerts",
    "documents",
    "add",
    "reports",
  ]);
  const [state, setState] = useState<VaultState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reportFormat, setReportFormat] = useState<"excel" | "pdf">("excel");

  const [editId, setEditId] = useState("");
  const [docType, setDocType] = useState<VaultDocType>("fire_noc");
  const [title, setTitle] = useState("");
  const [issuedOn, setIssuedOn] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [reminderDays, setReminderDays] = useState(30);
  const [ownerRole, setOwnerRole] = useState("principal");
  const [note, setNote] = useState("");
  const [fileUrl, setFileUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [digestMobiles, setDigestMobiles] = useState("");
  const [docQuery, setDocQuery] = useState("");
  const [docTypeFilter, setDocTypeFilter] = useState<VaultDocType | "all">("all");
  const [docStatusFilter, setDocStatusFilter] = useState<
    "all" | "expired" | "due_soon" | "ok" | "none"
  >("all");

  function flash(msg: string) {
    setNotice(msg);
    setError(null);
    window.setTimeout(() => setNotice(null), 2800);
  }

  function refresh() {
    const v = seedVaultIfEmpty();
    setState(v);
    setDigestMobiles(v.settings.digestMobiles || "");
  }

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    void (async () => {
      const { ensureVaultHydrated } = await import("@/lib/vaultPersistence");
      await ensureVaultHydrated();
      refresh();
    })();
  }, []);

  const alerts = useMemo(() => {
    if (!state) return [];
    return listVaultAlerts(state);
  }, [state]);

  const filteredDocuments = useMemo(() => {
    if (!state) return [];
    const q = docQuery.trim().toLowerCase();
    return state.documents.filter((doc) => {
      if (docTypeFilter !== "all" && doc.docType !== docTypeFilter) return false;
      const status = vaultExpiryStatus(doc);
      if (docStatusFilter !== "all" && status !== docStatusFilter) return false;
      if (!q) return true;
      const blob =
        `${doc.title} ${doc.note} ${doc.ownerRole} ${vaultDocTypeLabel(doc.docType)}`.toLowerCase();
      return blob.includes(q);
    });
  }, [state, docQuery, docTypeFilter, docStatusFilter]);

  function resetForm() {
    setEditId("");
    setDocType("fire_noc");
    setTitle("");
    setIssuedOn("");
    setExpiresOn("");
    setReminderDays(30);
    setOwnerRole("principal");
    setNote("");
    setFileUrl("");
    setFileName("");
  }

  function loadDocIntoForm(doc: VaultDocument) {
    setEditId(doc.id);
    setDocType(doc.docType);
    setTitle(doc.title);
    setIssuedOn(doc.issuedOn);
    setExpiresOn(doc.expiresOn);
    setReminderDays(doc.reminderDays);
    setOwnerRole(doc.ownerRole);
    setNote(doc.note);
    setFileUrl(doc.fileUrl);
    setFileName(doc.fileName);
    setTab("add");
  }

  function saveDoc() {
    const r = upsertVaultDocument({
      id: editId || undefined,
      docType,
      title,
      issuedOn,
      expiresOn,
      reminderDays,
      ownerRole,
      note,
      fileUrl,
      fileName,
    });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    resetForm();
    refresh();
    flash(editId ? "Document updated" : "Document added");
    setTab("documents");
  }

  if (!state) {
    return (
      <div className="px-4 py-8 text-sm text-[var(--muted)]">
        Loading document vault…
      </div>
    );
  }

  return (
    <ErpWorkspaceShell
      title="Document vault"
      subtitle="Statutory certificates · expiry alerts · compliance (§21a)"
      icon={<ShieldCheck className="size-6" aria-hidden />}
      error={error}
      notice={notice}
      actions={
        <Link href="/reports?module=vault" className={btnOutline}>
          Reports Center
        </Link>
      }
    >
      <ModuleTabs
        items={TABS.map((t) =>
          t.id === "alerts"
            ? { ...t, badge: alerts.length || undefined }
            : t,
        )}
        value={tab}
        onChange={(id) => setTab(id as VaultTab)}
      />

      {tab === "dashboard" ? (
        <ModuleDashboardHost
          moduleId="vault"
          onNavigateTab={(t) => setTab(t as VaultTab)}
        />
      ) : null}

      {tab === "alerts" ? (
        <section className="mt-4 space-y-4">
          <div className="rounded-xl border border-[rgba(180,83,9,0.25)] bg-[rgba(180,83,9,0.06)] px-4 py-3">
            <p className="text-sm font-semibold text-[var(--brand-deep)]">
              WhatsApp expiry digest
            </p>
            <p className="mt-0.5 text-[11px] text-[var(--muted)]">
              Send expired / due-soon list to principal & admin phones (wa.me).
              {state?.settings.lastExpiryDigestAt
                ? ` Last sent ${state.settings.lastExpiryDigestAt.slice(0, 16).replace("T", " ")}`
                : ""}
            </p>
            <label className="mt-2 block text-xs text-[var(--muted)]">
              Recipient mobiles (comma-separated)
              <input
                className={`${field} mt-1 w-full max-w-md`}
                value={digestMobiles}
                onChange={(e) => setDigestMobiles(e.target.value)}
                placeholder="9876543210, 9123456780"
              />
            </label>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                className={btnOutline}
                onClick={() => {
                  saveVaultDigestMobiles(digestMobiles);
                  refresh();
                  flash("Digest recipients saved");
                }}
              >
                Save recipients
              </button>
              <button
                type="button"
                className={btn}
                disabled={alerts.length === 0}
                onClick={() => {
                  saveVaultDigestMobiles(digestMobiles);
                  const phones = parseVaultDigestMobiles(digestMobiles);
                  if (!phones.length) {
                    setError("Add at least one 10-digit mobile");
                    return;
                  }
                  if (!alerts.length) {
                    setError("No expiry alerts to send");
                    return;
                  }
                  const msg = composeWhatsAppVaultExpiryDigest({
                    docs: alerts,
                  });
                  openWaMe(phones[0], msg);
                  for (let i = 1; i < Math.min(phones.length, 5); i++) {
                    window.setTimeout(
                      () => openWaMe(phones[i], msg),
                      i * 600,
                    );
                  }
                  try {
                    void navigator.clipboard?.writeText(msg);
                  } catch {
                    /* ignore */
                  }
                  markVaultExpiryDigestSent();
                  refresh();
                  flash(
                    `Opened WhatsApp for ${Math.min(phones.length, 5)} recipient(s)`,
                  );
                }}
              >
                Send digest ({alerts.length})
              </button>
              <button
                type="button"
                className={btnOutline}
                disabled={alerts.length === 0}
                onClick={() => {
                  const msg = composeWhatsAppVaultExpiryDigest({ docs: alerts });
                  try {
                    void navigator.clipboard?.writeText(msg);
                    flash("Digest copied");
                  } catch {
                    setError("Could not copy");
                  }
                }}
              >
                Copy message
              </button>
            </div>
            {parseVaultDigestMobiles(digestMobiles)[0] && alerts.length ? (
              <a
                className="mt-2 inline-block text-xs text-[var(--brand-deep)] underline"
                href={waMeUrl(
                  parseVaultDigestMobiles(digestMobiles)[0],
                  composeWhatsAppVaultExpiryDigest({ docs: alerts }),
                )}
                target="_blank"
                rel="noreferrer"
              >
                Preview first link
              </a>
            ) : null}
          </div>

          {alerts.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">
              No expiry alerts — all documents current.
            </p>
          ) : (
            <ul className="space-y-2">
              {alerts.map((doc) => (
                <DocRow
                  key={doc.id}
                  doc={doc}
                  onEdit={() => loadDocIntoForm(doc)}
                  onDelete={() => {
                    const r = deleteVaultDocument(doc.id);
                    if (!r.ok) setError(r.error);
                    else {
                      refresh();
                      flash("Deleted");
                    }
                  }}
                />
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {tab === "documents" ? (
        <section className="mt-4 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-[200px] flex-1 text-xs text-[var(--muted)]">
              Search
              <input
                className={`${field} mt-1`}
                placeholder="Title, note, owner…"
                value={docQuery}
                onChange={(e) => setDocQuery(e.target.value)}
              />
            </label>
            <label className="text-xs text-[var(--muted)]">
              Type
              <select
                className={`${field} mt-1`}
                value={docTypeFilter}
                onChange={(e) =>
                  setDocTypeFilter(e.target.value as VaultDocType | "all")
                }
              >
                <option value="all">All types</option>
                {VAULT_DOC_TYPES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-[var(--muted)]">
              Status
              <select
                className={`${field} mt-1`}
                value={docStatusFilter}
                onChange={(e) =>
                  setDocStatusFilter(
                    e.target.value as typeof docStatusFilter,
                  )
                }
              >
                <option value="all">All</option>
                <option value="expired">Expired</option>
                <option value="due_soon">Due soon</option>
                <option value="ok">OK</option>
                <option value="none">No expiry</option>
              </select>
            </label>
          </div>
          {filteredDocuments.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">
              {state.documents.length === 0
                ? "No documents yet. "
                : "No documents match your filters. "}
              {state.documents.length === 0 ? (
                <button
                  type="button"
                  className="underline"
                  onClick={() => setTab("add")}
                >
                  Add one
                </button>
              ) : null}
            </p>
          ) : (
            <ul className="space-y-2">
              {filteredDocuments.map((doc) => (
                <DocRow
                  key={doc.id}
                  doc={doc}
                  onEdit={() => loadDocIntoForm(doc)}
                  onDelete={() => {
                    const r = deleteVaultDocument(doc.id);
                    if (!r.ok) setError(r.error);
                    else {
                      refresh();
                      flash("Deleted");
                    }
                  }}
                />
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {tab === "add" ? (
        <section className="mt-4 max-w-xl space-y-3">
          <h2 className="text-sm font-semibold text-[var(--brand-deep)]">
            {editId ? "Edit document" : "Add document"}
          </h2>
          <label className="block text-xs text-[var(--muted)]">
            Type
            <select
              className={`${field} mt-1 w-full`}
              value={docType}
              onChange={(e) => setDocType(e.target.value as VaultDocType)}
            >
              {VAULT_DOC_TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-[var(--muted)]">
            Title
            <input
              className={`${field} mt-1 w-full`}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <div className="flex flex-wrap gap-3">
            <label className="text-xs text-[var(--muted)]">
              Issued on
              <input
                type="date"
                className={`${field} mt-1 block`}
                value={issuedOn}
                onChange={(e) => setIssuedOn(e.target.value)}
              />
            </label>
            <label className="text-xs text-[var(--muted)]">
              Expires on
              <input
                type="date"
                className={`${field} mt-1 block`}
                value={expiresOn}
                onChange={(e) => setExpiresOn(e.target.value)}
              />
            </label>
            <label className="text-xs text-[var(--muted)]">
              Remind (days)
              <input
                type="number"
                min={1}
                className={`${field} mt-1 block w-24`}
                value={reminderDays}
                onChange={(e) => setReminderDays(Number(e.target.value))}
              />
            </label>
          </div>
          <label className="block text-xs text-[var(--muted)]">
            Owner role
            <input
              className={`${field} mt-1 w-full`}
              value={ownerRole}
              onChange={(e) => setOwnerRole(e.target.value)}
              placeholder="principal, admin…"
            />
          </label>
          <label className="block text-xs text-[var(--muted)]">
            File URL (optional)
            <input
              className={`${field} mt-1 w-full`}
              value={fileUrl}
              onChange={(e) => setFileUrl(e.target.value)}
            />
          </label>
          <label className="block text-xs text-[var(--muted)]">
            Or upload image / PDF
            <input
              type="file"
              accept="image/*,application/pdf"
              className={`${field} mt-1 block w-full text-xs`}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const r = await readImageAsDataUrl(file);
                if (!r.ok) {
                  setError(r.error);
                  return;
                }
                setFileUrl(r.url);
                setFileName(file.name);
                flash(`Attached ${file.name}`);
              }}
            />
          </label>
          <label className="block text-xs text-[var(--muted)]">
            Note
            <textarea
              className={`${field} mt-1 w-full`}
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btn} onClick={saveDoc}>
              {editId ? "Update" : "Save"}
            </button>
            {editId ? (
              <button type="button" className={btnOutline} onClick={resetForm}>
                Cancel edit
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      {tab === "reports" ? (
        <section className="mt-4 space-y-3">
          <label className="text-xs text-[var(--muted)]">
            Format
            <select
              className={`${field} mt-1 block`}
              value={reportFormat}
              onChange={(e) =>
                setReportFormat(e.target.value as "excel" | "pdf")
              }
            >
              <option value="excel">Excel</option>
              <option value="pdf">PDF</option>
            </select>
          </label>
          <ul className="space-y-1.5">
            {VAULT_REPORTS.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[rgba(32,48,80,0.08)] bg-white px-3 py-2"
              >
                <div>
                  <p className="text-sm font-medium text-[var(--brand-deep)]">
                    {r.label}
                  </p>
                  {r.hint ? (
                    <p className="text-xs text-[var(--muted)]">{r.hint}</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  className={btn}
                  onClick={() => {
                    const res = runVaultReport(r.id as VaultReportId, {
                      format: reportFormat,
                      vault: state,
                    });
                    if (!res.ok) setError(res.error);
                    else flash(res.message);
                  }}
                >
                  Export
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </ErpWorkspaceShell>
  );
}
