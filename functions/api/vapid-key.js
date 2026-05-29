export async function onRequestGet({ env }) {
  const key = env.VAPID_PUBLIC_KEY;
  if (!key) return new Response('VAPID not configured', { status: 500 });
  return Response.json({ publicKey: key }, {
    headers: { 'Cache-Control': 'public, max-age=86400', 'Access-Control-Allow-Origin': '*' },
  });
}
