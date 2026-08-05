"use client";

import { useEffect, useMemo, useState } from "react";
import { FileText } from "lucide-react";
import { jsPDF } from "jspdf";
import { loadMasters, type MastersState } from "@/lib/masters";
import {
  SCHOOL_DOCUMENT_PRESETS,
  presetForType,
  type SchoolDocumentLanguage,
  type SchoolDocumentType,
} from "@/lib/schoolDocumentAi";
import {
  drawPdfDocumentSignatures,
  drawPdfLetterhead,
  drawPdfPageBackground,
  resolvePdfLetterhead,
  resolveSchoolBrandAssets,
} from "@/lib/pdfLetterhead";
import { ErpWorkspaceShell } from "@/components/ui/erp-workspace-shell";
import { useDemoSession } from "@/components/shell/SessionContext";
import { hasPermission } from "@/lib/rbac";

type GeneratedDoc = {
  titleEn: string;
  titleHi: string;
  bodyEn: string;
  bodyHi: string;
  subject: string;
};

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}|\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

export function DocumentMakerWorkspace() {
  const session = useDemoSession();
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [docType, setDocType] = useState<SchoolDocumentType>("formal_letter");
  const [language, setLanguage] = useState<SchoolDocumentLanguage>("both");
  const [details, setDetails] = useState("");
  const [generated, setGenerated] = useState<GeneratedDoc | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const canCreate = useMemo(() => {
    if (!masters) return false;
    return hasPermission(session, masters, "documents", "create");
  }, [session, masters]);

  const canExport = useMemo(() => {
    if (!masters) return false;
    return hasPermission(session, masters, "documents", "export");
  }, [session, masters]);

  useEffect(() => {
    setMasters(loadMasters());
    void (async () => {
      const { ensureMastersHydrated } = await import("@/lib/mastersPersistence");
      await ensureMastersHydrated();
      setMasters(loadMasters());
    })();
  }, []);

  const preset = presetForType(docType);

  async function generate() {
    if (!canCreate) {
      setError("You do not have permission to generate documents");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/school-document", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docType, language, details }),
      });
      const data = (await res.json()) as GeneratedDoc & {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || data.error) {
        setError(data.error || "Generation failed");
        return;
      }
      setGenerated({
        titleEn: data.titleEn || "",
        titleHi: data.titleHi || "",
        bodyEn: data.bodyEn || "",
        bodyHi: data.bodyHi || "",
        subject: data.subject || preset.defaultSubjectEn,
      });
      setNotice("Document generated — review preview below");
      window.setTimeout(() => setNotice(null), 2800);
    } catch {
      setError("Network error — try again");
    } finally {
      setLoading(false);
    }
  }

  async function printPdf() {
    if (!generated || !canExport) return;
    const m = masters ?? loadMasters();
    const letterhead = await resolvePdfLetterhead(m);
    const brand = await resolveSchoolBrandAssets(m);
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const margin = 48;
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const usable = pageW - margin * 2;

    await drawPdfPageBackground(doc, letterhead, brand, pageW, pageH);
    let y = drawPdfLetterhead(doc, letterhead, margin, usable, pageW);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(32, 48, 80);
    const title =
      language === "hi"
        ? generated.titleHi || generated.titleEn
        : generated.titleEn || generated.titleHi;
    if (title) {
      doc.text(title, pageW / 2, y, { align: "center", maxWidth: usable });
      y += 22;
    }

    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(40, 40, 40);

    const bodies: string[] = [];
    if (language === "en" || language === "both") {
      if (generated.bodyEn) bodies.push(generated.bodyEn);
    }
    if (language === "hi" || language === "both") {
      if (generated.bodyHi) bodies.push(generated.bodyHi);
    }
    const bodyText = bodies.join("\n\n");

    for (const para of splitParagraphs(bodyText)) {
      const lines = doc.splitTextToSize(para, usable);
      const blockH = lines.length * 14 + 8;
      if (y + blockH > pageH - margin - 80) {
        doc.addPage();
        await drawPdfPageBackground(doc, letterhead, brand, pageW, pageH);
        y = margin + 12;
      }
      doc.text(lines, margin, y);
      y += blockH;
    }

    await drawPdfDocumentSignatures(doc, brand, margin, pageW, pageH);
    doc.save(`school_document_${Date.now()}.pdf`);
  }

  return (
    <ErpWorkspaceShell
      title="Document maker"
      subtitle="AI letters, govt submissions, and official notices — English & Hindi with school letterhead"
      icon={<FileText className="size-6" aria-hidden />}
      notice={notice}
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <section className="space-y-4 rounded-xl border border-[rgba(32,48,80,0.1)] bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-[var(--brand-deep)]">
            Compose
          </h2>

          <label className="block text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Document type
            </span>
            <select
              className="field !py-1.5"
              value={docType}
              onChange={(e) => setDocType(e.target.value as SchoolDocumentType)}
            >
              {SCHOOL_DOCUMENT_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-[11px] text-[var(--muted)]">
              {preset.hint}
            </span>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Language
            </span>
            <select
              className="field !py-1.5"
              value={language}
              onChange={(e) =>
                setLanguage(e.target.value as SchoolDocumentLanguage)
              }
            >
              <option value="en">English</option>
              <option value="hi">Hindi</option>
              <option value="both">English + Hindi</option>
            </select>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Details for AI
            </span>
            <textarea
              className="field min-h-[140px] !py-2"
              placeholder="Student name, dates, purpose, reference numbers, addresses…"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
            />
          </label>

          {error ? (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">
              {error}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-lg bg-[var(--brand-deep)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              disabled={loading || !canCreate}
              onClick={() => void generate()}
            >
              {loading ? "Generating…" : "AI generate"}
            </button>
            {generated && canExport ? (
              <button
                type="button"
                className="rounded-lg border border-[rgba(32,48,80,0.2)] px-4 py-2 text-sm font-semibold text-[var(--brand-deep)]"
                onClick={() => void printPdf()}
              >
                Print PDF
              </button>
            ) : null}
          </div>

          {!canCreate ? (
            <p className="text-[11px] text-[var(--muted)]">
              Ask your principal for Document maker → Create permission.
            </p>
          ) : null}
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold text-[var(--brand-deep)]">
            Preview
          </h2>
          <DocumentPreview
            masters={masters}
            generated={generated}
            language={language}
          />
        </section>
      </div>
    </ErpWorkspaceShell>
  );
}

function DocumentPreview({
  masters,
  generated,
  language,
}: {
  masters: MastersState | null;
  generated: GeneratedDoc | null;
  language: SchoolDocumentLanguage;
}) {
  const profile = masters?.schoolProfile;

  return (
    <div
      className="relative min-h-[480px] overflow-hidden rounded-xl border border-[rgba(32,48,80,0.12)] bg-[#fafaf5] p-6 shadow-sm"
    >
      {profile?.pageBackgroundUrl ? (
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.08]"
          style={{
            backgroundImage: `url(${profile.pageBackgroundUrl})`,
            backgroundSize: "cover",
          }}
        />
      ) : null}
      {profile?.pageBackgroundSchoolNameRepeat && !profile?.pageBackgroundUrl ? (
        <div
          className="pointer-events-none absolute inset-0 overflow-hidden opacity-[0.07]"
          aria-hidden
        >
          <div className="grid grid-cols-3 gap-8 p-4 -rotate-12 scale-110">
            {Array.from({ length: 24 }).map((_, i) => (
              <span
                key={i}
                className="text-lg font-bold text-[var(--brand-deep)] whitespace-nowrap"
              >
                {profile.displayName}
              </span>
            ))}
          </div>
        </div>
      ) : null}
      {profile?.watermarkUrl ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={profile.watermarkUrl}
            alt=""
            className="max-h-[45%] max-w-[45%] object-contain opacity-[0.12]"
          />
        </div>
      ) : null}

      <div className="relative z-10">
        <header className="border-b border-[rgba(32,48,80,0.15)] pb-4 text-center">
          {profile?.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.logoUrl}
              alt=""
              className="mx-auto mb-2 h-12 w-12 object-contain"
            />
          ) : null}
          <div className="text-base font-bold text-[var(--brand-deep)]">
            {profile?.displayName || "School name"}
          </div>
          <div className="text-[11px] text-[var(--muted)]">
            {profile?.tagline || ""}
          </div>
          <div className="mt-1 text-[10px] text-[var(--muted)]">
            {[profile?.address, profile?.city, profile?.state]
              .filter(Boolean)
              .join(", ")}
          </div>
        </header>

        {generated ? (
          <div className="mt-6 space-y-4 text-sm text-[#333]">
            {(language === "en" || language === "both") && generated.titleEn ? (
              <h3 className="text-center font-bold text-[var(--brand-deep)]">
                {generated.titleEn}
              </h3>
            ) : null}
            {(language === "hi" || language === "both") && generated.titleHi ? (
              <h3 className="text-center font-bold text-[var(--brand-deep)]">
                {generated.titleHi}
              </h3>
            ) : null}
            {(language === "en" || language === "both") && generated.bodyEn ? (
              <div className="space-y-2 whitespace-pre-wrap">{generated.bodyEn}</div>
            ) : null}
            {(language === "hi" || language === "both") && generated.bodyHi ? (
              <div className="space-y-2 whitespace-pre-wrap">{generated.bodyHi}</div>
            ) : null}
          </div>
        ) : (
          <p className="mt-8 text-center text-sm text-[var(--muted)]">
            Generate a document to see letterhead, watermark, and stamp preview.
          </p>
        )}

        {generated && profile ? (
          <footer className="mt-10 flex justify-between gap-4 border-t border-[rgba(32,48,80,0.08)] pt-4">
            {profile.directorSignatureUrl ? (
              <div className="text-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={profile.directorSignatureUrl}
                  alt="Director sign"
                  className="mx-auto h-12 object-contain"
                />
                <span className="text-[10px] text-[var(--muted)]">Director</span>
              </div>
            ) : null}
            {profile.principalStampSignatureUrl ? (
              <div className="text-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={profile.principalStampSignatureUrl}
                  alt="Principal stamp"
                  className="mx-auto h-12 object-contain"
                />
                <span className="text-[10px] text-[var(--muted)]">Principal</span>
              </div>
            ) : null}
            {profile.directorStampSignatureUrl ? (
              <div className="text-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={profile.directorStampSignatureUrl}
                  alt="Director stamp"
                  className="mx-auto h-12 object-contain"
                  style={{ filter: "hue-rotate(180deg) saturate(1.4)" }}
                />
                <span className="text-[10px] text-[var(--muted)]">
                  Director (Stamp)
                </span>
              </div>
            ) : null}
          </footer>
        ) : null}
      </div>
    </div>
  );
}
