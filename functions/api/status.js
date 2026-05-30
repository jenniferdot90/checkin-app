const CODES = [
  '864','332','486','748','862','065','943','292','431','995',
  '815','477','134','498','344','366','976','101','883','462','320'
];
const DAY_NAMES = ['周日','周一','周二','周三','周四','周五','周六'];

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

// 返回时段（已含补卡时段）
function getPeriod(h, m, isRestDay) {
  if (isRestDay) return 'none';
  const t = h * 60 + m;
  if (t < 360)  return 'before_morning'; // 00:00–05:59
  if (t < 570)  return 'morning';        // 06:00–09:29
  if (t < 720)  return 'morning_late';   // 09:30–11:59
  if (t < 1230) return 'between';        // 12:00–20:29
  if (t < 1320) return 'evening';        // 20:30–21:59
  return 'evening_late';                 // 22:00–23:59
}

async function getForceWorkday(env, dateStr) {
  const s = await env.DB.prepare(
    "SELECT value FROM settings WHERE key = 'force_workday_date'"
  ).first();
  return s?.value === dateStr;
}

export async function onRequestGet({ env }) {
  const now = new Date();
  const { year, month, day, hours, minutes, seconds, dayOfWeek } = toUTC8(now);
  const date       = `${year}-${pad(month)}-${pad(day)}`;
  const serverTime = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;

  const isCalWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  const forceWorkday = isCalWeekend ? await getForceWorkday(env, date) : false;
  const isRestDay    = isCalWeekend && !forceWorkday;
  const period       = getPeriod(hours, minutes, isRestDay);

  // 今日打卡记录
  const { results } = await env.DB.prepare(
    'SELECT code, morning_time, morning_late, evening_time, evening_late FROM checkins WHERE date = ?'
  ).bind(date).all();

  const rec = {};
  for (const r of results) rec[r.code] = r;

  const statusList = CODES.map(code => ({
    code,
    morning_time: rec[code]?.morning_time ?? null,
    morning_late: rec[code]?.morning_late ?? null,
    evening_time: rec[code]?.evening_time ?? null,
    evening_late: rec[code]?.evening_late ?? null,
  }));

  // before_morning (00:00–05:59) 时，附带前一天晚上缺卡名单
  let prevEveningAbsent = null;
  if (period === 'before_morning') {
    const prev  = new Date(Date.UTC(year, month - 1, day) - 86400000);
    const pStr  = `${prev.getUTCFullYear()}-${pad(prev.getUTCMonth()+1)}-${pad(prev.getUTCDate())}`;
    const pDow  = prev.getUTCDay();
    const pCal  = pDow === 0 || pDow === 6;
    const pForce = pCal ? await getForceWorkday(env, pStr) : false;
    const prevIsWorkday = !pCal || pForce;

    if (prevIsWorkday) {
      const { results: pr } = await env.DB.prepare(
        'SELECT code, evening_time, evening_late FROM checkins WHERE date = ?'
      ).bind(pStr).all();
      const pm = {};
      for (const r of pr) pm[r.code] = r;
      prevEveningAbsent = CODES.filter(c => !pm[c]?.evening_time && !pm[c]?.evening_late);
    }
  }

  return Response.json({
    server_time: serverTime,
    date,
    day_of_week:  DAY_NAMES[dayOfWeek],
    is_weekend:   isRestDay,   // backward-compat：休息日为 true
    is_rest_day:  isRestDay,
    force_workday: forceWorkday,
    period,
    status_list:  statusList,
    prev_evening_absent: prevEveningAbsent,
  }, { headers: cors() });
}

export async function onRequestOptions() {
  return new Response(null, { headers: cors() });
}

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
  };
}
