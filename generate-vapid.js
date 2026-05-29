// 运行一次：node generate-vapid.js
const { webcrypto } = require('crypto');
const { subtle } = webcrypto;

async function main() {
  const kp = await subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );
  const privJwk = await subtle.exportKey('jwk', kp.privateKey);
  const pubRaw  = Buffer.from(await subtle.exportKey('raw', kp.publicKey));

  console.log('\n─── VAPID_PUBLIC_KEY（前端 applicationServerKey 用）───');
  console.log(pubRaw.toString('base64url'));
  console.log('\n─── VAPID_PRIVATE_KEY（存 wrangler secret，JWK JSON）───');
  console.log(JSON.stringify(privJwk));
  console.log('\n');
}
main().catch(console.error);
