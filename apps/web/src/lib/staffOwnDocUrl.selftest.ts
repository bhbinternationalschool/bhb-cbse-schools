/**
 * The own-document reference rule (POST /api/v1/staff/me/docs). Run:
 *   npm run test:staff-own-doc-url
 */
import assert from "node:assert/strict";
import { ownStaffDocUrlRefusal, ownStaffMediaFolder } from "./staffOwnDocUrl";

const me = { staffId: "stf_7", empCode: "BHB 007", docKey: "photo" };
const ok = (url: string, who = me) => assert.equal(ownStaffDocUrlRefusal(url, who), null, `should accept ${url}`);
const no = (url: string, who = me) => assert.notEqual(ownStaffDocUrlRefusal(url, who), null, `should refuse ${url}`);

// The two upload paths the school hands back, for this member and this document.
ok("/api/documents/staff/stf_7/photo");
ok(`/api/file/staff/${ownStaffMediaFolder("stf_7", "BHB 007")}/photo-1730000000000.jpg`);
assert.equal(ownStaffMediaFolder("stf_7", "BHB 007"), "BHB_007");
assert.equal(ownStaffMediaFolder("stf_7", ""), "stf_7");
ok("/api/file/staff/stf_7/photo-1.png", { staffId: "stf_7", empCode: "", docKey: "photo" });
ok("/api/documents/staff/stf_7/aadhaar", { ...me, docKey: "aadhaar" });

// External or odd references — the review's finding.
no("https://evil.example/pixel.png");
no("http://127.0.0.1/api/documents/staff/stf_7/photo");
no("//evil.example/api/documents/staff/stf_7/photo");
no("javascript:alert(1)");
no("data:image/png;base64,AAAA");
no("blob:https://x/1");
no("");
// Not this member, not this document.
no("/api/documents/staff/stf_8/photo");
no("/api/documents/staff/stf_7/aadhaar");
no("/api/documents/student/stf_7/photo");
no("/api/file/staff/BHB_008/photo-1.jpg");
no("/api/file/students/BHB_007/photo-1.jpg");
no("/api/file/staff/BHB_007/");
no("/api/file/staff/BHB_007/sub/photo.jpg");
// Tricks on an otherwise-own path.
no("/api/documents/staff/stf_7/photo?x=https://evil.example");
no("/api/documents/staff/stf_7/photo#x");
no("/api/file/staff/BHB_007/../BHB_008/photo.jpg");
no("/api/file/staff/BHB_007/%2e%2e%2fphoto.jpg");
no("/api/file/staff/BHB_007\\photo.jpg");
no("/api/file/staff/BHB_007/photo .jpg");
no("/api/file/staff/BHB_007/.hidden");
// Nothing to match against.
no("/api/documents/staff/stf_7/photo", { staffId: "", empCode: "", docKey: "photo" });

console.log("staffOwnDocUrl selftest: ok");
