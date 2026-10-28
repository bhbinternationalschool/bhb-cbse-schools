/**
 * The oldest phone-app build the server still works with.
 *
 * The app and the server change together: the staff punch changed three
 * times in one week (QR code, then the phone's key, then the campus fence),
 * and a phone left on an older build only ever said "Punch was NOT saved".
 * Play updates apps on its own schedule — usually overnight on Wi-Fi — and
 * cannot force one, so the server says when an update is needed instead.
 *
 * Raise a number HERE, in the same PR as the server change that breaks the
 * older builds. The app reads it at launch (/api/public/app-version) and
 * shows "Update to continue"; the routes that would fail answer 426 with
 * the same instruction.
 *
 * Builds are Android versionCodes (the number after + in pubspec.yaml).
 * A request that does not say its build — the website, or an app from before
 * 3 Oct 2026 that never sent one — is never refused on that account: an
 * unknown build is not an old build.
 */

export type AppFlavor = "staff" | "parent";

export const APP_MIN_BUILD: Record<AppFlavor, number> = {
  // 32 (1.0.31): director, 13 Oct 2026 — every staff phone on the current
  // Play build. Only 11 of 34 were (4 still on 1.0.24, 3 on 1.0.30), and the
  // in-app "restart to update" bar was being ignored. 1.0.31 is fully rolled
  // out on Play (approved 12 Oct), so the update is there to give them.
  // (Was 14 — 1.0.13, the first build that signs QR punches, #380.)
  staff: 32,
  // 26 (1.0.25): director, 9 Oct 2026 — every parent on the build with the
  // pick-up pin, running strip, pop-ups and guides. Takes effect at deploy,
  // so deploy only once 1.0.25 is live on Play (else no update to give them).
  // (1.0.24+25 was never released: it dropped 7 devices without GPS.)
  parent: 26,
};

export const APP_UPDATE_MESSAGE =
  "Please update the BHB app from the Play Store to continue. / कृपया आगे बढ़ने के लिए Play Store से BHB ऐप अपडेट करें।";

export function cleanFlavor(raw: unknown): AppFlavor | null {
  const v = String(raw ?? "").trim().toLowerCase();
  return v === "staff" || v === "parent" ? v : null;
}

/** A positive whole build number, or null when absent or garbled. */
export function cleanBuild(raw: unknown): number | null {
  const v = String(raw ?? "").trim();
  if (!/^\d{1,9}$/.test(v)) return null;
  const n = Number(v);
  return n > 0 ? n : null;
}

/** True only when the build is KNOWN and below the minimum for its app. */
export function appBuildTooOld(flavor: AppFlavor | null, build: number | null): boolean {
  if (!flavor || build == null) return false;
  return build < APP_MIN_BUILD[flavor];
}

/** Reads the X-App-Flavor / X-App-Build headers the app sends. */
export function appBuildFromHeaders(headers: Headers): { flavor: AppFlavor | null; build: number | null } {
  return {
    flavor: cleanFlavor(headers.get("x-app-flavor")),
    build: cleanBuild(headers.get("x-app-build")),
  };
}

export function requestNeedsAppUpdate(request: Request): boolean {
  const { flavor, build } = appBuildFromHeaders(request.headers);
  return appBuildTooOld(flavor, build);
}
