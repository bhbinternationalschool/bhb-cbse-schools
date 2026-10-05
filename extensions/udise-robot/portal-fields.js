// The only fields of a portal student record the robot ever sends to the ERP.
// Kept in step with UDISE_PORTAL_FIELDS in apps/web/src/lib/udisePortalApi.ts
// (the server re-applies its own copy, so a drift here can only send less).
// eslint-disable-next-line no-unused-vars
const UDISE_PORTAL_FIELDS = [
  "studentId", "studentName", "gender", "dob", "classId", "classDesc", "sectionDesc",
  "studentCodeNat", "studentCodeState", "fatherName", "motherName", "guardianName",
  "socCatId", "minorityId", "isBplYN", "aayBplYN", "ewsYN", "cwsnYN", "natIndYN",
  "ooscYN", "isRepeater", "disabilityCerti", "impairmentPercent", "formStatus", "uuid",
  "nameAsUuid", "uuidStatus", "uuidStatusDesc", "apaarId", "apaarIdStatusDesc",
  "mbuStatusDesc", "primaryMobile", "secondaryMobile", "email", "address", "pincode",
  "motherTongueDesc", "bloodGroup", "admnNumber",
];
