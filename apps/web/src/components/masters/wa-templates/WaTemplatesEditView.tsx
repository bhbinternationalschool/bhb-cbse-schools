"use client";

import { useEffect, useState } from "react";
import {
  insertWaVariableToken,
  readWaTemplateMediaFile,
  statusTone,
  updateTemplateLocal,
  type WaCarouselCard,
  type WaHeaderFormat,
  type WaTemplate,
  type WaTemplateButton,
} from "@/lib/waTemplates";
import { WaTemplateVariablesPicker } from "@/components/masters/WaTemplateVariablesPicker";
import { WaTemplateContentHelper } from "./WaTemplateContentHelper";
import { MastersWorkCard } from "@/components/masters/MastersLayout";
import { waBtnOutline, waBtnPrimary, waBtnTeal, waInp } from "./waTemplateUi";

function TemplateEditor({
  template,
  readOnly,
  submitting,
  onSubmitMeta,
  onSave,
}: {
  template: WaTemplate;
  readOnly: boolean;
  submitting: boolean;
  onSubmitMeta: () => void;
  onSave: (
    patch: Parameters<typeof updateTemplateLocal>[2],
    msg?: string,
  ) => void;
}) {
  const [body, setBody] = useState(template.body);
  const [fallback, setFallback] = useState(template.localFallbackBody);
  const [metaName, setMetaName] = useState(template.metaName);
  const [footer, setFooter] = useState(template.footer);
  const [headerFormat, setHeaderFormat] = useState<WaHeaderFormat>(
    template.headerFormat,
  );
  const [headerText, setHeaderText] = useState(template.headerText);
  const [mediaUrl, setMediaUrl] = useState(template.mediaUrl);
  const [mediaFileName, setMediaFileName] = useState(template.mediaFileName);
  const [carousel, setCarousel] = useState<WaCarouselCard[]>(template.carousel);
  const [mediaNotice, setMediaNotice] = useState<string | null>(null);
  const [btn1, setBtn1] = useState(template.buttons[0]?.text || "");
  const [btn2, setBtn2] = useState(template.buttons[1]?.text || "");
  const [btn3, setBtn3] = useState(template.buttons[2]?.text || "");

  useEffect(() => {
    setBody(template.body);
    setFallback(template.localFallbackBody);
    setMetaName(template.metaName);
    setFooter(template.footer);
    setHeaderFormat(template.headerFormat);
    setHeaderText(template.headerText);
    setMediaUrl(template.mediaUrl);
    setMediaFileName(template.mediaFileName);
    setCarousel(template.carousel);
    setBtn1(template.buttons[0]?.text || "");
    setBtn2(template.buttons[1]?.text || "");
    setBtn3(template.buttons[2]?.text || "");
  }, [
    template.id,
    template.body,
    template.localFallbackBody,
    template.metaName,
    template.footer,
    template.headerFormat,
    template.headerText,
    template.mediaUrl,
    template.mediaFileName,
    template.carousel,
    template.buttons,
  ]);

  function buildButtons(): WaTemplateButton[] {
    return [btn1, btn2, btn3]
      .map((t) => t.trim())
      .filter(Boolean)
      .map((text) => ({ type: "QUICK_REPLY" as const, text }));
  }

  function buildPatch() {
    return {
      body,
      localFallbackBody: fallback,
      metaName,
      footer,
      headerFormat,
      headerText,
      mediaUrl,
      mediaFileName,
      carousel,
      buttons: buildButtons(),
    };
  }

  async function onHeaderFile(file: File | null) {
    if (!file || readOnly) return;
    const kind =
      headerFormat === "DOCUMENT"
        ? "document"
        : headerFormat === "VIDEO"
          ? "video"
          : "image";
    const r = await readWaTemplateMediaFile(file, kind);
    if (!r.ok) {
      setMediaNotice(r.error);
      window.setTimeout(() => setMediaNotice(null), 3200);
      return;
    }
    setMediaUrl(r.dataUrl);
    setMediaFileName(r.fileName);
    setMediaNotice(`Uploaded ${r.fileName}`);
    window.setTimeout(() => setMediaNotice(null), 2200);
  }

  async function onCarouselFile(cardId: string, file: File | null) {
    if (!file || readOnly) return;
    const card = carousel.find((c) => c.id === cardId);
    const kind = card?.headerFormat === "VIDEO" ? "video" : "image";
    const r = await readWaTemplateMediaFile(file, kind);
    if (!r.ok) {
      setMediaNotice(r.error);
      window.setTimeout(() => setMediaNotice(null), 3200);
      return;
    }
    setCarousel((prev) =>
      prev.map((c) =>
        c.id === cardId
          ? { ...c, mediaUrl: r.dataUrl, mediaFileName: r.fileName }
          : c,
      ),
    );
  }

  const canSubmit =
    !readOnly &&
    template.status !== "approved" &&
    body.trim().length > 0 &&
    metaName.trim().length > 0;

  const needsMediaHeader =
    headerFormat === "IMAGE" ||
    headerFormat === "VIDEO" ||
    headerFormat === "DOCUMENT";

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-3 text-[12px]">
        <div className="flex flex-wrap gap-2">
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${statusTone(template.status)}`}
          >
            {template.status}
          </span>
          {template.rejectionReason ? (
            <span className="text-[11px] text-rose-700">
              Rejected: {template.rejectionReason}
            </span>
          ) : null}
          {mediaNotice ? (
            <span className="text-[11px] text-[#0f766e]">{mediaNotice}</span>
          ) : null}
        </div>

        <label className="block text-[11px] font-semibold text-[var(--muted)]">
          Meta template name
          <input
            className={`${waInp} mt-1 font-mono text-[11px]`}
            value={metaName}
            disabled={readOnly}
            onChange={(e) => setMetaName(e.target.value)}
          />
        </label>

        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block text-[11px] font-semibold text-[var(--muted)]">
            Header type
            <select
              className={`${waInp} mt-1 text-[11px]`}
              value={headerFormat}
              disabled={readOnly}
              onChange={(e) =>
                setHeaderFormat(e.target.value as WaHeaderFormat)
              }
            >
              <option value="NONE">None</option>
              <option value="TEXT">Text</option>
              <option value="IMAGE">Image (JPG/PNG)</option>
              <option value="VIDEO">Video (MP4)</option>
              <option value="DOCUMENT">Document (PDF)</option>
            </select>
          </label>
          {headerFormat === "TEXT" ? (
            <label className="block text-[11px] font-semibold text-[var(--muted)]">
              Header text
              <input
                className={`${waInp} mt-1 text-[11px]`}
                value={headerText}
                disabled={readOnly}
                onChange={(e) => setHeaderText(e.target.value)}
              />
            </label>
          ) : null}
        </div>

        {needsMediaHeader ? (
          <div className="rounded-lg border border-[var(--border)] p-2">
            <p className="text-[11px] font-semibold text-[var(--brand-deep)]">
              Header media upload
            </p>
            <input
              type="file"
              disabled={readOnly}
              className="mt-2 text-[11px]"
              accept={
                headerFormat === "DOCUMENT"
                  ? "application/pdf"
                  : headerFormat === "VIDEO"
                    ? "video/mp4"
                    : "image/jpeg,image/png,image/webp"
              }
              onChange={(e) => void onHeaderFile(e.target.files?.[0] || null)}
            />
            {mediaFileName ? (
              <span className="text-[10px] text-[var(--muted)]">
                {mediaFileName}
              </span>
            ) : null}
            {mediaUrl && headerFormat === "IMAGE" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={mediaUrl}
                alt=""
                className="mt-2 max-h-32 rounded border object-contain"
              />
            ) : null}
          </div>
        ) : null}

        {carousel.length === 0 ? (
          <WaTemplateContentHelper
            readOnly={readOnly}
            module={template.module}
            language={template.language}
            layoutKind={
              template.carousel.length > 0
                ? "carousel"
                : template.headerFormat === "IMAGE"
                  ? "image"
                  : template.headerFormat === "VIDEO"
                    ? "video"
                    : template.headerFormat === "DOCUMENT"
                      ? "document"
                      : "text"
            }
            onApply={(b, f) => {
              setBody(b);
              setFooter(f);
            }}
          />
        ) : null}

        <label className="block text-[11px] font-semibold text-[var(--muted)]">
          Footer (optional)
          <input
            className={`${waInp} mt-1 text-[11px]`}
            value={footer}
            disabled={readOnly}
            onChange={(e) => setFooter(e.target.value)}
          />
        </label>

        <label className="block text-[11px] font-semibold text-[var(--muted)]">
          Body
          <textarea
            className={`${waInp} mt-1 min-h-[120px] font-mono text-[11px]`}
            value={body}
            disabled={readOnly}
            onChange={(e) => setBody(e.target.value)}
          />
        </label>

        <label className="block text-[11px] font-semibold text-[var(--muted)]">
          Local fallback (24h / wa.me)
          <textarea
            className={`${waInp} mt-1 min-h-[80px] font-mono text-[11px]`}
            value={fallback}
            disabled={readOnly}
            onChange={(e) => setFallback(e.target.value)}
          />
        </label>

        {carousel.length > 0 ? (
          <div className="rounded-lg border border-[var(--border)] p-2">
            <p className="mb-2 text-[11px] font-semibold text-[var(--brand-deep)]">
              Carousel cards ({carousel.length})
            </p>
            <ul className="space-y-3">
              {carousel.map((c, idx) => (
                <li
                  key={c.id}
                  className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-2"
                >
                  <p className="text-[10px] font-bold text-[var(--muted)]">
                    Card {idx + 1}
                  </p>
                  <input
                    type="file"
                    disabled={readOnly}
                    className="mt-1 text-[11px]"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(e) =>
                      void onCarouselFile(c.id, e.target.files?.[0] || null)
                    }
                  />
                  <textarea
                    className={`${waInp} mt-2 min-h-[60px] font-mono text-[11px]`}
                    value={c.body}
                    disabled={readOnly}
                    onChange={(e) =>
                      setCarousel((prev) =>
                        prev.map((row) =>
                          row.id === c.id
                            ? { ...row, body: e.target.value }
                            : row,
                        ),
                      )
                    }
                  />
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {!readOnly ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={waBtnPrimary}
              onClick={() => onSave(buildPatch(), "Template saved")}
            >
              Save local edits
            </button>
            <button
              type="button"
              disabled={!canSubmit || submitting}
              className={waBtnTeal}
              onClick={() => {
                onSave(buildPatch(), undefined);
                onSubmitMeta();
              }}
            >
              {submitting
                ? "Submitting…"
                : template.status === "pending"
                  ? "Re-submit to Meta"
                  : "Submit to Meta"}
            </button>
            <button
              type="button"
              className={waBtnOutline}
              onClick={() =>
                onSave(
                  { paused: !template.paused },
                  template.paused ? "Template resumed" : "Template paused",
                )
              }
            >
              {template.paused ? "Resume" : "Pause"}
            </button>
          </div>
        ) : null}
      </div>

      <div className="lg:sticky lg:top-4 lg:self-start">
        <WaTemplateVariablesPicker
          highlightKeys={template.variables}
          onInsert={(key) => setBody((prev) => insertWaVariableToken(prev, key))}
        />
      </div>
    </div>
  );
}

export function WaTemplatesEditView({
  template,
  readOnly,
  notice,
  submitting,
  onBack,
  onSave,
  onSubmitMeta,
}: {
  template: WaTemplate;
  readOnly: boolean;
  notice: string | null;
  submitting: boolean;
  onBack: () => void;
  onSave: (
    patch: Parameters<typeof updateTemplateLocal>[2],
    msg?: string,
  ) => void;
  onSubmitMeta: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" className={waBtnOutline} onClick={onBack}>
          ← Back to list
        </button>
        {notice ? (
          <span className="rounded-lg bg-[rgba(197,160,40,0.18)] px-3 py-1.5 text-xs font-medium text-[var(--brand-deep)]">
            {notice}
          </span>
        ) : null}
      </div>
      <MastersWorkCard
        title={template.name}
        hint={`${template.metaName} · ${template.metaLanguage}`}
      >
        <TemplateEditor
          template={template}
          readOnly={readOnly}
          submitting={submitting}
          onSubmitMeta={onSubmitMeta}
          onSave={onSave}
        />
      </MastersWorkCard>
    </div>
  );
}
