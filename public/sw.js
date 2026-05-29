const CACHE = 'checkin-v1';
const PRECACHE = ['/', '/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE && k !== 'checkin-user' && k !== 'checkin-notif')
        .map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/')) return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      const net = fetch(e.request).then(res => {
        if (res.ok && e.request.method === 'GET') {
          caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        }
        return res;
      }).catch(() => cached);
      return cached || net;
    })
  );
});

// 主页面通过 postMessage 保存用户编号，供后台唤醒时读取
self.addEventListener('message', e => {
  if (e.data?.type === 'SAVE_CODE') {
    e.waitUntil(
      caches.open('checkin-user')
        .then(c => c.put('/_code', new Response(e.data.code || '')))
    );
  }
});

// Periodic Background Sync：后台定期检查（不依赖 FCM）
self.addEventListener('periodicsync', e => {
  if (e.tag === 'checkin-check') {
    e.waitUntil(checkAndNotify());
  }
});

async function checkAndNotify() {
  // 读取用户编号
  const uc = await caches.open('checkin-user');
  const codeRes = await uc.match('/_code');
  if (!codeRes) return;
  const code = (await codeRes.text()).trim();
  if (!code) return;

  // 北京时间
  const now  = new Date();
  const utc8 = new Date(now.getTime() + 8 * 3600 * 1000);
  const h = utc8.getUTCHours(), m = utc8.getUTCMinutes();
  const mins = h * 60 + m;

  // 仅在提醒窗口内触发（09:10–09:30 / 21:40–22:00 北京时间）
  const isMorning = mins >= 9 * 60 + 10 && mins < 9 * 60 + 30;
  const isEvening = mins >= 21 * 60 + 40 && mins < 22 * 60;
  if (!isMorning && !isEvening) return;

  const period = isMorning ? 'morning' : 'evening';

  // 拉取打卡状态
  let data;
  try {
    const res = await fetch('/api/status');
    if (!res.ok) return;
    data = await res.json();
  } catch { return; }

  const mine      = data.status_list?.find(r => r.code === code);
  const timeField = period === 'morning' ? 'morning_time' : 'evening_time';
  if (mine?.[timeField]) return; // 已打卡，不提醒

  // 去重：同天同时段只提醒一次
  const dedupKey = `/_n_${data.date}_${code}_${period}`;
  const nc = await caches.open('checkin-notif');
  if (await nc.match(dedupKey)) return;

  const label    = period === 'morning' ? '上午' : '晚上';
  const deadline = period === 'morning' ? '09:30' : '22:00';

  await self.registration.showNotification('⏰ 打卡提醒', {
    body:     `${label}打卡还有不到 20 分钟截止（${deadline}），你（编号 ${code}）还没打卡`,
    icon:     '/icons/icon-192.png',
    badge:    '/icons/icon-192.png',
    tag:      `checkin-${period}`,
    renotify: true,
    data:     { url: '/' },
  });

  await nc.put(dedupKey, new Response('1'));
}

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = e.notification.data?.url || '/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (new URL(c.url).pathname === target && 'focus' in c) return c.focus();
      }
      return self.clients.openWindow(target);
    })
  );
});
