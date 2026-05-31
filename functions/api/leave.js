const CODES = new Set([
  '864','332','486','748','862','065','943','292','431','995',
  '815','477','134','498','344','366','976','101','883','462','320'
]);

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return fail('请求格式错误'); }

  const { code } = body ?? {};
  if (!code || !CODES.has(String(code))) return fail('编号不存在');

  const now  = new Date();
  const utc8 = new Date(now.getTime() + 8 * 3600 * 1000);
  const pad  = n => String(n).padStart(2, '0');
  const date = `${utc8.getUTCFullYear()}-${pad(utc8.getUTCMonth()+1)}-${pad(utc8.getUTCDate())}`;

  const existing = await env.DB.prepare(
    'SELECT morning_time, morning_late, evening_time, evening_late, leave_status FROM checkins WHERE date = ? AND code = ?'
  ).bind(date, String(code)).first();

  if (existing?.leave_status === 1) return fail('今日已标记休假');

  const anyCheckin = existing?.morning_time || existing?.morning_late
                  || existing?.evening_time || existing?.evening_late;
  if (anyCheckin) return fail('今日已打卡，无法标记休假');

  if (existing) {
    await env.DB.prepare(
      'UPDATE checkins SET leave_status = 1 WHERE date = ? AND code = ?'
    ).bind(date, String(code)).run();
  } else {
    await env.DB.prepare(
      'INSERT INTO checkins (date, code, leave_status) VALUES (?, ?, 1)'
    ).bind(date, String(code)).run();
  }

  return Response.json({ ok: true, message: '已标记今日休假' }, { headers: cors() });
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
