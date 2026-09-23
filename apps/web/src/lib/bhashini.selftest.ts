import assert from "node:assert/strict";
import {
  BHASHINI_MAX_INPUT_CHARS,
  DEFAULT_PIPELINE_ID,
  bhashiniLang,
  bhashiniSupportedSarvamCodes,
  bhashiniSupportsPair,
  configRequestBody,
  inferenceRequestBody,
  parsePipelineConfig,
  parseTranslation,
} from "./bhashini";
import { HOUSEHOLD_LANGUAGES } from "./householdPrefs";

console.log("bhashini.selftest.ts");

/* ── Languages: what it can do, and what it must refuse ──────────────── */

assert.equal(bhashiniLang("hi-IN"), "hi");
assert.equal(bhashiniLang("en-IN"), "en");
assert.equal(bhashiniLang("mai-IN"), "mai", "Maithili is a scheduled language");
// Sarvam spells Odia "od-IN"; ISO 639-1, which Bhashini follows, is "or".
assert.equal(bhashiniLang("od-IN"), "or");
assert.equal(bhashiniLang(""), null);
assert.equal(bhashiniLang("klingon"), null);

// THE rule of this module. Bhojpuri is not in the Eighth Schedule, so
// Bhashini has no model for it — and answering a Bhojpuri household in
// Hindi because it is close enough is the school deciding a family's
// language for them. householdPrefs already records the gap as
// `sarvam: null`; this pins that Bhashini does not silently close it.
const bho = HOUSEHOLD_LANGUAGES.find((l) => l.id === "bho");
assert.ok(bho, "Bhojpuri is still an offered household language");
assert.equal(bho!.sarvam, null, "Sarvam cannot do Bhojpuri either");
assert.equal(bhashiniLang("bho"), null, "and neither can Bhashini");
assert.equal(bhashiniLang("bho-IN"), null, "not under a made-up code either");
assert.equal(bhashiniSupportsPair("en-IN", "bho"), false);

assert.ok(bhashiniSupportsPair("en-IN", "hi-IN"));
assert.equal(bhashiniSupportsPair("en-IN", "klingon"), false);

// Every language the school offers that Sarvam CAN translate should be
// reachable for free too — otherwise the paid key keeps doing work the
// free engine could have done. A new household language failing this is a
// prompt to add its mapping, not to delete the assertion.
for (const l of HOUSEHOLD_LANGUAGES) {
  if (!l.sarvam) continue;
  assert.ok(
    bhashiniLang(l.sarvam) !== null,
    `${l.id} (${l.sarvam}) is paid-translatable but has no free mapping`,
  );
}
assert.ok(bhashiniSupportedSarvamCodes().includes("hi-IN"));

/* ── Step 1: the config request ──────────────────────────────────────── */

{
  const body = configRequestBody("en", "hi", DEFAULT_PIPELINE_ID);
  assert.equal(body.pipelineTasks[0].taskType, "translation");
  assert.deepEqual(body.pipelineTasks[0].config.language, {
    sourceLanguage: "en",
    targetLanguage: "hi",
  });
  assert.equal(body.pipelineRequestConfig.pipelineId, DEFAULT_PIPELINE_ID);
}

/* ── Step 1: reading the answer ──────────────────────────────────────── */

const CONFIG_OK = {
  pipelineResponseConfig: [
    {
      taskType: "translation",
      config: [
        {
          serviceId: "ai4bharat/indictrans-v2-all-gpu--t4",
          language: { sourceLanguage: "en", targetLanguage: "hi" },
        },
      ],
    },
  ],
  pipelineInferenceAPIEndPoint: {
    callbackUrl: "https://dhruva-api.bhashini.gov.in/services/inference/pipeline",
    inferenceApiKey: { name: "Authorization", value: "token-abc" },
  },
};

{
  const c = parsePipelineConfig(CONFIG_OK);
  assert.ok(c);
  if (!c) throw new Error();
  assert.equal(c.serviceId, "ai4bharat/indictrans-v2-all-gpu--t4");
  assert.equal(c.endpoint, "https://dhruva-api.bhashini.gov.in/services/inference/pipeline");
  assert.equal(c.headerName, "Authorization");
  assert.equal(c.headerValue, "token-abc");
}
{
  // The callback NAMES its own auth header. Assuming "Authorization" would
  // be a 401 on every call, indistinguishable from bad credentials.
  const c = parsePipelineConfig({
    ...CONFIG_OK,
    pipelineInferenceAPIEndPoint: {
      callbackUrl: "https://dhruva-api.bhashini.gov.in/x",
      inferenceApiKey: { name: "x-auth-source", value: "tok" },
    },
  });
  assert.ok(c && c.headerName === "x-auth-source" && c.headerValue === "tok");
}
// Any missing piece means we cannot call, so: no config, fall through.
assert.equal(parsePipelineConfig({ ...CONFIG_OK, pipelineResponseConfig: [] }), null);
assert.equal(parsePipelineConfig({ ...CONFIG_OK, pipelineInferenceAPIEndPoint: {} }), null);
assert.equal(
  parsePipelineConfig({
    ...CONFIG_OK,
    pipelineInferenceAPIEndPoint: {
      callbackUrl: "https://x/y",
      inferenceApiKey: { name: "Authorization" },
    },
  }),
  null,
  "a header name with no value cannot authenticate",
);
assert.equal(parsePipelineConfig("<html>502</html>"), null);
assert.equal(parsePipelineConfig(null), null);

/* ── Step 2: the inference request ───────────────────────────────────── */

{
  const body = inferenceRequestBody({ serviceId: "svc", from: "en", to: "hi", text: "Fees due" });
  assert.equal(body.pipelineTasks[0].config.serviceId, "svc");
  assert.deepEqual(body.pipelineTasks[0].config.language, {
    sourceLanguage: "en",
    targetLanguage: "hi",
  });
  assert.deepEqual(body.inputData.input, [{ source: "Fees due" }]);
}

/* ── Step 2: reading the answer ──────────────────────────────────────── */

assert.equal(
  parseTranslation(
    { pipelineResponse: [{ taskType: "translation", output: [{ source: "Fees due", target: "शुल्क बकाया है" }] }] },
    "Fees due",
  ),
  "शुल्क बकाया है",
);
// The failure that would otherwise be logged as a success: Bhashini echoing
// the input back, and a Hindi-speaking parent getting English.
assert.equal(
  parseTranslation({ pipelineResponse: [{ output: [{ source: "Fees due", target: "Fees due" }] }] }, "Fees due"),
  null,
  "an echo is not a translation",
);
assert.equal(
  parseTranslation({ pipelineResponse: [{ output: [{ source: "Fees due", target: "Fees due" }] }] }, "  Fees due  "),
  null,
  "an echo of the trimmed input is still an echo",
);
assert.equal(parseTranslation({ pipelineResponse: [{ output: [] }] }, "x"), null);
assert.equal(parseTranslation({ pipelineResponse: [] }, "x"), null);
assert.equal(parseTranslation({ error: "quota exceeded" }, "x"), null);
assert.equal(parseTranslation("<html>429</html>", "x"), null);
assert.equal(parseTranslation(null, "x"), null);

assert.ok(BHASHINI_MAX_INPUT_CHARS > 0);

console.log("OK — bhashini.selftest.ts");
