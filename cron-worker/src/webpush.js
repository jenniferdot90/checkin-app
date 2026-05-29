// RFC 8291 (aes128gcm) + RFC 8292 (VAPID) — 纯 Web Crypto API，兼容 Cloudflare Workers

function b64u(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function unb64u(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}

function concat(...arrs) {
  const total = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
}

const enc = new TextEncoder();

async function hkdf(ikm, salt, info, len) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    key, len * 8
  ));
}

// ─── VAPID JWT ───────────────────────────────────────────────────────────────

async function vapidJWT(privJwk, audience, subject) {
  const privKey = await crypto.subtle.importKey(
    'jwk', typeof privJwk === 'string' ? JSON.parse(privJwk) : privJwk,
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']
  );
  const now = Math.floor(Date.now() / 1000);
  const header  = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = b64u(enc.encode(JSON.stringify({ aud: audience, exp: now + 43200, sub: subject })));
  const toSign  = `${header}.${payload}`;
  const sig     = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, privKey, enc.encode(toSign)
  );
  return `${toSign}.${b64u(sig)}`;
}

// ─── RFC 8291 aes128gcm 加密 ─────────────────────────────────────────────────

async function encrypt(subscription, plaintext) {
  const { p256dh, auth } = subscription.keys;

  // 客户端公钥
  const uaPub = await crypto.subtle.importKey(
    'raw', unb64u(p256dh),
    { name: 'ECDH', namedCurve: 'P-256' }, false, []
  );

  // 服务端临时 ECDH 密钥对
  const asKP = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']
  );
  const asPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', asKP.publicKey)); // 65 字节

  // ECDH 共享密钥
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'ECDH', public: uaPub }, asKP.privateKey, 256
  ));

  // 随机 salt
  const salt = crypto.getRandomValues(new Uint8Array(16));

  const authSecret = unb64u(auth);          // 16 字节
  const uaPubRaw   = unb64u(p256dh);        // 65 字节

  // PRK_key = HKDF(ecdhSecret, authSecret, "WebPush: info\0" + uaPub + asPub, 32)
  const keyInfo = concat(enc.encode('WebPush: info\0'), uaPubRaw, asPubRaw);
  const prkKey  = await hkdf(ecdhSecret, authSecret, keyInfo, 32);

  // CEK = HKDF(prkKey, salt, "Content-Encoding: aes128gcm\0", 16)
  const cek   = await hkdf(prkKey, salt, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  // Nonce = HKDF(prkKey, salt, "Content-Encoding: nonce\0", 12)
  const nonce = await hkdf(prkKey, salt, enc.encode('Content-Encoding: nonce\0'), 12);

  // 加密：plaintext + 0x02 (最后一条记录 delimiter)
  const padded = concat(enc.encode(plaintext), new Uint8Array([2]));
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce }, aesKey, padded
  ));

  // Header: salt(16) + rs(4,大端) + idlen(1) + asPub(65) = 86 字节
  const header = new Uint8Array(86);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096, false); // rs = 4096
  header[20] = 65;
  header.set(asPubRaw, 21);

  return concat(header, ciphertext);
}

// ─── 发送单条推送 ─────────────────────────────────────────────────────────────

export async function sendPush(subscription, payloadObj, { privateKeyJwk, publicKeyB64u, subject }) {
  const { endpoint } = subscription;
  const origin = new URL(endpoint).origin;

  const jwt  = await vapidJWT(privateKeyJwk, origin, subject);
  const body = await encrypt(subscription, JSON.stringify(payloadObj));

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type':     'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'Authorization':    `vapid t=${jwt},k=${publicKeyB64u}`,
      'TTL':              '86400',
    },
    body,
  });

  return res;
}
