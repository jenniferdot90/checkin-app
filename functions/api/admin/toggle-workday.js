const ADMIN_PASSWORD = 'admin2026';

function toUTC8DateStr() {
  const ms = Date.now() + 8 * 3600 * 1000;
  const d  = new Date(ms);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`;
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch {
    return Response.json({ ok: false, error: '请求格式错误' }, { status: 400, headers: cors() });
  }

  const { password, enable, probe } = body ?? {};

  if (password !== ADMIN_PASSWORD) {
    return Response.json({ ok: false, error: '密码错误' }, { status: 403, headers: cors() });
  }

  const date = toUTC8DateStr();

  // probe 模式：只查当前状态，不修改
  if (probe) {
    const s = await env.DB.prepare(
      "SELECT value FROM settings WHERE key = 'force_workday_date'"
    ).first();
    return Response.json({ ok: true, force_active: s?.value === date, date }, { headers: cors() });
  }

  if (enable) {
    await env.DB.prepare(`
      INSERT INTO settings (key, value, updated_at) VALUES ('force_workday_date', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).bind(date, new Date().toISOString()).run();
  } else {
    await env.DB.prepare("DELETE FROM settings WHERE key = 'force_workday_date'").run();
  }

  return Response.json({ ok: true, enabled: !!enable, date }, { headers: cors() });
}

export async function onRequestOptions() {
  return new Response(null, { headers: cors() });
}

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
