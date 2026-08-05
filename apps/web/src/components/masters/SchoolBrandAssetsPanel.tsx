"use client";

import { useState } from "react";
import type { MastersState } from "@/lib/masters";
import { StaffImageField } from "@/components/staff/StaffImageField";
import {
  MastersTabStack,
  MastersWorkCard,
} from "@/components/masters/MastersLayout";

type Commit = (s: MastersState, msg?: string) => void;

export function SchoolBrandAssetsPanel({
  state,
  commit,
}: {
  state: MastersState;
  commit: Commit;
}) {
  const p = state.schoolProfile;
  const [draft, setDraft] = useState(p);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  return (
    <MastersTabStack
      intro="Logo, favicon, document watermarks, page backgrounds, and signature stamps — used on AI letters, govt submissions, and printed PDFs."
      tables={null}
      work={
        <MastersWorkCard
          title="Brand & document assets"
          hint="Upload PNG with transparent background for stamps · director stamp preview uses blue tint"
        >
          <div className="space-y-6">
            {error ? (
              <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">
                {error}
              </p>
            ) : null}

            <section className="space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
                Logo & favicon
              </h3>
              <StaffImageField
                label="School logo"
                value={draft.logoUrl}
                onChange={(v) => set("logoUrl", v)}
                onError={setError}
                hint="Used on letterhead and certificates"
              />
              <StaffImageField
                label="Favicon"
                value={draft.faviconUrl}
                onChange={(v) => set("faviconUrl", v)}
                onError={setError}
                aspect="square"
                hint="Browser tab icon · falls back to logo if empty"
              />
            </section>

            <section className="space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
                Document backgrounds
              </h3>
              <StaffImageField
                label="Watermark"
                value={draft.watermarkUrl}
                onChange={(v) => set("watermarkUrl", v)}
                onError={setError}
                aspect="square"
                hint="Centered faint watermark on letters"
              />
              <StaffImageField
                label="Page background"
                value={draft.pageBackgroundUrl}
                onChange={(v) => set("pageBackgroundUrl", v)}
                onError={setError}
                aspect="wide"
                hint="Full-page tiled background image at low opacity"
              />
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={draft.pageBackgroundSchoolNameRepeat}
                  onChange={(e) =>
                    set("pageBackgroundSchoolNameRepeat", e.target.checked)
                  }
                />
                <span>
                  <span className="font-medium text-[var(--brand-deep)]">
                    Tile school display name
                  </span>
                  <span className="block text-[11px] text-[var(--muted)]">
                    When no page background image — repeat &ldquo;{draft.displayName}&rdquo;
                    diagonally across the page
                  </span>
                </span>
              </label>
            </section>

            <section className="space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
                Signatures & stamps
              </h3>
              <p className="text-[11px] text-[var(--muted)]">
                Upload stamps as PNG with transparent background. Director stamp preview
                uses a blue tint (govt submission style).
              </p>
              <StaffImageField
                label="Director signature"
                value={draft.directorSignatureUrl}
                onChange={(v) => set("directorSignatureUrl", v)}
                onError={setError}
                aspect="wide"
                hint="Signature only — govt submissions"
              />
              <StaffImageField
                label="Principal stamp + signature"
                value={draft.principalStampSignatureUrl}
                onChange={(v) => set("principalStampSignatureUrl", v)}
                onError={setError}
                aspect="wide"
                hint="Composite PNG · transparent background"
              />
              <div>
                <StaffImageField
                  label="Director stamp + signature"
                  value={draft.directorStampSignatureUrl}
                  onChange={(v) => set("directorStampSignatureUrl", v)}
                  onError={setError}
                  aspect="wide"
                  hint="Composite PNG · blue tint in previews"
                />
                {draft.directorStampSignatureUrl ? (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-[11px] text-[var(--muted)]">Preview tint:</span>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={draft.directorStampSignatureUrl}
                      alt="Director stamp preview"
                      className="h-12 w-auto object-contain"
                      style={{ filter: "hue-rotate(180deg) saturate(1.4)" }}
                    />
                  </div>
                ) : null}
              </div>
            </section>

            <button
              type="button"
              className="rounded-lg bg-[var(--brand-deep)] px-4 py-2 text-sm font-semibold text-white"
              onClick={() => {
                setError(null);
                commit(
                  { ...state, schoolProfile: draft },
                  "Brand assets saved",
                );
              }}
            >
              Save brand assets
            </button>
          </div>
        </MastersWorkCard>
      }
    />
  );
}
