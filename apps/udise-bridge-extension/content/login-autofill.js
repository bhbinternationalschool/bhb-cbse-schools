(function () {
  const MSG = {
    AUTOFILL: "UDISE_BRIDGE_AUTOFILL",
  };

  function isCaptchaField(el) {
    const hint = (
      (el.name || "") +
      (el.id || "") +
      (el.placeholder || "") +
      (el.getAttribute("aria-label") || "")
    ).toLowerCase();
    return /captcha|security|otp|verify/i.test(hint);
  }

  function findUsernameField() {
    const inputs = [...document.querySelectorAll("input")];
    for (const el of inputs) {
      if (el.type === "password" || el.type === "hidden") continue;
      if (isCaptchaField(el)) continue;
      const hint = (
        (el.name || "") +
        (el.id || "") +
        (el.placeholder || "") +
        (el.getAttribute("aria-label") || "")
      ).toLowerCase();
      if (
        /user|login|userid|username|udise|school/i.test(hint) ||
        el.type === "text" ||
        el.type === "email"
      ) {
        return el;
      }
    }
    return inputs.find(
      (el) =>
        el.type === "text" &&
        !isCaptchaField(el) &&
        el.offsetParent !== null,
    );
  }

  function findPasswordField() {
    return document.querySelector('input[type="password"]');
  }

  function autofill(credentials) {
    if (!credentials?.username || !credentials?.password) return false;
    const user = findUsernameField();
    const pass = findPasswordField();
    if (!user || !pass) return false;

    user.focus();
    user.value = credentials.username;
    user.dispatchEvent(new Event("input", { bubbles: true }));
    user.dispatchEvent(new Event("change", { bubbles: true }));

    pass.focus();
    pass.value = credentials.password;
    pass.dispatchEvent(new Event("input", { bubbles: true }));
    pass.dispatchEvent(new Event("change", { bubbles: true }));

    // Never touch CAPTCHA fields
    return true;
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === MSG.AUTOFILL && message.credentials) {
      autofill(message.credentials);
    }
  });

  chrome.storage.session.get(["pendingAutofill"]).then((data) => {
    if (data.pendingAutofill && /login/i.test(location.href)) {
      setTimeout(() => autofill(data.pendingAutofill), 800);
    }
  });
})();
