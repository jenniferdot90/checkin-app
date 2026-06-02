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

  const row = await env.DB.prepare(
    'SELECT pushplus_token FROM users WHERE code = ?'
  ).bind(code).first();

  // 只返回是否已绑定，不回显 Token 内容
  return Response.json({ ok: true, bound: !!(row?.pushplus_token) }, { headers: cors() });
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
