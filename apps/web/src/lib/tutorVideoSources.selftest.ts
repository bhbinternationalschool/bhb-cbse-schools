/**
 * Self-test: where the tutor's topic videos come from — DIKSHA grades,
 * search phrases, which entries can be played by which app, and merging.
 * Run: npx tsx apps/web/src/lib/tutorVideoSources.selftest.ts
 */
import assert from "node:assert/strict";
import {
  buildVideoTermsUserPrompt,
  dikshaCandidate,
  dikshaGradesFor,
  dikshaSearchBody,
  fallbackSearchPhrases,
  mergeVideos,
  nameMatchesPhrase,
  normaliseTopic,
  orderSeriesParts,
  parseVideoFormats,
  parseVideoTermsJson,
  youtubeIdFrom,
  type DikshaContent,
  type TutorVideo,
} from "@/lib/tutorVideoSources";

// ── What the app can play ───────────────────────────────────────────────
{
  assert.deepEqual(parseVideoFormats(undefined), ["youtube"], "a build that says nothing plays YouTube only");
  assert.deepEqual(parseVideoFormats(["youtube"]), ["youtube"]);
  assert.deepEqual(parseVideoFormats(["youtube", "mp4"]), ["youtube", "mp4"]);
  assert.deepEqual(parseVideoFormats("mp4"), ["youtube"], "a bare string is not a list");
}

// ── Class label → DIKSHA grades ─────────────────────────────────────────
{
  assert.deepEqual(dikshaGradesFor("VI A"), { exact: "Class 6", nearby: ["Class 5", "Class 7"] });
  assert.deepEqual(dikshaGradesFor("I A"), { exact: "Class 1", nearby: ["Preschool 3", "Class 2"] });
  assert.deepEqual(dikshaGradesFor("VIII"), { exact: "Class 8", nearby: ["Class 7", "Class 9"] });
  assert.equal(dikshaGradesFor("IV B")?.exact, "Class 4");
  assert.equal(dikshaGradesFor("VII A")?.exact, "Class 7");
  assert.equal(dikshaGradesFor("Class 3")?.exact, "Class 3");
  assert.equal(dikshaGradesFor("X")?.exact, "Class 10");
  assert.deepEqual(dikshaGradesFor("Nursery A"), { exact: "Preschool 1", nearby: ["Preschool 2"] });
  assert.equal(dikshaGradesFor("LKG A")?.exact, "Preschool 2");
  assert.deepEqual(dikshaGradesFor("UKG"), { exact: "Preschool 3", nearby: ["Preschool 2", "Class 1"] });
  assert.equal(dikshaGradesFor("their class"), null, "the route's placeholder label names no class");
  assert.equal(dikshaGradesFor(""), null);
}

// ── Search phrases ──────────────────────────────────────────────────────
{
  assert.deepEqual(parseVideoTermsJson('{"en":["Photosynthesis","Nutrition in Plants"],"hi":["प्रकाश संश्लेषण","पादपों में पोषण"]}'), {
    en: ["Photosynthesis", "Nutrition in Plants"],
    hi: ["प्रकाश संश्लेषण", "पादपों में पोषण"],
  });
  assert.deepEqual(parseVideoTermsJson('```json\n{"en":["fractions"],"hi":["भिन्न"]}\n```'), { en: ["fractions"], hi: ["भिन्न"] }, "a fenced reply still parses");
  const messy = parseVideoTermsJson(
    JSON.stringify({
      en: ["What is photosynthesis and why do plants need it?", "photosynthesis?", "Photosynthesis", "प्रकाश", 7, "leaf", "stomata", "extra"],
      hi: ["photosynthesis", "प्रकाश संश्लेषण"],
    }),
  );
  assert.deepEqual(messy?.en, ["photosynthesis", "leaf", "stomata"], "sentences, repeats, wrong script and non-strings are dropped; at most 3");
  assert.deepEqual(messy?.hi, ["प्रकाश संश्लेषण"], "a Hindi phrase must be Devanagari");
  assert.equal(parseVideoTermsJson("not json"), null);
  assert.deepEqual(parseVideoTermsJson('{"en":"fractions"}'), { en: [], hi: [] });

  assert.deepEqual(fallbackSearchPhrases("What is photosynthesis?", "en"), ["photosynthesis"]);
  assert.deepEqual(fallbackSearchPhrases("Explain the water cycle with examples", "en"), ["water cycle"], "one phrase, never a lone word");
  assert.deepEqual(fallbackSearchPhrases("प्रकाश संश्लेषण क्या है?", "hi"), ["प्रकाश संश्लेषण"]);
  assert.deepEqual(fallbackSearchPhrases("photosynthesis kya hota hai", "hi"), [], "no Devanagari → no Hindi-medium search");
  assert.deepEqual(fallbackSearchPhrases("photosynthesis kya hota hai", "en"), ["photosynthesis"]);
  assert.deepEqual(fallbackSearchPhrases("class 6 chapter 3", "en"), [], "numbers and filler are not a topic");

  assert.equal(buildVideoTermsUserPrompt({ topic: "  what   is\nhcf ", grade: "Class 6" }), "Class: Class 6\nQuestion: what is hcf");
  assert.equal(normaliseTopic("  Fractions   KYA hai "), "fractions kya hai");
}

// ── Is a DIKSHA result about the phrase? (cases from live searches) ────
{
  const yes: [string, string][] = [
    ["Addition of two digit numbers | Part 1/3 | English | Class 2", "Two Digit Addition"],
    ["Activity 30: Counting Objects (Numbers 1–10)", "Counting"],
    ["Properties of Division of Rational Numbers", "Properties of Rational Numbers"],
    ["Types of Maps", "Maps"],
    ["Types of Maps", "map"],
    ["पादपों में पोषण", "पादपों में पोषण"],
    ["अध्याय-7 भिन्न : भाग -4 : 7.10 भिन्नों का योग", "भिन्न"],
    ["Nutrition in Plants · Photosynthesis-Food making Process in Plant · 3", "Photosynthesis"],
    ["रंग के आधार पर चीज़ों को छाँटना", "रंग"],
    ["Chapter 7 -Fractions : Part-1 : 7.1 Introduction", "Fraction"],
  ];
  for (const [name, phrase] of yes) assert.ok(nameMatchesPhrase(name, phrase), `"${name}" is about "${phrase}"`);
  const no: [string, string][] = [
    ["विभिन्न पक्षी | Part1/2 | Different Birds | Hindi | Class 4", "भिन्न"],
    ["बन्दर बांट", "संज्ञा"],
    ["अध्याय 25- सबसे बड़ा छाता", "पौधों की देखभाल"],
    ["Sources of water", "Water Cycle"],
    ["जलवायु और मौसम", "जल"],
    ["Mapping the village", "map"],
    ["Fun with Numbers", "Two Digit Addition"],
    ["anything", "and of the"],
  ];
  for (const [name, phrase] of no) assert.ok(!nameMatchesPhrase(name, phrase), `"${name}" is not about "${phrase}"`);
}

// ── Search request ──────────────────────────────────────────────────────
{
  const body = dikshaSearchBody({ phrase: "भिन्न", grades: ["Class 6"], medium: "Hindi", formats: ["youtube"], limit: 8 });
  assert.deepEqual(body.request.filters.mimeType, ["video/x-youtube"], "an old build is never offered a file");
  assert.deepEqual(body.request.filters.board, ["CBSE", "NCERT"]);
  assert.deepEqual(body.request.filters.medium, ["Hindi"]);
  const both = dikshaSearchBody({ phrase: "x", grades: ["Class 6"], medium: "English", formats: ["youtube", "mp4"], limit: 8 });
  assert.deepEqual(both.request.filters.mimeType, ["video/x-youtube", "video/mp4"]);
}

// ── DIKSHA entries → playable videos ────────────────────────────────────
{
  assert.equal(youtubeIdFrom("https://www.youtube.com/embed/qCShwSTLdYc?autoplay=1&enablejsapi=1"), "qCShwSTLdYc");
  assert.equal(youtubeIdFrom("https://www.youtube.com/watch?feature=share&v=AOTmUQImNHw"), "AOTmUQImNHw");
  assert.equal(youtubeIdFrom("https://youtu.be/GYPRnu-vG7Q"), "GYPRnu-vG7Q");
  assert.equal(youtubeIdFrom("https://www.youtube.com/embed/tooShort"), "");
  assert.equal(youtubeIdFrom(undefined), "");

  const yt: DikshaContent = {
    identifier: "do_31257970066648268828460",
    name: "अपनी संख्याओं की जानकारी_व्यावहारिक प्रयोग में बड़ी संख्याएँ_1",
    mimeType: "video/x-youtube",
    artifactUrl: "https://www.youtube.com/embed/AOTmUQImNHw?autoplay=1&enablejsapi=1",
    license: "Standard YouTube License",
  };
  const ytVideo = dikshaCandidate(yt, ["youtube"]);
  assert.equal(ytVideo?.videoId, "AOTmUQImNHw");
  assert.equal(ytVideo?.kind, "youtube");
  assert.equal(ytVideo?.source, "diksha");
  assert.equal(ytVideo?.url, "https://www.youtube.com/watch?v=AOTmUQImNHw");
  assert.equal(ytVideo?.title, "अपनी संख्याओं की जानकारी · व्यावहारिक प्रयोग में बड़ी संख्याएँ · 1");
  assert.equal(ytVideo?.channel, "DIKSHA", "no creator listed → credited to DIKSHA");

  const mp4: DikshaContent = {
    identifier: "do_3129266347955159041579",
    name: "Fractions",
    mimeType: "video/mp4",
    artifactUrl: "https://obj.diksha.gov.in/ntp-content-production/content/assets/do_3129266347955159041579/nl5hymp3y1o.mp4",
    appIcon: "https://obj.diksha.gov.in/ntp-content-production/content/do_3129266347955159041579/artifact/khanacademy.thumb.png",
    license: "CC BY-NC-SA 4.0",
    creator: "Mathu Shalini",
    organisation: ["Khan Academy"],
  };
  assert.equal(dikshaCandidate(mp4, ["youtube"]), null, "a file is never handed to a build that cannot play it");
  const file = dikshaCandidate(mp4, ["youtube", "mp4"]);
  assert.equal(file?.kind, "mp4");
  assert.equal(file?.videoId, "");
  assert.equal(file?.mediaUrl, mp4.artifactUrl);
  assert.equal(file?.url, "https://diksha.gov.in/play/content/do_3129266347955159041579");
  assert.equal(file?.channel, "Khan Academy", "the organisation is credited before the uploader");
  assert.equal(file?.license, "CC BY-NC-SA 4.0");
  assert.ok(file?.thumbnail.startsWith("https://"));

  for (const license of ["CC BY 4.0", "CC BY-SA 4.0", "CC BY-ND 4.0", "CC BY-NC 4.0", "CC BY-NC-ND 4.0"]) {
    assert.ok(dikshaCandidate({ ...mp4, license }, ["youtube", "mp4"]), `${license} may be shown with credit`);
  }
  for (const license of ["", "All rights reserved", "Standard YouTube License"]) {
    assert.equal(dikshaCandidate({ ...mp4, license }, ["youtube", "mp4"]), null, `a file under "${license}" is left out`);
  }
  assert.equal(dikshaCandidate({ ...mp4, artifactUrl: "http://obj.diksha.gov.in/x.mp4" }, ["youtube", "mp4"]), null, "plain http is not played");
  assert.equal(dikshaCandidate({ ...mp4, artifactUrl: "https://obj.diksha.gov.in/x.ecar" }, ["youtube", "mp4"]), null, "only an mp4 file");
  assert.equal(dikshaCandidate({ ...yt, artifactUrl: "https://example.com/video" }, ["youtube"]), null, "a YouTube entry with no id is dropped");
  assert.equal(dikshaCandidate({ ...mp4, mimeType: "application/pdf" }, ["youtube", "mp4"]), null);
  assert.equal(dikshaCandidate({ ...mp4, identifier: "" }, ["youtube", "mp4"]), null);
}

// ── Merging ─────────────────────────────────────────────────────────────
{
  const v = (id: string, title: string, over: Partial<TutorVideo> = {}): TutorVideo => ({
    videoId: id,
    title,
    channel: "",
    thumbnail: "",
    url: "",
    kind: "youtube",
    mediaUrl: "",
    source: "diksha",
    license: "",
    ...over,
  });
  const first = [v("aaaaaaaaaaa", "Photosynthesis"), v("bbbbbbbbbbb", "Nutrition in Plants · 1")];
  const second = [
    v("aaaaaaaaaaa", "Something else"),
    v("ccccccccccc", "photosynthesis!"),
    v("", "Fractions", { kind: "mp4", mediaUrl: "https://x/1.mp4" }),
    v("", "Fractions (2)", { kind: "mp4", mediaUrl: "https://x/1.mp4" }),
    v("ddddddddddd", "Stomata"),
  ];
  const merged = mergeVideos([first, second], 10);
  assert.deepEqual(
    merged.map((m) => m.title),
    ["Photosynthesis", "Nutrition in Plants · 1", "Fractions", "Stomata"],
    "earlier lists lead; a repeated id, file or title is dropped",
  );
  assert.equal(mergeVideos([first, second], 2).length, 2, "stops at the limit");
  assert.deepEqual(mergeVideos([], 5), []);

  const titles = (list: TutorVideo[]) => orderSeriesParts(list).map((m) => m.title);
  assert.deepEqual(
    titles([
      v("", "Decoration for Festival (Addition and Subtraction) Part 3"),
      v("", "Tens and Ones"),
      v("", "Decoration for Festival (Addition and Subtraction) Part 1"),
      v("", "Addition of two digit numbers | Part 2/3 | English | Class 2"),
      v("", "Decoration for Festival (Addition and Subtraction) Part 2"),
      v("", "Addition of two digit numbers | Part 1/3 | English | Class 2"),
    ]),
    [
      "Decoration for Festival (Addition and Subtraction) Part 1",
      "Decoration for Festival (Addition and Subtraction) Part 2",
      "Decoration for Festival (Addition and Subtraction) Part 3",
      "Tens and Ones",
      "Addition of two digit numbers | Part 1/3 | English | Class 2",
      "Addition of two digit numbers | Part 2/3 | English | Class 2",
    ],
    "a series is gathered where it first appears, in part order; the rest keep their place",
  );
  assert.deepEqual(titles([v("", "अध्याय 9 - भाग 2"), v("", "अध्याय 9 - भाग 1")]), ["अध्याय 9 - भाग 1", "अध्याय 9 - भाग 2"]);
  assert.deepEqual(titles([v("", "Counting"), v("", "Numbers")]), ["Counting", "Numbers"], "no parts → unchanged");
  assert.deepEqual(titles([v("", "Counterpart 2"), v("", "Counterpart 1")]), ["Counterpart 2", "Counterpart 1"], "a word ending in part is not a part");
}

console.log("tutorVideoSources.selftest: ok");
