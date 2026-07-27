(function () {
  const MSG = {
    SESSION_LOGGED_IN: "UDISE_BRIDGE_SESSION_LOGGED_IN",
    POST_SYNC_PAYLOAD: "UDISE_BRIDGE_POST_SYNC_PAYLOAD",
  };

  let wasLogin = /login/i.test(location.href);

  function checkSession() {
    const onLogin = /login/i.test(location.href);
    if (wasLogin && !onLogin) {
      chrome.runtime.sendMessage({ type: MSG.SESSION_LOGGED_IN }).catch(() => {});
    }
    wasLogin = onLogin;
  }

  window.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || data.source !== "udise-bridge-extension") return;
    if (data.type === MSG.POST_SYNC_PAYLOAD && data.payload?.base64) {
      chrome.runtime
        .sendMessage({
          type: MSG.POST_SYNC_PAYLOAD,
          payload: data.payload,
        })
        .catch(() => {});
    }
  });

  checkSession();
  const obs = new MutationObserver(() => checkSession());
  obs.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("hashchange", checkSession);
  window.addEventListener("popstate", checkSession);
})();
