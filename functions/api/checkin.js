/**
 * POST /api/checkin
 * 入参: { code: string, period: 'morning' | 'evening' }
 * 后端完整校验后写入 D1，返回 { success, message, time? }
 * 所有时间以服务器 UTC+8 为准，不信任客户端时间
 */

const CODES = new Set([
  '864', '332', '486', '748', '862', '065', '943', '292', '431', '995',
  '815', '477', '134', '498', '344', '366', '976', '101', '883', '462', '320'
]);

function toUTC8(now) {
  const utc8Ms = now.getTime() + 8 * 60 * 60 * 1000;
  const d = new Date(utc8Ms);
  return {
    year:      d.getUTCFullYear(),
    month:     d.getUTCMonth() + 1,
    day:       d.getUTCDate(),
    hours:     d.getUTCHours(),
    minutes:   d.getUTCMinutes(),
    seconds:   d.getUTCSeconds(),
    dayOfWeek: d.getUTCDay(),
  };
}

function fail(msg, status = 400) {
  return Response.json({ success: false, message: msg }, {
    status,
    headers: corsHeaders(),
  });
}

export async function onRequestPost(context) {
  const { env, request } = context;

  // 解析请求体
  let body;
  try {
    body = await request.json();
  } catch {
    return fail('请求格式错误，请发送 JSON');
  }

  const { code, period } = body ?? {};

  // 校验编号
  if (!code || !CODES.has(String(code))) {
    return fail('编号不存在，请检查后重试');
  }

  // 校验时段参数
  if (period !== 'morning' && period !== 'evening') {
    return fail('时段参数错误（应为 morning 或 evening）');
  }

  // 获取服务器 UTC+8 时间
  const now = new Date();
  const { year, month, day, hours, minutes, seconds, dayOfWeek } = toUTC8(now);

  const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  // 校验是否工作日
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return fail('今日为周末，无需打卡');
  }

  // 校验时段是否在允许范围内（以分钟表示）
  const t = hours * 60 + minutes;
  const MORNING_START = 6 * 60;        // 06:00
  const MORNING_END   = 9 * 60 + 30;  // 09:30
  const EVENING_START = 20 * 60 + 30; // 20:30
  const EVENING_END   = 22 * 60;      // 22:00

  if (period === 'morning') {
    if (t < MORNING_START) return fail(`上午打卡尚未开始（06:00 才开始）`);
    if (t >= MORNING_END)  return fail(`上午打卡时间已过（截止 09:30）`);
  } else {
    if (t < EVENING_START) return fail(`晚上打卡尚未开始（20:30 才开始）`);
    if (t >= EVENING_END)  return fail(`晚上打卡时间已过（截止 22:00）`);
  }

  // 查询是否已打卡
  const existing = await env.DB.prepare(
    'SELECT morning_time, evening_time FROM checkins WHERE date = ? AND code = ?'
  ).bind(date, String(code)).first();

  const periodLabel = period === 'morning' ? '上午' : '晚上';
  const timeField   = period === 'morning' ? 'morning_time' : 'evening_time';

  if (existing?.[timeField]) {
    return fail(`今日${periodLabel}已打卡（打卡时间：${existing[timeField]}）`);
  }

  // 写入数据库：有记录则 UPDATE，无记录则 INSERT
  if (existing) {
    await env.DB.prepare(
      `UPDATE checkins SET ${timeField} = ? WHERE date = ? AND code = ?`
    ).bind(timeStr, date, String(code)).run();
  } else {
    const morningVal = period === 'morning' ? timeStr : null;
    const eveningVal = period === 'evening' ? timeStr : null;
    await env.DB.prepare(
      'INSERT INTO checkins (date, code, morning_time, evening_time) VALUES (?, ?, ?, ?)'
    ).bind(date, String(code), morningVal, eveningVal).run();
  }

  return Response.json({
    success: true,
    message: `${periodLabel}打卡成功！打卡时间：${timeStr}`,
    time: timeStr,
  }, {
    headers: corsHeaders(),
  });
}

export async function onRequestOptions() {
  return new Response(null, { headers: corsHeaders() });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
  };
}
