/* ─────────────────────────────────────────────
   firebase-messaging-sw.js
   BU DOSYAYI index.html İLE AYNI KÖKE (root) KOY.
   Örn: https://senin-siten.com/firebase-messaging-sw.js
   Uygulama kapalıyken/arka plandayken push'u gösteren ve
   tıklamayı doğru sayfaya yönlendiren worker budur.
   ───────────────────────────────────────────── */
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

const messaging = firebase.messaging();

/* Sunucu data-only mesaj yolluyor → gösterimi biz yapıyoruz (çift bildirim olmaz) */
messaging.onBackgroundMessage(payload => {
  const d = payload.data || {};
  const title = d.title || "Pelüş Takip 🐾";
  const options = {
    body:  d.body || "",
    icon:  d.icon && d.icon.startsWith("http") ? d.icon : "/icon-192.png",
    badge: "/icon-192.png",
    tag:   d.tag || "pelus",
    renotify: d.type === "call",        // arama tekrar tekrar bildirilebilsin
    requireInteraction: d.type === "call",
    vibrate: d.type === "call" ? [200,100,200,100,200] : [80,40,80],
    data: d,
  };
  return self.registration.showNotification(title, options);
});

/* Bildirime tıklayınca: açık sekme varsa ona odaklan + uygulamaya mesaj at,
   yoksa uygun URL ile yeni pencere aç. Uygulama SW_NOTIF_CLICK'i dinliyor. */
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const d = event.notification.data || {};

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
