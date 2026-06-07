// firebase-messaging-sw.js
// Bu dosya uygulamanın kök dizininde (pelustakip.html ile aynı klasörde) olmalıdır.

importScripts("https://www.gstatic.com/firebasejs/10.12.4/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.4/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey:            "AIzaSyBu3fMWUupz6EIbRyB4FBOfplF7GFDToMc",
  authDomain:        "pelustakip-3be95.firebaseapp.com",
  projectId:         "pelustakip-3be95",
  storageBucket:     "pelustakip-3be95.firebasestorage.app",
  messagingSenderId: "1080638886274",
  appId:             "1:1080638886274:web:ccc5ca53699e4d0fa53f9b"
});

const messaging = firebase.messaging();

// Uygulama kapalıyken / arka plandayken gelen bildirimleri göster
messaging.onBackgroundMessage(payload => {
  const { title = "Pelus Takip 🐾", body = "Yeni bir paylaşım var!" } = payload.notification || {};
  self.registration.showNotification(title, {
    body,
    icon: "./icon-192.png",
    badge: "./icon-192.png",
    tag: "pelus-pub",
    renotify: true,
    data: payload.data || {},
  });
});

// Bildirime tıklanınca uygulamayı aç / öne getir
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url.includes("pelustakip") && "focus" in c) return c.focus();
      }
      return clients.openWindow("./");
    })
  );
});
