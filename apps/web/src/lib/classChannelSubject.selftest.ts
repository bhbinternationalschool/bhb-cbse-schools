import assert from "node:assert/strict";

console.log("classChannelSubject.selftest.ts");

/** What teachers type for a subject finds the Masters subject (9 Oct 2026). */
async function main() {
  const { matchSubject } = await import("./classChannelSubject");
  const masters = {
    subjects: [
      { id: "ss", nameEn: "Social Science", code: "SST" },
      { id: "sc", nameEn: "Science", code: "SCI" },
      { id: "ma", nameEn: "Mathematics", code: "MAT" },
      { id: "en", nameEn: "English", code: "ENG" },
      { id: "ev", nameEn: "EVS", code: "EVS" },
    ],
  } as never;
  const id = (h: string) => matchSubject(masters, h)?.id ?? "";
  assert.equal(id("maths"), "ma", "maths → Mathematics (never matched before)");
  assert.equal(id("math"), "ma");
  assert.equal(id("sst"), "ss");
  assert.equal(id("science"), "sc", "science is Science, not Social Science");
  assert.equal(id("english"), "en");
  assert.equal(id("eng"), "en");
  assert.equal(id("evs"), "ev");
  assert.equal(id("french"), "");
  console.log("classChannelSubject.selftest: all assertions passed");
}
void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
