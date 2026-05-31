const CODES = new Set([
  '864','332','486','748','862','065','943','292','431','995',
  '815','477','134','498','344','366','976','101','883','462','320'
]);

function toUTC8(now) {
  const ms = now.getTime() + 8 * 3600 * 1000;
  const d  = new Date(ms);
  return {
    year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(),
    hours: d.getUTCHours(), minutes: d.getUTCMinutes(), seconds: d.getUTCSeconds(),
    dayOfWeek: d.getUTCDay(),
  };
}

function pad(n) { return String(n).padStart(2, '0'); }

function fail(msg, status = 400) {
  return Response.json({ success: false, message: msg }, { status, headers: cors() });
}

async function getForceWorkday(env, dateStr) {
  const s = await env.DB.prepare(
    "SELECT value FROM settings WHERE key = 'force_workday_date'"
  ).first();
  return s?.value === dateStr;
}

export async function onRequestPost({ env, request }) {
  let body;
  try { body = await request.json(); } catch { return fail('请求格式错误，请发送 JSON'); }

  const { code, period } = body ?? {};
  if (!code || !CODES.has(String(code))) return fail('编号不存在，请检查后重试');

  const validPeriods = ['morning', 'morning_late', 'evening', 'evening_late', 'late'];
  if (!validPeriods.includes(period)) return fail('时段参数错误');

  const now = new Date();
  const { year, month, day, hours, minutes, seconds, dayOfWeek } = toUTC8(now);
  const date    = `${year}-${pad(month)}-${pad(day)}`;
  const timeStr = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;

  // 判断今日是否需要打卡（含管理员开关）
  const isCalWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  const forceWorkday = isCalWeekend ? await getForceWorkday(env, date) : false;
  const isRestDay    = isCalWeekend && !forceWorkday;
  if (isRestDay) return fail('今日为休息日，无需打卡');

  // 'late' 由服务器根据当前时间自动判断补卡类型
  const t = hours * 60 + minutes;
  if (period === 'late') {
    if (t >= 570 && t < 720)  period = 'morning_late';
    else if (t >= 1320)        period = 'evening_late';
    else return fail('当前不在补卡时段（上午补卡 09:30–12:00，晚上补卡 22:00–00:00）');
  }

  // 时段时间校验
  if (period === 'morning') {
    if (t < 360)  return fail('上午打卡尚未开始（06:00 才开始）');
    if (t >= 570) return fail('上午打卡时间已过（截止 09:30），可使用补打卡');
  } else if (period === 'morning_late') {
    if (t < 570)  return fail('上午补打卡尚未开始（09:30 才开始）');
    if (t >= 720) return fail('上午补打卡时间已过（截止 12:00）');
  } else if (period === 'evening') {
    if (t < 1230) return fail('晚上打卡尚未开始（20:30 才开始）');
    if (t >= 1320) return fail('晚上打卡时间已过（截止 22:00），可使用补打卡');
  } else { // evening_late
    if (t < 1320) return fail('晚上补打卡尚未开始（22:00 才开始）');
    // 23:59 仍有效，无上限
  }

  // 查当日记录
  const existing = await env.DB.prepare(
    'SELECT morning_time, morning_late, evening_time, evening_late, leave_status FROM checkins WHERE date = ? AND code = ?'
  ).bind(date, String(code)).first();

  // 休假状态不允许打卡
  if (existing?.leave_status === 1) return fail('今日已标记休假，无法打卡');

  const isMorningPeriod = period === 'morning' || period === 'morning_late';
  const isEveningPeriod = period === 'evening' || period === 'evening_late';

  if (isMorningPeriod) {
    const done = existing?.morning_time || existing?.morning_late;
    if (done) return fail(`今日上午已打卡（打卡时间：${done}）`);
  }
  if (isEveningPeriod) {
    const done = existing?.evening_time || existing?.evening_late;
    if (done) return fail(`今日晚上已打卡（打卡时间：${done}）`);
  }

  // 写入数据库
  const fieldMap = {
    morning:      'morning_time',
    morning_late: 'morning_late',
    evening:      'evening_time',
    evening_late: 'evening_late',
  };
  const field = fieldMap[period];

  if (existing) {
    await env.DB.prepare(
      `UPDATE checkins SET ${field} = ? WHERE date = ? AND code = ?`
    ).bind(timeStr, date, String(code)).run();
  } else {
    const v = { morning_time: null, morning_late: null, evening_time: null, evening_late: null };
    v[field] = timeStr;
    await env.DB.prepare(
      'INSERT INTO checkins (date, code, morning_time, morning_late, evening_time, evening_late) VALUES (?,?,?,?,?,?)'
    ).bind(date, String(code), v.morning_time, v.morning_late, v.evening_time, v.evening_late).run();
  }

  const labelMap = { morning: '上午', morning_late: '上午（补）', evening: '晚上', evening_late: '晚上（补）' };
  return Response.json({
    success: true,
    message: `${labelMap[period]}打卡成功！打卡时间：${timeStr}`,
    time: timeStr,
  }, { headers: cors() });
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
