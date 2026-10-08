/**
 * The school letterhead as an HTML string, for sheets printed through
 * `window.open()` + `document.write()` (expense vouchers, the day sheet,
 * dashboard and concession prints, the gate QR).
 *
 * Same block as components/shared/SchoolLetterhead.tsx — crest, the name in
 * the brand navy, the gold tagline, address, contact — with inline
 * styles, because the popup has none of the app's CSS. Image URLs are made
 * absolute: a popup opened on "" is about:blank, where "/logo.png" resolves
 * to nothing and the sheet prints without its logo.
 */

import { resolveAssetUrl } from "@/lib/pdfLetterhead";
import {
  schoolAddressLine,
  schoolContactLine,
  schoolCrestUrl,
  schoolPrintName,
  schoolTagline,
} from "@/lib/schoolIdentity";
import type { MastersState } from "@/lib/masters";
import { TENANT } from "@/lib/types";

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Put inside `<head>`: keeps the letterhead's colours on paper. */
export const PRINT_LETTERHEAD_CSS = `
  .erp-lh { -webkit-print-color-adjust: exact; print-color-adjust: exact; margin-bottom: 14px; }
  .erp-lh * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .erp-lh-row { display: flex; align-items: center; gap: 12px; border-bottom: 2px solid ${TENANT.primaryColor}; padding-bottom: 8px; }
  .erp-lh-text { flex: 1; text-align: center; min-width: 0; }
  .erp-lh-name { margin: 0; font-family: Georgia, "Times New Roman", serif; font-weight: 700; font-size: 19px; letter-spacing: 0.04em; text-transform: uppercase; color: ${TENANT.primaryColor}; }
  .erp-lh-tag { margin: 1px 0 0; font-size: 10px; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: ${TENANT.goldColor}; }
  .erp-lh-line { margin: 2px 0 0; font-size: 10px; color: #4a5568; }
  .erp-lh-title { margin: 8px 0 0; text-align: center; font-size: 14px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: ${TENANT.primaryColor}; }
`;

/** The letterhead block, optionally with the document's title under the rule. */
export function printLetterheadHtml(opts?: {
  title?: string;
  masters?: MastersState | null;
}): string {
  const m = opts?.masters;
  const address = schoolAddressLine(m);
  const contact = schoolContactLine(m);
  return `<header class="erp-lh">
  <div class="erp-lh-row">
    <img src="${esc(resolveAssetUrl(schoolCrestUrl(m)))}" alt="" width="58" height="58" style="width:58px;height:58px;object-fit:contain">
    <div class="erp-lh-text">
      <p class="erp-lh-name">${esc(schoolPrintName(m))}</p>
      <p class="erp-lh-tag">${esc(schoolTagline(m))}</p>
      ${address ? `<p class="erp-lh-line">${esc(address)}</p>` : ""}
      ${contact ? `<p class="erp-lh-line">${esc(contact)}</p>` : ""}
    </div>
    <img src="${esc(resolveAssetUrl(schoolCrestUrl(m)))}" alt="" width="58" height="58" style="width:58px;height:58px;object-fit:contain">
  </div>
  ${opts?.title ? `<p class="erp-lh-title">${esc(opts.title)}</p>` : ""}
</header>`;
}

/**
 * Print a popup once its images have loaded. Calling `print()` straight after
 * `document.write()` prints before the logo arrives, so the letterhead goes to
 * paper with an empty box where the logo should be. A broken image must not
 * hold the print forever, so it gives up waiting after a few seconds.
 */
export function printWhenImagesReady(win: Window, maxWaitMs = 4000): void {
  let printed = false;
  const go = () => {
    if (printed) return;
    printed = true;
    win.focus();
    win.print();
  };
  const pending = Array.from(win.document.images).filter((img) => !img.complete);
  if (pending.length === 0) {
    go();
    return;
  }
  let left = pending.length;
  const settle = () => {
    left -= 1;
    if (left <= 0) go();
  };
  for (const img of pending) {
    img.addEventListener("load", settle, { once: true });
    img.addEventListener("error", settle, { once: true });
  }
  win.setTimeout(go, maxWaitMs);
}
