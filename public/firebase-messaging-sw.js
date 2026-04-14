// firebase-messaging-sw.js
// public/ ディレクトリに配置すること

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

// ★ FIREBASE_CONFIG と同じ値を設定
firebase.initializeApp({
  apiKey:            "AIzaSyAJl87Z7mQNHCAJJ11HQC4BiJltF1ddUzk",
  authDomain:        "kouki-e7805.firebaseapp.com",
  projectId:         "kouki-e7805",
  storageBucket:     "kouki-e7805.firebasestorage.app",
  messagingSenderId: "63552823591",
  appId:             "1:63552823591:web:34d1ac8b7d5c72ba744902"
});

const messaging = firebase.messaging();

// バックグラウンド（画面を閉じているとき）のPush通知受信
messaging.onBackgroundMessage(payload => {
  const { title, body } = payload.notification || {};
  const { tenantId, caseId } = payload.data || {};

  self.registration.showNotification(title || '🔔 呼び出し', {
    body:    body  || '新しい呼び出しがあります',
    icon:    '/icon-192.png',
    badge:   '/badge-72.png',
    tag:     caseId || 'andon-call',   // 同じcaseIdの通知は上書き
    data:    { tenantId, caseId },
    actions: [
      { action: 'open', title: '確認する' }
    ]
  });
});

// 通知タップ時の動作
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const { tenantId, caseId } = event.notification.data || {};
  const url = tenantId
    ? `/?tenant=${tenantId}&mode=mobile`
    : '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      // 既に開いているウィンドウがあればフォーカス
      for (const client of list) {
        if (client.url.includes(tenantId) && 'focus' in client) {
          return client.focus();
        }
      }
      // なければ新しいウィンドウを開く
      return clients.openWindow(url);
    })
  );
});
