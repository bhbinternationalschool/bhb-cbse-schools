const erp = document.getElementById("erp");
const who = document.getElementById("who");
const saved = document.getElementById("saved");

async function check() {
  who.textContent = "Checking your ERP login…";
  chrome.runtime.sendMessage({ type: "whoami" }, (r) => {
    if (r && r.ok) who.textContent = `✓ ERP login: ${r.body.name || "staff"} · session ${r.body.academicYearCode || "?"}`;
    else who.textContent = (r && r.error) || "Could not check the ERP login.";
  });
}

chrome.storage.sync.get("erpBase").then(({ erpBase }) => {
  erp.value = erpBase || "https://bhbinternational.school";
  void check();
});

document.getElementById("save").addEventListener("click", async () => {
  const v = erp.value.trim().replace(/\/+$/, "");
  // Only addresses the extension is allowed to reach (manifest host_permissions).
  if (!/^https:\/\/bhbinternational\.school$|^http:\/\/localhost(:\d+)?$/.test(v)) {
    saved.textContent = "Use https://bhbinternational.school (or http://localhost:<port> for testing).";
    return;
  }
  await chrome.storage.sync.set({ erpBase: v });
  saved.textContent = "Saved.";
  void check();
});
