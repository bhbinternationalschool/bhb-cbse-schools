import { MSG, EXTENSION_VERSION } from "../lib/bridge-protocol.js";

const DEFAULT_LOGIN =
  "https://sdms.udiseplus.gov.in/p2/v1/login";

/** @type {{ username: string; password: string } | null} */
let pendingAutofill = null;
/** @type {number | null} */
let erpTabId = null;
let probeEnabled = false;
let lastSyncAt = "";

async function loadState() {
  const data = await chrome.storage.local.get([
    "probeEnabled",
    "lastSyncAt",
  ]);
  probeEnabled = !!data.probeEnabled;
  lastSyncAt = data.lastSyncAt || "";
}

chrome.runtime.onInstalled.addListener(() => {
  loadState();
});

loadState();

function respond(sendResponse, payload) {
  try {
    sendResponse(payload);
  } catch {
    /* channel closed */
  }
}

async function openLoginTab(loginUrl, credentials) {
  const url = loginUrl || DEFAULT_LOGIN;
  pendingAutofill = credentials
    ? { username: credentials.username, password: credentials.password }
    : null;
  await chrome.storage.session.set({
    pendingAutofill,
    pendingAutofillAt: Date.now(),
  });
  const tab = await chrome.tabs.create({ url, active: true });
  if (pendingAutofill) {
    setTimeout(() => {
      chrome.tabs.sendMessage(tab.id, {
        type: MSG.AUTOFILL,
        credentials: pendingAutofill,
      }).catch(() => {});
    }, 1500);
  }
  return tab.id;
}

async function findSdmsTab() {
  const tabs = await chrome.tabs.query({
    url: [
      "https://sdms.udiseplus.gov.in/*",
      "https://udiseplus.gov.in/*",
    ],
  });
  return tabs.find((t) => t.id && !/login/i.test(t.url || "")) || tabs[0];
}

async function injectCaptureHook(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: () => {
      if (window.__udiseBridgeCaptureHook) return;
      window.__udiseBridgeCaptureHook = true;

      function maybeCapture(url, blob) {
        const u = String(url || "");
        const t = blob?.type || "";
        if (
          !/spreadsheet|excel|sheet|octet-stream/i.test(t) &&
          !/\.xlsx|\.xls|export|student/i.test(u)
        ) {
          return;
        }
        blob.arrayBuffer().then((buf) => {
          const bytes = new Uint8Array(buf);
          let bin = "";
          const chunk = 0x8000;
          for (let i = 0; i < bytes.length; i += chunk) {
            bin += String.fromCharCode(
              ...bytes.subarray(i, i + chunk),
            );
          }
          const base64 = btoa(bin);
          if (base64.length < 200) return;
          window.postMessage(
            {
              source: "udise-bridge-extension",
              type: "UDISE_BRIDGE_POST_SYNC_PAYLOAD",
              payload: {
                fileName: "Students_Details.xlsx",
                base64,
                mimeType: t || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              },
            },
            "*",
          );
        });
      }

      const origFetch = window.fetch;
      window.fetch = async function (...args) {
        const res = await origFetch.apply(this, args);
        try {
          const clone = res.clone();
          const blob = await clone.blob();
          maybeCapture(args[0], blob);
        } catch {
          /* ignore */
        }
        return res;
      };

      const XO = XMLHttpRequest.prototype.open;
      const XS = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        this.__udiseUrl = url;
        return XO.call(this, method, url, ...rest);
      };
      XMLHttpRequest.prototype.send = function (...args) {
        this.addEventListener("load", function () {
          try {
            const blob = new Blob([this.response]);
            maybeCapture(this.__udiseUrl, blob);
          } catch {
            /* ignore */
          }
        });
        return XS.apply(this, args);
      };
    },
  });
}

async function postPayloadToErp(payload) {
  lastSyncAt = new Date().toISOString();
  await chrome.storage.local.set({ lastSyncAt });

  const targets = [];
  if (erpTabId) targets.push(erpTabId);
  const erpTabs = await chrome.tabs.query({
    url: [
      "http://localhost/*",
      "http://127.0.0.1/*",
      "https://*.bhbinternational.school/*",
      "https://erp.bhbinternational.school/*",
    ],
  });
  for (const t of erpTabs) {
    if (t.id && !targets.includes(t.id)) targets.push(t.id);
  }

  for (const tabId of targets) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: (p) => {
          window.postMessage(
            {
              source: "udise-bridge-extension",
              type: "UDISE_BRIDGE_POST_SYNC_PAYLOAD",
              payload: p,
            },
            "*",
          );
        },
        args: [payload],
      });
    } catch {
      /* tab may not be ERP */
    }
  }
}

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (sender.tab?.id) erpTabId = sender.tab.id;

  (async () => {
    await loadState();
    const type = message?.type;

    if (type === MSG.PING) {
      respond(sendResponse, {
        ok: true,
        type: MSG.PONG,
        version: EXTENSION_VERSION,
        probeEnabled,
        lastSyncAt,
      });
      return;
    }

    if (type === MSG.OPEN_LOGIN) {
      await openLoginTab(message.loginUrl, message.credentials);
      respond(sendResponse, { ok: true });
      return;
    }

    if (type === MSG.SYNC_STUDENTS) {
      const sdms = await findSdmsTab();
      if (sdms?.id) {
        await injectCaptureHook(sdms.id);
        await chrome.tabs.update(sdms.id, { active: true });
        respond(sendResponse, {
          ok: true,
          message:
            "SDMS tab ready — open Students List → Export/Download Excel; bridge will capture the file",
        });
      } else {
        await openLoginTab(message.loginUrl, message.credentials);
        respond(sendResponse, {
          ok: true,
          message:
            "Opened SDMS login — sign in (CAPTCHA manual), then export Students List Excel",
        });
      }
      return;
    }

    if (type === MSG.SET_PROBE) {
      probeEnabled = !!message.enabled;
      await chrome.storage.local.set({ probeEnabled });
      const tabs = await chrome.tabs.query({
        url: ["https://sdms.udiseplus.gov.in/*", "https://udiseplus.gov.in/*"],
      });
      for (const t of tabs) {
        if (t.id) {
          chrome.tabs.sendMessage(t.id, {
            type: MSG.SET_PROBE,
            enabled: probeEnabled,
          }).catch(() => {});
        }
      }
      respond(sendResponse, { ok: true, probeEnabled });
      return;
    }

    respond(sendResponse, { ok: false, error: "Unknown message" });
  })();

  return true;
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message?.type === MSG.SESSION_LOGGED_IN && sender.tab?.id) {
      await injectCaptureHook(sender.tab.id);
      respond(sendResponse, { ok: true });
      return;
    }

    if (message?.type === MSG.POST_SYNC_PAYLOAD) {
      await postPayloadToErp(message.payload);
      respond(sendResponse, { ok: true });
      return;
    }

    if (message?.type === "PROBE_LOG" && probeEnabled) {
      const logs =
        (await chrome.storage.local.get("probeLogs")).probeLogs || [];
      logs.unshift({
        at: new Date().toISOString(),
        url: message.url,
        method: message.method,
      });
      await chrome.storage.local.set({ probeLogs: logs.slice(0, 200) });
      respond(sendResponse, { ok: true });
      return;
    }
  })();
  return true;
});

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== "complete" || !tab.url) return;
  if (!/sdms\.udiseplus\.gov\.in|udiseplus\.gov\.in/i.test(tab.url)) return;

  const data = await chrome.storage.session.get([
    "pendingAutofill",
    "pendingAutofillAt",
  ]);
  const creds = data.pendingAutofill;
  if (creds && /login/i.test(tab.url)) {
    const age = Date.now() - (data.pendingAutofillAt || 0);
    if (age < 120_000) {
      chrome.tabs.sendMessage(tabId, {
        type: MSG.AUTOFILL,
        credentials: creds,
      }).catch(() => {});
    }
  }

  if (!/login/i.test(tab.url) && creds) {
    await chrome.storage.session.remove([
      "pendingAutofill",
      "pendingAutofillAt",
    ]);
    pendingAutofill = null;
    await injectCaptureHook(tabId);
  }
});
