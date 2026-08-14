/**
 * Installable PWA definitions — one app per persona group.
 */

import type { MetadataRoute } from "next";
import { TENANT } from "@/lib/types";

export type PwaAppId = "parent" | "staff" | "field" | "login";

export type PwaAppDef = {
  id: PwaAppId;
  name: string;
  shortName: string;
  description: string;
  startUrl: string;
  orientation: "portrait" | "any";
  shortcuts: MetadataRoute.Manifest["shortcuts"];
};

const ICONS: MetadataRoute.Manifest["icons"] = [
  { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
  { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
  {
    src: "/icon-512-maskable.png",
    sizes: "512x512",
    type: "image/png",
    purpose: "maskable",
  },
];

export const PWA_APPS: Record<PwaAppId, PwaAppDef> = {
  parent: {
    id: "parent",
    name: `${TENANT.shortName} Parent`,
    shortName: "BHB Parent",
    description:
      "Fees, homework, notices, PTM for BHB International School parents.",
    startUrl: "/parent",
    orientation: "portrait",
    shortcuts: [
      { name: "Fees", short_name: "Fees", url: "/parent" },
      { name: "Homework", short_name: "HW", url: "/parent?tab=homework" },
      { name: "Notices", short_name: "Notices", url: "/parent?tab=notices" },
    ],
  },
  staff: {
    id: "staff",
    name: `${TENANT.shortName} Staff ERP`,
    shortName: "BHB Staff",
    description:
      "School ERP for teachers, principal, admin and office — fees, SIS, attendance, admissions.",
    startUrl: "/home",
    orientation: "any",
    shortcuts: [
      { name: "Home", short_name: "Home", url: "/home" },
      { name: "Fees", short_name: "Fees", url: "/fees" },
      { name: "Admissions", short_name: "CRM", url: "/admissions" },
      { name: "Attendance", short_name: "Attend", url: "/attendance" },
      { name: "Homework", short_name: "HW", url: "/homework" },
    ],
  },
  field: {
    id: "field",
    name: `${TENANT.shortName} Field`,
    shortName: "BHB Field",
    description:
      "Drivers, survey team & field staff — lead capture, calling, registration, survey.",
    startUrl: "/field",
    orientation: "portrait",
    shortcuts: [
      { name: "Field hub", short_name: "Hub", url: "/field" },
      { name: "Capture lead", short_name: "Lead", url: "/field/capture" },
      { name: "Calling", short_name: "Call", url: "/field/calling" },
      { name: "Survey", short_name: "Survey", url: "/field/survey" },
    ],
  },
  login: {
    id: "login",
    name: `${TENANT.shortName} School`,
    shortName: "BHB School",
    description: `Sign in to ${TENANT.name} — parent, staff, or field apps.`,
    startUrl: "/login",
    orientation: "portrait",
    shortcuts: [
      { name: "Sign in", short_name: "Login", url: "/login" },
      { name: "Parent portal", short_name: "Parent", url: "/parent" },
      { name: "Apply", short_name: "Apply", url: "/apply" },
    ],
  },
};

export function isPwaAppId(id: string): id is PwaAppId {
  return id in PWA_APPS;
}

export function buildPwaManifest(appId: PwaAppId): MetadataRoute.Manifest {
  const app = PWA_APPS[appId];
  return {
    id: `/${app.id}`,
    name: app.name,
    short_name: app.shortName,
    description: app.description,
    start_url: app.startUrl,
    scope: "/",
    display: "standalone",
    orientation: app.orientation,
    background_color: TENANT.creamColor,
    theme_color: TENANT.primaryColor,
    lang: "en-IN",
    dir: "ltr",
    categories: ["education", "productivity"],
    icons: ICONS,
    shortcuts: app.shortcuts,
  };
}

export function pwaManifestHref(appId: PwaAppId): string {
  return `/pwa/${appId}/manifest.webmanifest`;
}

export function pwaDismissKey(appId: PwaAppId): string {
  return `bhb_pwa_dismiss_${appId}`;
}

/** Role-aware install copy for staff ERP */
export function staffPwaInstallCopy(roleCode: string): {
  title: string;
  subtitle: string;
  iosHint: string;
} {
  const r = (roleCode || "staff").toLowerCase();
  if (r.includes("principal") || r === "owner" || r === "director") {
    return {
      title: "Install Principal Desk",
      subtitle: "Full ERP — fees, staff, reports on your phone",
      iosHint: "Add to Home Screen for quick access to the principal desk.",
    };
  }
  if (r.includes("admin") || r === "office" || r.includes("account")) {
    return {
      title: "Install Admin ERP",
      subtitle: "Admissions, fees & office tools on your device",
      iosHint: "Add to Home Screen for admin shortcuts.",
    };
  }
  if (r.includes("teacher") || r === "hod" || r.includes("faculty")) {
    return {
      title: "Install Teacher App",
      subtitle: "Homework, attendance & class diary",
      iosHint: "Add to Home Screen for your class tools.",
    };
  }
  if (r.includes("driver") || r.includes("transport")) {
    return {
      title: "Install Transport App",
      subtitle: "Use BHB Field for routes & driver desk",
      iosHint: "Open /field after install, or use BHB Field app.",
    };
  }
  return {
    title: "Install BHB Staff ERP",
    subtitle: "School workspace on your home screen",
    iosHint: "Add to Home Screen for one-tap ERP access.",
  };
}

export function fieldPwaInstallCopy(persona: string, roleCode: string): {
  title: string;
  subtitle: string;
  iosHint: string;
} {
  const r = (roleCode || "").toLowerCase();
  if (persona === "field" || r.includes("driver") || r.includes("transport")) {
    return {
      title: "Install Driver / Field App",
      subtitle: "Leads, survey & registration in the field",
      iosHint: "Add to Home Screen for drivers & survey team.",
    };
  }
  return {
    title: "Install BHB Field App",
    subtitle: "Capture leads & survey on the go",
    iosHint: "Add to Home Screen for field tools.",
  };
}

export function parentPwaInstallCopy(): {
  title: string;
  subtitle: string;
  iosHint: string;
} {
  return {
    title: "Install BHB Parent app",
    subtitle: "Fees, homework & notices on your home screen",
    iosHint: "Tap Share → Add to Home Screen for fees & homework.",
  };
}

export function loginPwaInstallCopy(): {
  title: string;
  subtitle: string;
  iosHint: string;
} {
  return {
    title: "Install BHB School app",
    subtitle: "One icon — sign in as parent, staff or field",
    iosHint: "Add to Home Screen, then sign in with your role.",
  };
}
