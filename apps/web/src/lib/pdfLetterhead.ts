import type { jsPDF } from "jspdf";
import {
  normalizeSchoolProfile,
  type SchoolProfile,
} from "@/lib/foundationMasters";
import { loadMasters, type MastersState } from "@/lib/masters";
import { TENANT } from "@/lib/types";

export type PdfLetterheadInfo = {
  displayName: string;
  tagline: string;
  addressLine: string;
  contactLine: string;
  logoDataUrl: string | null;
};

export type SchoolBrandAssets = {
  displayName: string;
  watermarkUrl: string;
  pageBackgroundUrl: string;
  pageBackgroundSchoolNameRepeat: boolean;
  directorSignatureUrl: string;
  principalStampSignatureUrl: string;
  directorStampSignatureUrl: string;
};

export type ResolvedSchoolBrandAssets = SchoolBrandAssets & {
  watermarkDataUrl: string | null;
  pageBackgroundDataUrl: string | null;
  directorSignatureDataUrl: string | null;
  principalStampSignatureDataUrl: string | null;
  directorStampSignatureDataUrl: string | null;
};

let cachedLogoDataUrl: string | null | undefined;
const brandImageCache = new Map<string, string | null>();

function resolveAssetUrl(url: string): string {
  if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("data:")) {
    return url;
  }
  if (typeof window !== "undefined") {
    const path = url.startsWith("/") ? url : `/${url}`;
    return `${window.location.origin}${path}`;
  }
  return url;
}

async function loadImageAsDataUrl(url: string): Promise<string | null> {
  if (typeof window === "undefined" || !url) return null;
  const key = url.slice(0, 120);
  if (brandImageCache.has(key)) return brandImageCache.get(key) ?? null;
  try {
    const res = await fetch(resolveAssetUrl(url));
    if (!res.ok) {
      brandImageCache.set(key, null);
      return null;
    }
    const blob = await res.blob();
    const dataUrl = await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () =>
        resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
    brandImageCache.set(key, dataUrl);
    return dataUrl;
  } catch {
    brandImageCache.set(key, null);
    return null;
  }
}

function imageFormatFromDataUrl(dataUrl: string): "PNG" | "JPEG" | "WEBP" {
  if (dataUrl.includes("image/jpeg") || dataUrl.includes("image/jpg")) return "JPEG";
  if (dataUrl.includes("image/webp")) return "WEBP";
  return "PNG";
}

function contactParts(profile: ReturnType<typeof normalizeSchoolProfile>): string[] {
  const parts: string[] = [];
  const phone = profile.phone?.trim();
  const mobile = profile.mobile?.trim();
  const whatsapp = profile.whatsapp?.trim();
  if (phone) parts.push(`Ph: ${phone}`);
  if (mobile && mobile !== phone) parts.push(`Mob: ${mobile}`);
  if (whatsapp && whatsapp !== phone && whatsapp !== mobile) {
    parts.push(`WA: ${whatsapp}`);
  }
  const email = profile.email?.trim();
  const website = profile.website?.trim();
  if (email) parts.push(email);
  if (website) parts.push(website.replace(/^https?:\/\//i, ""));
  if (!parts.length) {
    parts.push(`office@${TENANT.publicPortal}`);
    parts.push(TENANT.publicPortal);
  }
  return parts;
}

export function brandAssetsFromProfile(
  profile?: Partial<SchoolProfile> | null,
): SchoolBrandAssets {
  const p = normalizeSchoolProfile(profile);
  return {
    displayName: p.displayName || TENANT.nameDisplay,
    watermarkUrl: p.watermarkUrl || "",
    pageBackgroundUrl: p.pageBackgroundUrl || "",
    pageBackgroundSchoolNameRepeat: p.pageBackgroundSchoolNameRepeat,
    directorSignatureUrl: p.directorSignatureUrl || "",
    principalStampSignatureUrl: p.principalStampSignatureUrl || "",
    directorStampSignatureUrl: p.directorStampSignatureUrl || "",
  };
}

export async function resolveSchoolBrandAssets(
  masters?: MastersState,
): Promise<ResolvedSchoolBrandAssets> {
  const profile = normalizeSchoolProfile(
    masters?.schoolProfile ?? loadMasters().schoolProfile,
  );
  const base = brandAssetsFromProfile(profile);
  const [
    watermarkDataUrl,
    pageBackgroundDataUrl,
    directorSignatureDataUrl,
    principalStampSignatureDataUrl,
    directorStampSignatureDataUrl,
  ] = await Promise.all([
    loadImageAsDataUrl(base.watermarkUrl),
    loadImageAsDataUrl(base.pageBackgroundUrl),
    loadImageAsDataUrl(base.directorSignatureUrl),
    loadImageAsDataUrl(base.principalStampSignatureUrl),
    loadImageAsDataUrl(base.directorStampSignatureUrl),
  ]);
  return {
    ...base,
    watermarkDataUrl,
    pageBackgroundDataUrl,
    directorSignatureDataUrl,
    principalStampSignatureDataUrl,
    directorStampSignatureDataUrl,
  };
}

export function letterheadInfoFromMasters(masters?: MastersState): Omit<PdfLetterheadInfo, "logoDataUrl"> {
  const profile = normalizeSchoolProfile(masters?.schoolProfile ?? loadMasters().schoolProfile);
  const addressLine = [
    profile.address,
    profile.city,
    profile.state,
    profile.pincode,
  ]
    .filter(Boolean)
    .join(", ");
  const affiliation = profile.affiliationNo
    ? ` · CBSE Aff. ${profile.affiliationNo}`
    : " · Affiliated to CBSE";

  return {
    displayName: profile.displayName || TENANT.nameDisplay,
    tagline: profile.tagline || TENANT.tagline,
    addressLine: `${addressLine || TENANT.schoolAddress}${affiliation}`,
    contactLine: contactParts(profile).join("  |  "),
  };
}

export async function resolvePdfLetterhead(
  masters?: MastersState,
): Promise<PdfLetterheadInfo> {
  const base = letterheadInfoFromMasters(masters);
  const profile = normalizeSchoolProfile(masters?.schoolProfile ?? loadMasters().schoolProfile);
  const logoUrl = profile.logoUrl || TENANT.logoUrl;

  if (cachedLogoDataUrl === undefined) {
    cachedLogoDataUrl = await loadImageAsDataUrl(logoUrl);
  }

  return { ...base, logoDataUrl: cachedLogoDataUrl };
}

function drawLogoPlaceholder(doc: jsPDF, x: number, y: number, size: number) {
  doc.setDrawColor(32, 48, 80);
  doc.setFillColor(248, 248, 240);
  doc.setLineWidth(1);
  doc.roundedRect(x, y, size, size, 6, 6, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(size * 0.22);
  doc.setTextColor(32, 48, 80);
  doc.text(TENANT.shortName.slice(0, 3).toUpperCase(), x + size / 2, y + size / 2 + 3, {
    align: "center",
  });
}

/** School crest + name + contact block. Returns Y below the header rule. */
export function drawPdfLetterhead(
  doc: jsPDF,
  info: PdfLetterheadInfo,
  margin: number,
  usable: number,
  pageW: number,
): number {
  const y0 = margin;
  const logoSize = 52;
  const textBlockTop = y0 + 2;

  if (info.logoDataUrl) {
    try {
      doc.addImage(
        info.logoDataUrl,
        imageFormatFromDataUrl(info.logoDataUrl),
        margin,
        y0,
        logoSize,
        logoSize,
      );
    } catch {
      drawLogoPlaceholder(doc, margin, y0, logoSize);
    }
  } else {
    drawLogoPlaceholder(doc, margin, y0, logoSize);
  }

  const centerX = pageW / 2;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(32, 48, 80);
  doc.text(info.displayName, centerX, textBlockTop + 14, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(197, 160, 40);
  doc.text(info.tagline, centerX, textBlockTop + 28, { align: "center" });

  doc.setTextColor(70, 70, 70);
  doc.text(info.addressLine, centerX, textBlockTop + 40, {
    align: "center",
    maxWidth: usable - logoSize - 16,
  });

  let bottom = textBlockTop + 48;
  if (info.contactLine) {
    doc.setFontSize(8);
    doc.setTextColor(90, 90, 90);
    doc.text(info.contactLine, centerX, textBlockTop + 52, {
      align: "center",
      maxWidth: usable - 24,
    });
    bottom = textBlockTop + 58;
  }

  const headerBottom = Math.max(y0 + logoSize, bottom) + 8;
  doc.setDrawColor(32, 48, 80);
  doc.setLineWidth(1.2);
  doc.line(margin, headerBottom, margin + usable, headerBottom);
  return headerBottom + 12;
}

function fadedImageDataUrl(
  dataUrl: string,
  opacity: number,
  blueTint = false,
): Promise<string | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(null);
        return;
      }
      ctx.globalAlpha = opacity;
      if (blueTint) {
        ctx.filter = "hue-rotate(180deg) saturate(1.4)";
      }
      ctx.drawImage(img, 0, 0);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

async function addFadedImage(
  doc: jsPDF,
  dataUrl: string,
  x: number,
  y: number,
  w: number,
  h: number,
  opacity: number,
  blueTint = false,
) {
  const faded = await fadedImageDataUrl(dataUrl, opacity, blueTint);
  if (!faded) return;
  try {
    doc.addImage(faded, "PNG", x, y, w, h);
  } catch {
    /* ignore bad image */
  }
}

/** Watermark center + optional tiled school name or page background at low opacity. */
export async function drawPdfPageBackground(
  doc: jsPDF,
  info: PdfLetterheadInfo,
  assets: ResolvedSchoolBrandAssets,
  pageW: number,
  pageH: number,
): Promise<void> {
  if (assets.pageBackgroundDataUrl) {
    await addFadedImage(doc, assets.pageBackgroundDataUrl, 0, 0, pageW, pageH, 0.08);
  } else if (assets.pageBackgroundSchoolNameRepeat) {
    const name = assets.displayName || info.displayName;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.setTextColor(200, 200, 200);
    const stepX = 180;
    const stepY = 48;
    let row = 0;
    for (let y = 40; y < pageH - 20; y += stepY) {
      let col = 0;
      for (let x = 20; x < pageW - 40; x += stepX) {
        const offset = (row % 2) * 40;
        doc.text(name, x + offset, y, { angle: -28 });
        col += 1;
      }
      row += 1;
      if (col === 0) break;
    }
    doc.setTextColor(32, 48, 80);
  }

  if (assets.watermarkDataUrl) {
    const wmSize = Math.min(pageW, pageH) * 0.45;
    const x = (pageW - wmSize) / 2;
    const y = (pageH - wmSize) / 2;
    await addFadedImage(doc, assets.watermarkDataUrl, x, y, wmSize, wmSize, 0.12);
  }
}

/** Director sign, principal stamp, director stamp at page bottom. */
export async function drawPdfDocumentSignatures(
  doc: jsPDF,
  assets: ResolvedSchoolBrandAssets,
  margin: number,
  pageW: number,
  pageH: number,
): Promise<void> {
  const blockH = 56;
  const y = pageH - margin - blockH;
  const third = (pageW - margin * 2) / 3;
  const imgH = 48;
  const imgW = 100;

  if (assets.directorSignatureDataUrl) {
    try {
      doc.addImage(
        assets.directorSignatureDataUrl,
        imageFormatFromDataUrl(assets.directorSignatureDataUrl),
        margin,
        y,
        imgW,
        imgH,
      );
    } catch {
      /* ignore */
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(80, 80, 80);
    doc.text("Director", margin, y + imgH + 10);
  }

  if (assets.principalStampSignatureDataUrl) {
    const x = margin + third + (third - imgW) / 2;
    try {
      doc.addImage(
        assets.principalStampSignatureDataUrl,
        imageFormatFromDataUrl(assets.principalStampSignatureDataUrl),
        x,
        y,
        imgW,
        imgH,
      );
    } catch {
      /* ignore */
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(80, 80, 80);
    doc.text("Principal", x + imgW / 2, y + imgH + 10, { align: "center" });
  }

  if (assets.directorStampSignatureDataUrl) {
    const x = pageW - margin - imgW;
    const faded = await fadedImageDataUrl(
      assets.directorStampSignatureDataUrl,
      1,
      true,
    );
    if (faded) {
      try {
        doc.addImage(faded, "PNG", x, y, imgW, imgH);
      } catch {
        /* ignore */
      }
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(80, 80, 80);
    doc.text("Director (Stamp)", x + imgW / 2, y + imgH + 10, { align: "center" });
  }
}
