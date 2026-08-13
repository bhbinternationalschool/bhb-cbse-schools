"use client";

import { useMemo, useState } from "react";
import {
  WA_TEMPLATE_LAYOUT_OPTIONS,
  collectTemplateVariables,
  createDraftWaTemplate,
  insertWaVariableToken,
  readWaTemplateMediaFile,
  type WaCarouselCard,
  type WaTemplateLayoutKind,
  type WaTemplateLanguage,
  type WaTemplateModule,
  type WaTemplatesState,
} from "@/lib/waTemplates";
import { WaTemplateVariablesPicker } from "@/components/masters/WaTemplateVariablesPicker";
import { WaTemplateContentHelper } from "./WaTemplateContentHelper";
import { waBtnOutline, waBtnTeal, waInp } from "./waTemplateUi";

function defaultCarouselCards(): Omit<WaCarouselCard, "id">[] {
  return [
    {
      headerFormat: "IMAGE",
      body: "{{schoolName}} — card 1",
      buttons: [],
    },
    {
      headerFormat: "IMAGE",
      body: "{{schoolName}} — card 2",
      buttons: [],
    },
  ];
}

export function WaTemplatesCreateView({
  state,
  readOnly,
  notice,
  submitting,
  sessionName,
  onBack,
  onCreateAndSubmit,
}: {
  state: WaTemplatesState;
  readOnly: boolean;
  notice: string | null;
  submitting: boolean;
  sessionName: string;
  onBack: () => void;
  onCreateAndSubmit: (
    nextState: WaTemplatesState,
    templateId: string,
  ) => Promise<void>;
}) {
  const [step, setStep] = useState<"pick" | "form">("pick");
  const [layoutKind, setLayoutKind] = useState<WaTemplateLayoutKind>("text");
  const [name, setName] = useState("");
  const [metaName, setMetaName] = useState("");
  const [module, setModule] = useState<WaTemplateModule>("comms");
  const [lang, setLang] = useState<WaTemplateLanguage>("en");
  const [body, setBody] = useState(
    "Namaste {{guardianName}}, message from {{schoolName}}.",
  );
  const [footer, setFooter] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaFileName, setMediaFileName] = useState("");
  const [carousel, setCarousel] = useState<Omit<WaCarouselCard, "id">[]>(
    defaultCarouselCards(),
  );
  const [mediaNotice, setMediaNotice] = useState<string | null>(null);
  const [activeField, setActiveField] = useState<"body" | number>("body");

  const layout = WA_TEMPLATE_LAYOUT_OPTIONS.find((o) => o.id === layoutKind)!;
  const needsHeaderMedia =
    layoutKind === "image" ||
    layoutKind === "video" ||
    layoutKind === "document";

  const highlightKeys = useMemo(() => {
    if (layoutKind === "carousel") {
      return collectTemplateVariables({
        carousel: carousel.map((c, i) => ({ ...c, id: `tmp_${i}` })),
      });
    }
    return collectTemplateVariables({ body, footer });
  }, [layoutKind, body, footer, carousel]);

  function onInsertVariable(key: string) {
    if (layoutKind === "carousel" && typeof activeField === "number") {
      setCarousel((prev) =>
        prev.map((c, i) =>
          i === activeField
            ? { ...c, body: insertWaVariableToken(c.body, key) }
            : c,
        ),
      );
    } else {
      setBody((prev) => insertWaVariableToken(prev, key));
    }
  }

  async function onHeaderFile(file: File | null) {
    if (!file || readOnly) return;
    const kind =
      layoutKind === "document"
        ? "document"
        : layoutKind === "video"
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

  async function onCarouselFile(cardIdx: number, file: File | null) {
    if (!file || readOnly) return;
    const r = await readWaTemplateMediaFile(file, "image");
    if (!r.ok) {
      setMediaNotice(r.error);
      window.setTimeout(() => setMediaNotice(null), 3200);
      return;
    }
    setCarousel((prev) =>
      prev.map((c, i) =>
        i === cardIdx
          ? { ...c, mediaUrl: r.dataUrl, mediaFileName: r.fileName }
          : c,
      ),
    );
  }

  function pickLayout(kind: WaTemplateLayoutKind) {
    setLayoutKind(kind);
    if (kind === "carousel" && carousel.length < 2) {
      setCarousel(defaultCarouselCards());
    }
    setStep("form");
  }

  async function handleSubmit() {
    if (readOnly) return;
    const resolvedMeta =
      metaName.trim() ||
      name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
    const { state: nextState, template } = createDraftWaTemplate(state, {
      name: name.trim() || resolvedMeta,
      metaName: resolvedMeta,
      module,
      language: lang,
      body,
      footer,
      layoutKind,
      mediaUrl,
      mediaFileName,
      carousel: layoutKind === "carousel" ? carousel : undefined,
      by: sessionName,
    });
    await onCreateAndSubmit(nextState, template.id);
  }

  const canSubmit =
    !readOnly &&
    body.trim().length > 0 &&
    (metaName.trim() || name.trim()).length > 0 &&
    (!needsHeaderMedia || mediaUrl.length > 0);

  if (step === "pick") {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-[var(--brand-deep)]">
              New WhatsApp template
            </h2>
            <p className="mt-1 text-[12px] text-[var(--muted)]">
              Choose a layout type. You will compose the message next and submit
              directly to Meta.
            </p>
          </div>
          <button type="button" className={waBtnOutline} onClick={onBack}>
            ← Back to list
          </button>
        </div>
        {notice ? (
          <span className="inline-block rounded-lg bg-[rgba(197,160,40,0.18)] px-3 py-1.5 text-xs font-medium text-[var(--brand-deep)]">
            {notice}
          </span>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {WA_TEMPLATE_LAYOUT_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-left transition hover:border-[#0f766e] hover:shadow-sm"
              onClick={() => pickLayout(opt.id)}
            >
              <p className="text-[14px] font-semibold text-[var(--brand-deep)]">
                {opt.label}
              </p>
              <p className="mt-1 text-[11px] text-[var(--muted)]">
                {opt.description}
              </p>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-[var(--brand-deep)]">
            Create: {layout.label}
          </h2>
          <p className="mt-1 text-[12px] text-[var(--muted)]">
            Form on the left · variables on the right. Submit sends to Meta for
            approval.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={waBtnOutline}
            onClick={() => setStep("pick")}
          >
            Change type
          </button>
          <button type="button" className={waBtnOutline} onClick={onBack}>
            Cancel
          </button>
        </div>
      </div>

      {notice || mediaNotice ? (
        <span className="inline-block rounded-lg bg-[rgba(197,160,40,0.18)] px-3 py-1.5 text-xs font-medium text-[var(--brand-deep)]">
          {notice || mediaNotice}
        </span>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block text-[11px] font-semibold text-[var(--muted)]">
              Display name
              <input
                className={`${waInp} mt-1`}
                value={name}
                disabled={readOnly}
                onChange={(e) => setName(e.target.value)}
                placeholder="Fee reminder"
              />
            </label>
            <label className="block text-[11px] font-semibold text-[var(--muted)]">
              Meta name (snake_case)
              <input
                className={`${waInp} mt-1 font-mono`}
                value={metaName}
                disabled={readOnly}
                onChange={(e) => setMetaName(e.target.value)}
                placeholder="bhb_fee_reminder"
              />
            </label>
            <label className="block text-[11px] font-semibold text-[var(--muted)]">
              Module
              <select
                className={`${waInp} mt-1`}
                value={module}
                disabled={readOnly}
                onChange={(e) =>
                  setModule(e.target.value as WaTemplateModule)
                }
              >
                <option value="comms">Comms</option>
                <option value="admissions">Admissions</option>
                <option value="fees">Fees</option>
                <option value="transport">Transport</option>
                <option value="general">General</option>
              </select>
            </label>
            <label className="block text-[11px] font-semibold text-[var(--muted)]">
              Language
              <select
                className={`${waInp} mt-1`}
                value={lang}
                disabled={readOnly}
                onChange={(e) =>
                  setLang(e.target.value as WaTemplateLanguage)
                }
              >
                <option value="en">English</option>
                <option value="hi">Hindi</option>
              </select>
            </label>
          </div>

          {needsHeaderMedia ? (
            <div className="rounded-lg border border-[var(--border)] p-3">
              <p className="text-[11px] font-semibold text-[var(--brand-deep)]">
                Header {layoutKind} upload
              </p>
              <input
                type="file"
                className="mt-2 text-[11px]"
                disabled={readOnly}
                accept={
                  layoutKind === "document"
                    ? "application/pdf"
                    : layoutKind === "video"
                      ? "video/mp4"
                      : "image/jpeg,image/png,image/webp"
                }
                onChange={(e) => void onHeaderFile(e.target.files?.[0] || null)}
              />
              {mediaFileName ? (
                <p className="mt-1 text-[10px] text-[var(--muted)]">
                  {mediaFileName}
                </p>
              ) : null}
              {mediaUrl && layoutKind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={mediaUrl}
                  alt=""
                  className="mt-2 max-h-32 rounded border object-contain"
                />
              ) : null}
            </div>
          ) : null}

          {layoutKind === "carousel" ? (
            <div className="space-y-3">
              <p className="text-[11px] font-semibold text-[var(--brand-deep)]">
                Carousel cards
              </p>
              {carousel.map((c, idx) => (
                <div
                  key={idx}
                  className="rounded-lg border border-[var(--border)] p-2"
                >
                  <p className="text-[10px] font-bold text-[var(--muted)]">
                    Card {idx + 1}
                  </p>
                  <input
                    type="file"
                    className="mt-1 text-[11px]"
                    disabled={readOnly}
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(e) =>
                      void onCarouselFile(idx, e.target.files?.[0] || null)
                    }
                  />
                  {c.mediaFileName ? (
                    <p className="text-[10px] text-[var(--muted)]">
                      {c.mediaFileName}
                    </p>
                  ) : null}
                  <textarea
                    className={`${waInp} mt-2 min-h-[60px] font-mono text-[11px]`}
                    value={c.body}
                    disabled={readOnly}
                    onFocus={() => setActiveField(idx)}
                    onChange={(e) =>
                      setCarousel((prev) =>
                        prev.map((row, i) =>
                          i === idx ? { ...row, body: e.target.value } : row,
                        ),
                      )
                    }
                  />
                </div>
              ))}
              <button
                type="button"
                className={waBtnOutline}
                disabled={readOnly || carousel.length >= 10}
                onClick={() =>
                  setCarousel((prev) => [
                    ...prev,
                    {
                      headerFormat: "IMAGE",
                      body: "{{schoolName}}",
                      buttons: [],
                    },
                  ])
                }
              >
                + Add card
              </button>
            </div>
          ) : null}

          {layoutKind !== "carousel" ? (
            <WaTemplateContentHelper
              readOnly={readOnly}
              module={module}
              language={lang}
              layoutKind={layoutKind}
              onApply={(b, f) => {
                setBody(b);
                setFooter(f);
              }}
            />
          ) : null}

          <label className="block text-[11px] font-semibold text-[var(--muted)]">
            Body
            <textarea
              className={`${waInp} mt-1 min-h-[120px] font-mono text-[11px]`}
              value={body}
              disabled={readOnly}
              onFocus={() => setActiveField("body")}
              onChange={(e) => setBody(e.target.value)}
            />
          </label>

          <label className="block text-[11px] font-semibold text-[var(--muted)]">
            Footer (optional)
            <input
              className={`${waInp} mt-1`}
              value={footer}
              disabled={readOnly}
              onChange={(e) => setFooter(e.target.value)}
            />
          </label>

          <button
            type="button"
            disabled={!canSubmit || submitting}
            className={waBtnTeal}
            onClick={() => void handleSubmit()}
          >
            {submitting ? "Submitting to Meta…" : "Create & submit to Meta"}
          </button>
        </div>

        <div className="lg:sticky lg:top-4 lg:self-start">
          <WaTemplateVariablesPicker
            highlightKeys={highlightKeys}
            onInsert={onInsertVariable}
          />
        </div>
      </div>
    </div>
  );
}
