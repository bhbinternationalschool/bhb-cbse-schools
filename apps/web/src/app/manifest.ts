import { buildPwaManifest } from "@/lib/pwaApps";

/** Default manifest at /manifest.webmanifest — login hub (all roles). */
export default function manifest() {
  return buildPwaManifest("login");
}
