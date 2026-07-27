import { MSG } from "../lib/bridge-protocol.js";

const DEFAULT_LOGIN = "https://sdms.udiseplus.gov.in/p2/v1/login";

const statusEl = document.getElementById("status");
const logsEl = document.getElementById("logs");

async function refresh() {
  const { probeEnabled, lastSyncAt, probeLogs } =
    await chrome.storage.local.get([
      "probeEnabled",
      "lastSyncAt",
      "probeLogs",
    ]);
  statusEl.textContent = `Probe: ${probeEnabled ? "ON" : "OFF"}${lastSyncAt ? ` · Last sync ${lastSyncAt.slice(0, 19)}` : ""}`;
  const logs = probeLogs || [];
  logsEl.textContent = logs.length
    ? logs
        .slice(0, 8)
        .map((l) => `${l.method} ${l.url}`)
        .join("\n")
    : "—";
}

document.getElementById("openLogin").addEventListener("click", async () => {
  await chrome.tabs.create({ url: DEFAULT_LOGIN, active: true });
});

document.getElementById("probe").addEventListener("click", async () => {
  const { probeEnabled } = await chrome.storage.local.get("probeEnabled");
  const enabled = !probeEnabled;
  await chrome.storage.local.set({ probeEnabled: enabled });
  const tabs = await chrome.tabs.query({
    url: ["https://sdms.udiseplus.gov.in/*", "https://udiseplus.gov.in/*"],
  });
  for (const t of tabs) {
    if (t.id) {
      chrome.tabs
        .sendMessage(t.id, { type: MSG.SET_PROBE, enabled })
        .catch(() => {});
    }
  }
  refresh();
});

refresh();
