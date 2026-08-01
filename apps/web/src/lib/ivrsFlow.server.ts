/**
 * IVRS call flow — Exotel / Twilio-compatible XML (Hindi + English).
 */

import { TENANT } from "@/lib/types";

export type IvrCallState = {
  callSid: string;
  from: string;
  step: "root" | "lang" | "menu" | "admissions" | "fees" | "callback";
  lang: "en" | "hi";
  updatedAt: string;
};

const calls = new Map<string, IvrCallState>();

function now() {
  return new Date().toISOString();
}

export function getIvrState(callSid: string, from: string): IvrCallState {
  const existing = calls.get(callSid);
  if (existing) return existing;
  const state: IvrCallState = {
    callSid,
    from,
    step: "root",
    lang: "hi",
    updatedAt: now(),
  };
  calls.set(callSid, state);
  return state;
}

export function setIvrState(state: IvrCallState): void {
  calls.set(state.callSid, { ...state, updatedAt: now() });
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function say(text: string, lang: "en" | "hi"): string {
  const code = lang === "hi" ? "hi-IN" : "en-IN";
  return `<Say language="${code}">${esc(text)}</Say>`;
}

function gather(action: string, numDigits: number, prompt: string): string {
  return `<Gather numDigits="${numDigits}" action="${esc(action)}" method="POST" timeout="8">${prompt}</Gather>`;
}

const ROOT_HI = `नमस्ते, ${TENANT.nameDisplay}। प्रवेश के लिए 1 दबाएँ, फीस जानकारी के लिए 2, हिंदी मेनू के लिए 3, कॉलबैक के लिए 9।`;
const ROOT_EN = `Welcome to ${TENANT.shortName}. Press 1 for admissions, 2 for fees, 3 for Hindi menu, 9 for callback.`;

export function buildIvrResponse(opts: {
  callSid: string;
  from: string;
  digits?: string;
  webhookUrl: string;
}): { xml: string; state: IvrCallState } {
  let state = getIvrState(opts.callSid, opts.from);
  const d = (opts.digits || "").trim();
  const action = opts.webhookUrl;

  if (state.step === "root" && !d) {
    const prompt = `${say(ROOT_HI, "hi")}${say(ROOT_EN, "en")}`;
    return {
      state,
      xml: wrap(
        `${gather(action, 1, prompt)}${say("We did not receive input. Goodbye.", "en")}`,
      ),
    };
  }

  if (d === "3") {
    state = { ...state, lang: "hi", step: "menu" };
    setIvrState(state);
  } else if (d === "1") {
    state = { ...state, step: "admissions" };
    setIvrState(state);
    const msg =
      state.lang === "hi"
        ? `प्रवेश हेतु वेबसाइट पर फॉर्म भरें या व्हाट्सऐप पर मैसेज करें। स्कूल नंबर +91 94519 38805।`
        : `For admissions visit our website or WhatsApp +91 94519 38805. Thank you.`;
    return {
      state,
      xml: wrap(`${say(msg, state.lang)}<Hangup/>`),
    };
  } else if (d === "2") {
    state = { ...state, step: "fees" };
    setIvrState(state);
    const msg =
      state.lang === "hi"
        ? `फीस भुगतान पेरेंट पोर्टल या व्हाट्सऐप फीस मेनू से करें। धन्यवाद।`
        : `Pay fees via the parent portal or WhatsApp fee menu. Thank you.`;
    return {
      state,
      xml: wrap(`${say(msg, state.lang)}<Hangup/>`),
    };
  } else if (d === "9") {
    state = { ...state, step: "callback" };
    setIvrState(state);
    const msg =
      state.lang === "hi"
        ? `आपका नंबर नोट कर लिया गया। हम जल्द कॉल करेंगे। धन्यवाद।`
        : `Your number is noted. We will call you back soon. Thank you.`;
    return {
      state,
      xml: wrap(`${say(msg, state.lang)}<Hangup/>`),
    };
  } else if (d === "0" || !d) {
    state = { ...state, step: "root" };
    setIvrState(state);
    const prompt = `${say(ROOT_HI, "hi")}`;
    return {
      state,
      xml: wrap(`${gather(action, 1, prompt)}<Hangup/>`),
    };
  }

  const invalid =
    state.lang === "hi"
      ? "गलत विकल्प। फिर से कोशिश करें।"
      : "Invalid option. Try again.";
  return {
    state,
    xml: wrap(
      `${say(invalid, state.lang)}${gather(action, 1, say(ROOT_HI, "hi"))}<Hangup/>`,
    ),
  };
}

function wrap(inner: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`;
}

export function ivrHealth() {
  return {
    service: "ivrs",
    activeCalls: calls.size,
    school: TENANT.nameDisplay,
    languages: ["hi-IN", "en-IN"],
    menu: {
      "1": "Admissions info",
      "2": "Fees info",
      "3": "Hindi menu",
      "9": "Callback request",
      "0": "Main menu",
    },
    webhookNote: "POST with CallSid, From, Digits (Exotel/Twilio style)",
  };
}
