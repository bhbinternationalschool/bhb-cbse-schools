(function () {
  /** Injected in page MAIN world via scripting API when probe enabled; also self-hook here for fetch logging from isolated bridge. */

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "UDISE_BRIDGE_SET_PROBE") return;
    if (message.enabled) {
      injectProbe();
    }
  });

  chrome.storage.local.get("probeEnabled").then((data) => {
    if (data.probeEnabled) injectProbe();
  });

  function injectProbe() {
    if (document.documentElement.dataset.udiseBridgeProbe) return;
    document.documentElement.dataset.udiseBridgeProbe = "1";

    const script = document.createElement("script");
    script.textContent = `(() => {
      if (window.__udiseBridgeProbe) return;
      window.__udiseBridgeProbe = true;
      const log = (url, method) => {
        window.postMessage({ source: 'udise-bridge-probe', url: String(url), method }, '*');
      };
      const f = window.fetch;
      window.fetch = function(...args) {
        log(args[0], 'FETCH');
        return f.apply(this, args);
      };
      const o = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        this.__udiseProbeUrl = url;
        this.__udiseProbeMethod = method;
        return o.call(this, method, url, ...rest);
      };
      const s = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.send = function(...args) {
        this.addEventListener('load', function() {
          log(this.__udiseProbeUrl, this.__udiseProbeMethod || 'XHR');
        });
        return s.apply(this, args);
      };
    })();`;
    (document.head || document.documentElement).appendChild(script);
    script.remove();
  }

  window.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || data.source !== "udise-bridge-probe") return;
    chrome.runtime
      .sendMessage({
        type: "PROBE_LOG",
        url: data.url,
        method: data.method,
      })
      .catch(() => {});
  });
})();
