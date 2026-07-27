import type { jsPDF } from "jspdf";
import { normalizeSchoolProfile } from "@/lib/foundationMasters";
import { loadMasters, type MastersState } from "@/lib/masters";
import { TENANT } from "@/lib/types";

export type PdfLetterheadInfo = {
  displayName: string;
  tagline: string;
  addressLine: string;
  contactLine: string;
  logoDataUrl: string | null;
};

let cachedLogoDataUrl: string | null | undefined;

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
  if (typeof window === "undefined") return null;
  try {
    const res = await fetch(resolveAssetUrl(url));
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
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
