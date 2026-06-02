const CODES = new Set([
  '864','332','486','748','862','065','943','292','431','995',
  '815','477','134','498','344','366','976','101','883','462','320'
]);
const ADMIN_PASSWORD = 'admin2026';

function toUTC8DateStr() {
  const ms = Date.now() + 8 * 3600 * 1000;
  const d  = new Date(ms);
  const p  = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth()+1)}-${p(d.getUTCDate())}`;
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch {
    return Response.json({ ok: false, error: '请求格式错误' }, { status: 400, headers: cors() });
  }

  const { password, code, action, date: customDate } = body ?? {};

  if (password !== ADMIN_PASSWORD) {
    return Response.json({ ok: false, error: '密码错误' }, { status: 403, headers: cors() });
  }

  if (!code || !CODES.has(String(code))) return fail('编号不存在');
  if (!['add', 'remove'].includes(action))  return fail('action 应为 add 或 remove');

  const date = customDate || toUTC8DateStr();

  const existing = await env.DB.prepare(
    'SELECT leave_status FROM checkins WHERE date = ? AND code = ?'
  ).bind(date, String(code)).first();

  if (action === 'add') {
    if (existing?.leave_status === 1) return fail(`编号 ${code} 今日已是休假状态`);
    if (existing) {
      await env.DB.prepare('UPDATE checkins SET leave_status = 1 WHERE date = ? AND code = ?')
        .bind(date, String(code)).run();
    } else {
      await env.DB.prepare('INSERT INTO checkins (date, code, leave_status) VALUES (?, ?, 1)')
        .bind(date, String(code)).run();
    }
    return Response.json({ ok: true, message: `编号 ${code} 已标记为 ${date} 休假` }, { headers: cors() });
  } else {
    if (!existing || existing.leave_status !== 1) return fail(`编号 ${code} 今日并未休假`);
    await env.DB.prepare('UPDATE checkins SET leave_status = 0 WHERE date = ? AND code = ?')
      .bind(date, String(code)).run();
    return Response.json({ ok: true, message: `编号 ${code} 的 ${date} 休假已取消` }, { headers: cors() });
  }
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
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
