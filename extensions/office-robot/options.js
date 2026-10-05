const who = document.getElementById("who");

chrome.runtime.sendMessage({ type: "whoami" }, (r) => {
  if (r && r.ok) {
    who.textContent = `✓ ERP login: ${r.body.name || "staff"} · session ${r.body.academicYearCode || "?"}`;
  } else {
    who.textContent = (r && r.error) || "Could not check the ERP login.";
  }
});
