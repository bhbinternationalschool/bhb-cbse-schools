/* BHB School PWAs — parent, staff ERP, field (offline shell). */

const CACHE = "bhb-school-pwa-v4";
const SHELL = [
  "/login",
  "/parent",
  "/home",
  "/field",
  "/logo.png",
  "/logo-crest.png",
  "/favicon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL).catch(() => undefined)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

function isAppShellPath(pathname) {
  return (
    pathname === "/login" ||
    pathname === "/parent" ||
    pathname.startsWith("/parent/") ||
    pathname === "/home" ||
    pathname.startsWith("/home/") ||
    pathname === "/field" ||
    pathname.startsWith("/field/") ||
    /^\/(fees|admissions|attendance|homework|students|staff|comms|reports|masters|transport|payroll|purchase|accounts|timetable|ptm|notices|news|gallery|modules|vault|trust|rte|certificates|store|student-leave|exams)(\/|$)/.test(
      pathname,
    )
  );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  const isStatic =
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.match(/\.(png|jpg|svg|ico|woff2?)$/);
  const isShell = isAppShellPath(url.pathname);

  if (!isShell && !isStatic) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && (isShell || isStatic)) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((r) => {
          if (r) return r;
          if (url.pathname.startsWith("/field")) return caches.match("/field");
          if (url.pathname.startsWith("/parent")) return caches.match("/parent");
          return caches.match("/home") || caches.match("/login");
        }),
      ),
  );
});

self.addEventListener("push", (event) => {
  let payload = { title: "BHB International School", body: "" };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    /* ignore malformed payload */
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: payload.url || "/parent" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/parent";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.includes(url) && "focus" in client) return client.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
