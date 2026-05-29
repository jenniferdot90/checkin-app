export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return fail('JSON 解析失败'); }

  const { code, subscription } = body ?? {};
  if (!code || !subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return fail('参数不完整');
  }

  const now = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO push_subscriptions (code, endpoint, p256dh, auth, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET
      endpoint   = excluded.endpoint,
      p256dh     = excluded.p256dh,
      auth       = excluded.auth,
      updated_at = excluded.updated_at
  `).bind(code, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, now).run();

  return Response.json({ ok: true }, { headers: cors() });
}

export async function onRequestDelete({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return fail('JSON 解析失败'); }
  const { code } = body ?? {};
  if (!code) return fail('缺少 code');
  await env.DB.prepare('DELETE FROM push_subscriptions WHERE code = ?').bind(code).run();
  return Response.json({ ok: true }, { headers: cors() });
}

export async function onRequestOptions() {
  return new Response(null, { headers: cors() });
}

function fail(msg) {
  return Response.json({ ok: false, error: msg }, { status: 400, headers: cors() });
}

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
