import assert from "node:assert/strict";
import { buildLeadExtractSystemPrompt, parseLeadExtract } from "./leadExtractAi";

console.log("leadExtractAi.selftest.ts");
const classes = ["Nursery", "LKG", "I", "VI", "VII"];
assert.match(buildLeadExtractSystemPrompt(classes), /never infer a class from age/);
const r = parseLeadExtract(
  JSON.stringify({ childName: "Aarav Sharma", dob: "2015-03-04", gender: "Male", classSoughtLabel: "vi", guardianName: "Rakesh Sharma", mobile: "+91 99999 00001", email: "bad@", pincode: "2210", previousBoard: "up_board", transportInterest: "Yes", preferredLanguage: "hindi", concerns: ["fees", "Transport", "fees", "ponies"], summary: "wants VI, asks bus fee", missing: ["motherName"] }),
  classes,
);
assert.ok(r);
assert.equal(r!.classSoughtLabel, "VI", "class matched case-insensitively to the school's list");
assert.equal(r!.mobile, "9999900001");
assert.equal(r!.email, "", "invalid email dropped");
assert.equal(r!.pincode, "", "bad pincode dropped");
assert.equal(r!.previousBoard, "UP_BOARD");
assert.equal(r!.transportInterest, "yes");
assert.equal(r!.preferredLanguage, "", "'hindi' is not a code → not asked (never guessed)");
assert.deepEqual(r!.concerns, ["fees", "transport"]);
assert.ok(r!.missing.includes("motherName") && r!.missing.includes("email") && r!.missing.includes("preferredLanguage"));
assert.equal(parseLeadExtract("{}", classes), null);
assert.equal(parseLeadExtract(JSON.stringify({ classSoughtLabel: "Class 99" }), classes), null, "unknown class alone → nothing");
console.log("OK — leadExtractAi.selftest.ts");
