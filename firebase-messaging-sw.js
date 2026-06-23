/* ─────────────────────────────────────────────
   firebase-messaging-sw.js
   BU DOSYAYI index.html ILE AYNI KOKE (root) KOY.
   Orn: https://senin-siten.com/firebase-messaging-sw.js
   (Tarayicida bu adresi acinca JS gorunmeli, 404 OLMAMALI.)

   Sunucu webpush.notification yolluyor → FCM SDK arka planda
   bildirimi OTOMATIK gosterir. Burada onBackgroundMessage YOK
   (olsaydi cift bildirim olurdu). Sadece tiklama yonlendirmesi var.
   ───────────────────────────────────────────── */

/* 1) notificationclick'i FCM importlarindan ONCE tanimla
      (yoksa FCM kendi davranisini uzerine yazabilir) */
// SW_VERSION: v1.0.8  (bunu her degisiklikte artir → tum cihazlar guncellenir)
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const raw = event.notification.data || {};
  const d = raw.FCM_MSG?.data || raw.data || raw || {};

  event.waitUntil((async () => {
    const all = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) {
      if ("focus" in c) {
        try { c.postMessage({ type: "SW_NOTIF_CLICK", data: d }); } catch (e) {}
        return c.focus();
      }
    }
    let url = "/";
    if (d.pubId) url = "/?openPub=" + encodeURIComponent(d.pubId);
    return clients.openWindow(url);
  })());
});

/* 2) Yeni SW'yi aninda devreye al (guncellemeler beklemesin) */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

/* 3) Firebase messaging'i baslat → arka plan bildirimi otomatik gosterilir */
importScripts("https://www.gstatic.com/firebasejs/10.12.4/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.4/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey:            "AIzaSyBu3fMWUupz6EIbRyB4FBOfplF7GFDToMc",
  authDomain:        "pelustakip-3be95.firebaseapp.com",
  projectId:         "pelustakip-3be95",
  storageBucket:     "pelustakip-3be95.firebasestorage.app",
  messagingSenderId: "1080638886274",
  appId:             "1:1080638886274:web:ccc5ca53699e4d0fa53f9b",
});

firebase.messaging(); // onBackgroundMessage YOK — notification payload otomatik gosterilir
