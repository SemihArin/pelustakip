/* ─────────────────────────────────────────────
   firebase-messaging-sw.js  —  BAĞIMSIZ push + önbellek worker
   SW_VERSION: v1.3.2

   • firebase kütüphanesi YOK, importScripts YOK → gstatic/DNS riski yok
   • DATA-ONLY push'u DOĞRUDAN işler (titreşim, ses, Cevapla/Reddet)
   • APP-SHELL ÖNBELLEĞİ: yalnızca KENDİ origin'i önbellekler
     (Firebase/Firestore/RTDB istekleri ASLA önbileklenmez → veri taze kalır)
   • BU DOSYA index.html ile AYNI KÖKE konur (PWA'nın yayınlandığı adres)
   ───────────────────────────────────────────── */

const SW_VERSION = "v1.3.2";
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

/* ── Push geldiğinde bildirimi GÖSTER ──
   • event.data SENKRON okunur (lifecycle bitince geçersizleşir)
   • Aynı tag'deki push'lar sıraya alınır (biriktirme yarışını çözer)
   • Farklı tag'ler paralel işlenir (tıkanmaz)
   • Arama → benzersiz tag, biriktirilmez, etkileşim ister
─────────────────────────────────────────── */
const _pushLocks = new Map();
self.addEventListener("push", event => {
  // SENKRON: event.data'yı şimdi oku — gecikirse geçersizleşir
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; }
  catch (e) {
    try { payload = { data: { body: event.data.text() } }; } catch (_) {}
  }

  const d = payload.data || {};
  const tag = d.tag || (payload.notification && payload.notification.tag) || d.type || "pelus";

  // Aynı tag'de sıraya al; farklı tag'ler birbirini beklemez
  const prev = _pushLocks.get(tag) || Promise.resolve();
  const work = prev.then(() => handlePush(payload, tag)).catch(err => {
    console.error("[SW push] hata:", err && err.message);
  });
  _pushLocks.set(tag, work);
  // İş bittiğinde kilidi temizle (bellek sızıntısı olmasın)
  work.finally(() => { if (_pushLocks.get(tag) === work) _pushLocks.delete(tag); });

  event.waitUntil(work);
});

async function handlePush(payload, tag) {
  const n = payload.notification || {};
  const d = payload.data || {};
  const link =
       (payload.fcmOptions && payload.fcmOptions.link) ||
       (payload.fcm_options && payload.fcm_options.link) ||
       d.link || "/";
  const isCall = (d.type === "call") || (tag && tag.indexOf("call") === 0);
  const icon   = d.icon || n.icon || "/icon-192.png";

  // ── ARAMA: benzersiz, biriktirilmez ──
  if (isCall) {
    await self.registration.showNotification("📞 Gelen Arama", {
      body: (d.fromName || "Biri") + " seni arıyor…",
      icon, badge: "/icon-192.png", tag,
      renotify: true, requireInteraction: true, silent: false,
      vibrate: [500, 250, 500, 250, 500, 250, 500, 250, 500],
      data: { ...d, link, isCall: true },
      actions: [ { action: "accept", title: "📞 Cevapla" }, { action: "reject", title: "Reddet" } ],
    });
    return;
  }

  // ── DİĞER: aynı tag'de BİRİKTİR ──
  const fromName = d.fromName || "";
  const newText  = ((d.body || n.body || "") + "").trim() || "Yeni bildirim";

  // Aynı tag'deki mevcut bildirimi oku → önceki satırları devral
  let lines = [];
  try {
    const existing = await self.registration.getNotifications({ tag });
    for (const e of existing) {
      const el = (e.data && Array.isArray(e.data.lines)) ? e.data.lines : null;
      if (el && el.length) lines = lines.concat(el);
      else if (e.body)     lines.push(e.body);   // eski tek-satır bildirimden devral
    }
  } catch (e) {}

  lines.push(newText);

  // Aşırı uzamasın: son 8 satır, fazlası özetlenir
  const MAX = 8;
  let extra = 0, shown = lines;
  if (lines.length > MAX) { extra = lines.length - MAX; shown = lines.slice(-MAX); }
  const count = lines.length;

  const body = count > 1
    ? (extra ? `…ve ${extra} tane daha\n` : "") + shown.map(l => "• " + l).join("\n")
    : shown[0];

  let title;
  if (d.type === "message") title = `💬 ${fromName || "Mesaj"}` + (count > 1 ? ` · ${count} mesaj` : "");
  else                      title = (d.title || n.title || "Pelüş Takip 🐾") + (count > 1 ? ` · ${count}` : "");

  await self.registration.showNotification(title, {
    body, icon, badge: "/icon-192.png", tag,
    renotify: true, silent: false,
    vibrate: [120, 60, 120],
    data: { ...d, link, lines },   // biriken satırları sakla → sonraki push üstüne ekler
  });
}

/* ── Bildirime / aksiyona tıklayınca ── */
self.addEventListener("notificationclick", event => {
  const action = event.action;
  const d = event.notification.data || {};
  const tag = event.notification.tag || "";
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
    // Aynı kategorideki diğer bildirimleri (varsa) de temizle — sohbet açılınca
    // bildirim çubuğunda eski satırlar kalmasın
    try {
      const same = await self.registration.getNotifications({ tag });
      same.forEach(nt => { try { nt.close(); } catch (e) {} });
    } catch (e) {}

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

/* ── İstemciden gelen mesajlar (bildirim temizleme) ──
   Uygulama öne geldiğinde veya bir sohbete girildiğinde SW'ye haber verir,
   SW bildirim çubuğundaki ilgili bildirimleri kapatır. Aksi halde okunmuş
   bildirimler orada kalır ve "spam gibi" görünür. */
self.addEventListener("message", event => {
  const msg = event.data || {};
  if (msg.type === "CLEAR_NON_CALL_NOTIFICATIONS") {
    event.waitUntil((async () => {
      try {
        const all = await self.registration.getNotifications();
        for (const n of all) {
          const t = (n.tag || "");
          if (t.indexOf("call") === 0) continue;          // aramaları KAPATMA
          if (n.data && n.data.isCall) continue;
          try { n.close(); } catch (e) {}
        }
      } catch (e) {}
    })());
  } else if (msg.type === "CLEAR_NOTIFICATIONS_FOR_CHAT") {
    const fromUid = msg.fromUid || "";
    if (!fromUid) return;
    event.waitUntil((async () => {
      try {
        // mesaj bildirim tag'i sunucuda "msg:{fromUid}" formatında
        const list = await self.registration.getNotifications({ tag: "msg:" + fromUid });
        list.forEach(n => { try { n.close(); } catch (e) {} });
      } catch (e) {}
    })());
  } else if (msg.type === "CLEAR_NOTIFICATIONS_BY_TAG") {
    const tag = msg.tag || "";
    if (!tag) return;
    event.waitUntil((async () => {
      try {
        const list = await self.registration.getNotifications({ tag });
        list.forEach(n => { try { n.close(); } catch (e) {} });
      } catch (e) {}
    })());
  }
});
