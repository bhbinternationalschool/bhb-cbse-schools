# Google Drive for document storage — Plan

**Goal:** documents (student docs, staff docs — students and staff first)
stored in Google Drive; Postgres holds only the record — file id, name,
mime type, status, timestamps — never the file bytes.

**Method:** grounded in reading the actual upload code path and the real
database, not the app's intended behavior. The two disagree.

---

## 1. What's actually true today

**Document uploads are very likely not surviving past the browser that
made them.** `StudentDocUpload.tsx` reads a selected file via
`FileReader.readAsDataURL()` — a base64 string, client-side, no
compression. When that syncs to the server, `stripHeavyUrls()` truncates
anything over **8,000 characters to an empty string** before it reaches
the database. A real photo or PDF almost always exceeds that.

Checked against the real database rather than left as a hypothesis:

```
sis_students  — every document type, every one of 719 students:
                 marked "received"/"verified": 0
sis_staff     — every document type, every staff member:
                 marked "received"/"verified": 0
```

Not one document, of any kind, for any person, has ever been recorded as
received. This is consistent with "nobody has tried yet," but the code
path is confirmed broken above a trivial thumbnail size regardless, and
it explains the data exactly.

**One consequence that simplifies this plan:** there is nothing to
migrate. Students and staff currently hold zero real document content —
Phase 3 below has no backfill step because there is nothing to back fill.

**Existing, reusable OAuth machinery:** `lib/googleOAuth.server.ts` —
token exchange, refresh, and the auth-URL builder, built for the
Classroom integration but implemented as plain REST calls, not
Classroom-specific in mechanism. Only `GOOGLE_CLASSROOM_SCOPES` is
Classroom-specific. Reusable directly for Drive with a different scope
constant.

**A second, unrelated thing found while reading that code, worth
flagging plainly:** Classroom's OAuth tokens are stored in
`.data/google_classroom.json` — local disk. Checked: Cloud Run's
filesystem is ephemeral, and this exact gotcha was called out in a
comment elsewhere in the codebase for a different feature. Very likely
means Classroom sync's connection doesn't survive a deploy or an idle
instance recycling. Not this plan's job to fix — noted because it directly
informs a decision below: Drive's connection must NOT use the same
disk-based store.

---

## 2. Decisions already confirmed

1. **One admin authorizes once**, via the existing OAuth flow pattern —
   not a per-staff connection, not a service-account/domain-delegation
   setup. Simplest to stand up today; the tradeoff (re-authorizing if
   that person's access changes) was stated and accepted.
2. **Students and staff first** — the two modules the finding above is
   confirmed against. Admissions, library, purchase, etc. are explicitly
   out of scope for this pass.

---

## 3. Architecture

```
Upload:   browser → POST file → server → Drive API → { driveFileId }
                                              ↓
                                     Postgres stores only:
                                     driveFileId, fileName, mimeType,
                                     size, status, uploadedAt, ...

View:     browser → GET /api/documents/{driveFileId}
                          ↓ (RBAC check against the SAME rules
                             already gating student/staff doc access)
                     server fetches from Drive using the stored
                     connection's token, streams bytes back
```

**Drive files are never shared/public.** The app's own RBAC is the
enforcement layer — a browser never gets a direct Drive link, only an
app-internal URL the server checks before proxying the fetch.

**Scope:** `drive.file` — restricted to files this app creates. Not the
broad `drive` scope, which would ask for access to the connected
account's entire Drive. Minimum privilege for what this actually needs.

**Folder layout:** one root folder for the tenant, with `students/` and
`staff/` subfolders, one file per document per person — e.g.
`students/{studentId}/{docKey}.{ext}`.

**Token storage:** a Supabase table, not disk — `google_drive_connection`
(tenant-scoped, one row: refresh token, connected-by, connected-at).
Matches the durable pattern every other credential in this session's work
has used; deliberately not the Classroom store's disk-based pattern given
the finding above.

---

## 4. Phases

### Phase 0 — OAuth connect, verified structurally

- `GOOGLE_DRIVE_SCOPES` constant (`drive.file`), added alongside the
  existing Classroom scopes in `googleOAuth.server.ts` — reused, not
  duplicated.
- New Supabase table for the connection (migration, reviewed file,
  applied via the migration tool — not ad hoc).
- `/api/integrations/google/drive/connect` (redirects to Google's
  consent screen) and `/callback` (exchanges the code, stores the
  refresh token).
- This phase's real-world completion needs a human: only the admin can
  actually click through Google's consent screen. I can build and verify
  the routes are correct; I cannot complete the OAuth handshake myself.

### Phase 1 — Core Drive library

- `lib/googleDrive.server.ts`: `uploadFileToDrive`, `getDriveFile`
  (metadata + content stream), `deleteDriveFile`. Token refresh handled
  the same way `googleClassroom.server.ts` already does it.

### Phase 2 — Schema

- `StudentDocFile` / staff's equivalent gain a `driveFileId` field.
  `fileUrl` becomes an app-internal proxy URL
  (`/api/documents/{driveFileId}`), not a raw Drive link and not a data
  URL — existing UI code that renders `<img src={doc.fileUrl}>` keeps
  working unchanged, since it is still just a URL.

### Phase 3 — Upload + serve routes

- Upload route: accepts the file server-side (multipart), pushes to
  Drive, returns the record fields the client stores.
- Serve route: RBAC-checked proxy fetch from Drive.
- No migration step — confirmed nothing exists to migrate (Section 1).

### Phase 4 — Client upload flow

- `StudentDocUpload.tsx` (and the staff equivalent) stop reading the file
  locally via `FileReader`; they POST to the Phase 3 upload route and
  store the returned metadata instead of a base64 string.

Each phase gets verified before the next starts, the same discipline as
every other phase-gated change this session — dry run before a real data
touch, tsc/eslint/build before commit, real reads/writes checked against
actual data rather than assumed.
