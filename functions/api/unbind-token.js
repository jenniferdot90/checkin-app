const CODES = [
  '864','332','486','748','862','065','943','292','431','995',
  '815','477','134','498','344','366','976','101','883','462','320'
];

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch {
    return Response.json({ ok: false, error: '请求格式错误' }, { status: 400, headers: cors() });
  }

  const { code } = body;

  if (!CODES.includes(code)) {
    return Response.json({ ok: false, error: '编号不合法' }, { status: 400, headers: cors() });
  }

  await env.DB.prepare(
    'UPDATE users SET pushplus_token = NULL WHERE code = ?'
  ).bind(code).run();

  return Response.json({ ok: true }, { headers: cors() });
}

export async function onRequestOptions() {
  return new Response(null, { headers: cors() });
}

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
  };
}
