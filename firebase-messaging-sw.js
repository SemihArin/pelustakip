/* ─────────────────────────────────────────────
   firebase-messaging-sw.js  —  BAĞIMSIZ push + önbellek worker
   SW_VERSION: v1.2.0

   • firebase kütüphanesi YOK, importScripts YOK → gstatic/DNS riski yok
   • DATA-ONLY push'u DOĞRUDAN işler (titreşim, ses, Cevapla/Reddet)
   • APP-SHELL ÖNBELLEĞİ: yalnızca KENDİ origin'i önbellekler
     (Firebase/Firestore/RTDB istekleri ASLA önbileklenmez → veri taze kalır)
   • BU DOSYA index.html ile AYNI KÖKE konur (PWA'nın yayınlandığı adres)
   ───────────────────────────────────────────── */

const SW_VERSION = "v1.2.0";
const CACHE = "pelus-shell-" + SW_VERSION;
const SHELL = ["/", "/index.html", "/icon-192.png", "/icon-512.png", "/manifest.json"];

self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // Tek tek ekle — biri 404 olsa bile diğerleri önbileklensin
    for (const u of SHELL) { try { await c.add(u); } catch (e) {} }
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(k => k.startsWith("pelus-shell-") && k !== CACHE).map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

/* ── Önbellek stratejileri ── */

// Navigasyon (index.html): AĞ ÖNCE ama 2.5sn'de gelmezse önbellekten anında ver
// (arka planda ağ tamamlanınca önbellek tazelenir). İyi bağlantıda hep taze.
async function navHandler(req) {
  const cache = await caches.open(CACHE);
  const netPromise = fetch(req)
    .then(res => { if (res && res.ok) cache.put(req, res.clone()); return res; })
    .catch(() => null);
  const timeout = new Promise(res => setTimeout(() => res("TIMEOUT"), 2500));
  const winner = await Promise.race([netPromise, timeout]);
  if (winner && winner !== "TIMEOUT") return winner;          // ağ zamanında geldi → taze
  const cached = (await cache.match(req)) || (await cache.match("/")) || (await cache.match("/index.html"));
  if (cached) return cached;                                  // hızlı: önbellek (ağ arka planda tazeler)
  return (await netPromise) || fetch(req);                    // önbellek yoksa ağı bekle
}

// Statik dosyalar (ikon, manifest, font…): ÖNBELLEK ÖNCE + arka planda tazele
async function assetHandler(req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  if (cached) {
    fetch(req).then(res => { if (res && res.ok) cache.put(req, res.clone()); }).catch(() => {});
    return cached;
  }
  try {
    const net = await fetch(req);
    if (net && net.ok) cache.put(req, net.clone());
    return net;
  } catch (e) {
    return cached || Response.error();
  }
}

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }

  // SADECE kendi origin'imiz — Firebase/Firestore/RTDB/gstatic'e ASLA dokunma
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate") { event.respondWith(navHandler(req)); return; }

  if (/\.(?:png|jpe?g|svg|webp|gif|ico|woff2?|ttf|otf|css|js|json)$/i.test(url.pathname)) {
    event.respondWith(assetHandler(req));
  }
});

/* ── Push geldiğinde bildirimi GÖSTER ── */
self.addEventListener("push", event => {
  let p = {};
  try { p = event.data ? event.data.json() : {}; }
  catch { try { p = { data: { body: event.data.text() } }; } catch (e) {} }

  const n = p.notification || {};
  const d = p.data || {};
  const link =
       (p.fcmOptions && p.fcmOptions.link) ||
       (p.fcm_options && p.fcm_options.link) ||
       d.link || "/";
  const tag    = d.tag || n.tag || "pelus";
  const isCall = (d.type === "call") || tag.indexOf("call") === 0;

  const title = isCall ? "📞 Gelen Arama" : (d.title || n.title || "Pelüş Takip 🐾");
  const body  = isCall ? ((d.fromName || "Biri") + " seni arıyor…") : (d.body || n.body || "");

  const opts = {
    body,
    icon:  d.icon || n.icon || "/icon-192.png",
    badge: "/icon-192.png",
    tag,
    renotify: true,
    requireInteraction: isCall,
    silent: false,
    vibrate: isCall ? [500, 250, 500, 250, 500, 250, 500, 250, 500] : [120, 60, 120],
    data: { ...d, link, isCall },
    ...(isCall ? { actions: [ { action: "accept", title: "📞 Cevapla" }, { action: "reject", title: "Reddet" } ] } : {}),
  };
  event.waitUntil(self.registration.showNotification(title, opts));
});

/* ── Bildirime / aksiyona tıklayınca ── */
self.addEventListener("notificationclick", event => {
  const action = event.action;
  const d = event.notification.data || {};
  event.notification.close();

  if (action === "reject") {
    event.waitUntil((async () => {
      const all = await clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of all) { try { c.postMessage({ type: "SW_CALL_REJECT", data: d }); } catch (e) {} }
    })());
    return;
  }

  const link = d.link || (d.callId ? "/?call=" + encodeURIComponent(d.callId)
                       : d.pubId ? "/?openPub=" + encodeURIComponent(d.pubId) : "/");
  event.waitUntil((async () => {
    const all = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) {
      if ("focus" in c) {
        try { c.postMessage({ type: "SW_NOTIF_CLICK", data: { ...d, action: action || "open" } }); } catch (e) {}
        return c.focus();
      }
    }
    return clients.openWindow(link);
  })());
});
