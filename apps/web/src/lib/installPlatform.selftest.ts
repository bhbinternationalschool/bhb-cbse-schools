import assert from "node:assert/strict";
import { installPlatform } from "./installPlatform";

console.log("installPlatform.selftest.ts");

const s = { standalone: false };
const IPHONE_SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0 Mobile/15E148 Safari/604.1";
const IPHONE_WHATSAPP = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 WhatsApp/24.20";
const ANDROID_CHROME = "Mozilla/5.0 (Linux; Android 14; SM-A145F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36";
const ANDROID_WEBVIEW = "Mozilla/5.0 (Linux; Android 14; SM-A145F; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36";
const IPAD = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const MAC_CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";

assert.equal(installPlatform(IPHONE_SAFARI, s), "ios-safari");
assert.equal(installPlatform(IPHONE_CHROME, s), "ios-other", "Chrome on iPhone cannot add to Home Screen");
assert.equal(installPlatform(IPHONE_WHATSAPP, s), "ios-other", "WhatsApp's browser cannot either");
assert.equal(installPlatform(ANDROID_CHROME, s), "android");
assert.equal(installPlatform(ANDROID_WEBVIEW, s), "android-inapp", "a link tapped in WhatsApp opens a webview");
assert.equal(installPlatform(IPAD, { standalone: false, maxTouchPoints: 5 }), "ios-safari", "iPadOS poses as a Mac");
assert.equal(installPlatform(MAC_CHROME, { standalone: false, maxTouchPoints: 0 }), "desktop");
assert.equal(installPlatform(ANDROID_CHROME, { standalone: true }), "standalone");

console.log("installPlatform.selftest: all assertions passed");
