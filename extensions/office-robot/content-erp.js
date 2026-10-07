/*
 * BHB Office Robot — on the school ERP only: tells the ERP page that the
 * robot is installed in this browser, and which version, so Students →
 * UDISE+ can show "Robot installed ✓" or an Install button. It reads
 * nothing and sends nothing.
 */
(() => {
  try {
    document.documentElement.dataset.bhbOfficeRobot = chrome.runtime.getManifest().version;
  } catch {
    // An extension reload can leave this script orphaned; the page then just shows "not detected".
  }
})();
