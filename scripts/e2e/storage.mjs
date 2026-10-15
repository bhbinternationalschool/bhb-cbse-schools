/**
 * Supabase Storage, as far as the e2e stack needs it (15 Oct 2026).
 *
 * The gallery's paths go through Storage: the web ERP's /api/upload puts a
 * file in a bucket, the staff app PUTs a photo to a signed upload URL, the
 * server lists the folder to confirm it arrived, signs a ten-minute read
 * link, and the AI check streams the file back. Without Storage none of that
 * can be proved on the stack, so this answers the storage-js calls the app
 * makes, in memory, for the three buckets production has (with production's
 * privacy: only site-media is public).
 *
 *   POST   /object/<bucket>/<path>                upload (service key)
 *   POST   /object/upload/sign/<bucket>/<path>    signed upload URL (service key)
 *   PUT    /object/upload/sign/<bucket>/<path>?token=…   upload with it (no key)
 *   POST   /object/sign/<bucket>/<path>           signed read link (service key)
 *   GET    /object/sign/<bucket>/<path>?token=…   read with it (no key)
 *   GET    /object/[authenticated/]<bucket>/<path>  download (service key)
 *   GET    /object/public/<bucket>/<path>         public bucket only (no key)
 *   POST   /object/list/<bucket>                  { prefix, search, limit }
 *   DELETE /object/<bucket>                       { prefixes: [...] }
 *
 * Tokens are random per signing and checked; nothing is persisted — the
 * files go with the proxy process (e2e-stack.sh down).
 */
import { randomBytes } from "node:crypto";

const BUCKETS = {
  "class-gallery": { public: false, limit: 524288000 },
  "school-files": { public: false, limit: 20971520 },
  "site-media": { public: true, limit: 52428800 },
};

/** bucket/path → { body: Buffer, type, created } */
const files = new Map();
/** token → { key, kind: "upload" | "read", exp } */
const tokens = new Map();

const keyOf = (bucket, path) => `${bucket}/${path}`;

function send(res, status, body, headers = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "content-type": Buffer.isBuffer(body) ? headers["content-type"] || "application/octet-stream" : "application/json",
    "content-length": buf.length,
    "access-control-allow-origin": "*",
    ...headers,
  });
  res.end(buf);
}

const err = (res, status, error, message) => send(res, status, { statusCode: String(status), error, message });

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

/** The file out of a multipart/form-data body (storage-js sends FormData from Node). */
function fromMultipart(buf, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || "");
  if (!m) return null;
  const boundary = Buffer.from(`--${m[1] || m[2]}`);
  let at = buf.indexOf(boundary);
  while (at >= 0) {
    const next = buf.indexOf(boundary, at + boundary.length);
    if (next < 0) break;
    const part = buf.subarray(at + boundary.length + 2, next - 2);
    const sep = part.indexOf("\r\n\r\n");
    if (sep >= 0) {
      const head = part.subarray(0, sep).toString("utf8");
      if (/filename=/i.test(head) || /name="?\w*file/i.test(head) || /name=""/.test(head)) {
        const type = /content-type:\s*([^\r\n]+)/i.exec(head)?.[1]?.trim() || "application/octet-stream";
        return { body: part.subarray(sep + 4), type };
      }
    }
    at = next;
  }
  return null;
}

function isServiceCall(req, serviceKey) {
  const auth = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  return !!serviceKey && (auth === serviceKey || req.headers.apikey === serviceKey);
}

function split(rest) {
  const [bucket, ...p] = rest.split("/");
  return { bucket: decodeURIComponent(bucket || ""), path: p.map(decodeURIComponent).join("/") };
}

function newToken(key, kind, seconds) {
  const t = randomBytes(18).toString("base64url");
  tokens.set(t, { key, kind, exp: Date.now() + seconds * 1000 });
  return t;
}

function tokenOk(t, key, kind) {
  const v = tokens.get(t || "");
  return !!v && v.key === key && v.kind === kind && v.exp > Date.now();
}

async function store(req, res, bucket, path) {
  const rules = BUCKETS[bucket];
  const raw = await readBody(req);
  const ct = String(req.headers["content-type"] || "");
  const file = ct.startsWith("multipart/form-data") ? fromMultipart(raw, ct) : { body: raw, type: ct || "application/octet-stream" };
  if (!file) return err(res, 400, "InvalidRequest", "no file in the form");
  if (file.body.length > rules.limit) return err(res, 413, "Payload too large", "The object exceeded the maximum allowed size");
  const key = keyOf(bucket, path);
  if (files.has(key) && String(req.headers["x-upsert"] || "false") !== "true") {
    return err(res, 409, "Duplicate", "The resource already exists");
  }
  files.set(key, { body: file.body, type: file.type, created: new Date().toISOString() });
  return send(res, 200, { Key: key, Id: randomBytes(8).toString("hex"), path });
}

function serve(res, key) {
  const f = files.get(key);
  if (!f) return err(res, 404, "not_found", "Object not found");
  return send(res, 200, f.body, { "content-type": f.type, "cache-control": "no-store" });
}

/**
 * Handle one /storage/v1 request. `rest` is the path after /storage/v1,
 * `query` its URLSearchParams.
 */
export async function handleStorage(req, res, rest, query, serviceKey) {
  const service = isServiceCall(req, serviceKey);
  const m = req.method || "GET";
  const bucketOk = (b) => Object.prototype.hasOwnProperty.call(BUCKETS, b);

  // Signed upload: PUT with the token (the phone has no key).
  let r = /^\/object\/upload\/sign\/(.+)$/.exec(rest);
  if (r) {
    const { bucket, path } = split(r[1]);
    if (!bucketOk(bucket) || !path) return err(res, 404, "Bucket not found", "Bucket not found");
    const key = keyOf(bucket, path);
    if (m === "POST") {
      if (!service) return err(res, 403, "Unauthorized", "service key required");
      const t = newToken(key, "upload", 2 * 3600);
      return send(res, 200, { url: `/object/upload/sign/${encodeURIComponent(bucket)}/${path}?token=${t}`, token: t });
    }
    if (m === "PUT" || m === "POST") {
      if (!tokenOk(query.get("token"), key, "upload")) return err(res, 400, "InvalidJWT", "invalid or expired upload token");
      tokens.delete(query.get("token"));
      return store(req, res, bucket, path);
    }
  }

  // Signed read link.
  r = /^\/object\/sign\/(.+)$/.exec(rest);
  if (r) {
    const { bucket, path } = split(r[1]);
    if (!bucketOk(bucket) || !path) return err(res, 404, "Bucket not found", "Bucket not found");
    const key = keyOf(bucket, path);
    if (m === "POST") {
      if (!service) return err(res, 403, "Unauthorized", "service key required");
      if (!files.has(key)) return err(res, 404, "not_found", "Object not found");
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const t = newToken(key, "read", Number(body.expiresIn) || 60);
      return send(res, 200, { signedURL: `/object/sign/${encodeURIComponent(bucket)}/${path}?token=${t}` });
    }
    if (m === "GET" || m === "HEAD") {
      if (!tokenOk(query.get("token"), key, "read")) return err(res, 400, "InvalidJWT", "invalid or expired token");
      return serve(res, key);
    }
  }

  r = /^\/object\/list\/([^/]+)$/.exec(rest);
  if (r && m === "POST") {
    const bucket = decodeURIComponent(r[1]);
    if (!bucketOk(bucket)) return err(res, 404, "Bucket not found", "Bucket not found");
    if (!service) return err(res, 403, "Unauthorized", "service key required");
    const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
    const prefix = String(body.prefix || "").replace(/\/+$/, "");
    const search = String(body.search || "");
    const out = [];
    for (const [key, f] of files) {
      if (!key.startsWith(`${bucket}/${prefix ? `${prefix}/` : ""}`)) continue;
      const name = key.slice(bucket.length + 1 + (prefix ? prefix.length + 1 : 0));
      if (name.includes("/") || (search && !name.includes(search))) continue;
      out.push({ name, id: key, created_at: f.created, updated_at: f.created, metadata: { size: f.body.length, mimetype: f.type } });
    }
    return send(res, 200, out.slice(0, Number(body.limit) || 100));
  }

  r = /^\/object\/public\/(.+)$/.exec(rest);
  if (r && (m === "GET" || m === "HEAD")) {
    const { bucket, path } = split(r[1]);
    if (!bucketOk(bucket) || !BUCKETS[bucket].public) return err(res, 400, "not_found", "Bucket not found or not public");
    return serve(res, keyOf(bucket, path));
  }

  r = /^\/object\/(?:authenticated\/)?(.+)$/.exec(rest);
  if (r) {
    const { bucket, path } = split(r[1]);
    if (!bucketOk(bucket)) return err(res, 404, "Bucket not found", "Bucket not found");
    if (!service) return err(res, 403, "Unauthorized", "service key required");
    if (m === "DELETE" && !path) {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const gone = [];
      for (const p of body.prefixes || []) if (files.delete(keyOf(bucket, p))) gone.push({ name: p });
      return send(res, 200, gone);
    }
    if (!path) return err(res, 400, "InvalidRequest", "path required");
    if (m === "POST" || m === "PUT") return store(req, res, bucket, path);
    if (m === "GET" || m === "HEAD") return serve(res, keyOf(bucket, path));
  }

  return err(res, 404, "not_found", `the e2e storage does not serve ${m} ${rest}`);
}
