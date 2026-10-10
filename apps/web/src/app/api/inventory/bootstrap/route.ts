/** Inventory bootstrap — masters, price lists, vendors and settings in one call. */

import { fetchBootstrap, saveSettings } from "@/lib/inventory/catalogue.server";
import { invBody, invRoute } from "@/lib/inventory/route.server";
import type { InvSettings } from "@/lib/inventory/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return invRoute(req, "view", async ({ academicYearCode }) => ({
    bootstrap: await fetchBootstrap(academicYearCode),
  }));
}

/** Update module settings (approval threshold, defaults, costing, prefixes). */
export async function POST(req: Request) {
  return invRoute(req, "edit", async () => {
    const body = await invBody<Partial<InvSettings>>(req);
    return { settings: await saveSettings(body) };
  });
}
