/**
 * Which install path a visitor to /downloads needs. Pure, so the user-agent
 * cases can be tested.
 *
 * - standalone:     already opened as the installed app
 * - android:        Chrome-family browser — Chrome's own install prompt
 * - android-inapp:  inside WhatsApp / Facebook / Instagram's browser, which
 *                   cannot install; send them to Chrome
 * - ios-safari:     Safari — Share → Add to Home Screen
 * - ios-other:      Chrome/Firefox/WhatsApp on iPhone, which cannot add to
 *                   the Home Screen; send them to Safari
 * - desktop:        a computer
 */
export type InstallPlatform = "standalone" | "android" | "android-inapp" | "ios-safari" | "ios-other" | "desktop";

const IN_APP = /FBAN|FBAV|FB_IAB|Instagram|WhatsApp|Line\/|Snapchat|; wv\)/i;

export function installPlatform(ua: string, opts: { standalone: boolean; maxTouchPoints?: number }): InstallPlatform {
  if (opts.standalone) return "standalone";
  // iPadOS reports a Mac user agent; touch points give it away.
  const ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && (opts.maxTouchPoints ?? 0) > 1);
  if (ios) {
    const otherBrowser = /CriOS|FxiOS|EdgiOS|OPiOS|GSA\//i.test(ua);
    const safari = /Safari\//i.test(ua) && /Version\//i.test(ua);
    return !otherBrowser && safari && !IN_APP.test(ua) ? "ios-safari" : "ios-other";
  }
  if (/Android/i.test(ua)) return IN_APP.test(ua) ? "android-inapp" : "android";
  return "desktop";
}
