const CODES = [
  '864','332','486','748','862','065','943','292','431','995',
  '815','477','134','498','344','366','976','101','883','462','320'
];

const DAY_NAMES = ['周日','周一','周二','周三','周四','周五','周六'];

function toUTC8(now) {
  const utc8Ms = now.getTime() + 8 * 3600 * 1000;
  const d = new Date(utc8Ms);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    dayOfWeek: d.getUTCDay(),
  };
}

export async function onRequestGet(context) {
  const { env } = context;
  const now = new Date();
  const { year, month, day, dayOfWeek } = toUTC8(now);

  const todayStr = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  const todayMs = Date.UTC(year, month - 1, day);

  // 本周一（周日算上周，dayOfWeek 0=周日）
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const mondayMs = todayMs - daysFromMonday * 86400000;

  // 收集本周一到今天的工作日
  const workdays = [];
  for (let i = 0; i < 7; i++) {
    const ms = mondayMs + i * 86400000;
    if (ms > todayMs) break;
    const d2 = new Date(ms);
    const dow = d2.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const y = d2.getUTCFullYear();
    const m = String(d2.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d2.getUTCDate()).padStart(2, '0');
    workdays.push({ date: `${y}-${m}-${dd}`, dayName: DAY_NAMES[dow] });
  }

  if (workdays.length === 0) {
    return Response.json({ days: [], total: CODES.length }, { headers: corsHeaders() });
  }

  const placeholders = workdays.map(() => '?').join(',');
  const { results } = await env.DB.prepare(
    `SELECT date, code, morning_time, evening_time FROM checkins WHERE date IN (${placeholders})`
  ).bind(...workdays.map(w => w.date)).all();

  const recordMap = {};
  for (const r of results) {
    if (!recordMap[r.date]) recordMap[r.date] = {};
    recordMap[r.date][r.code] = r;
  }

  const days = workdays.map(w => {
    const recs = recordMap[w.date] || {};
    const morningAbsent = CODES.filter(c => !recs[c]?.morning_time);
    const eveningAbsent = CODES.filter(c => !recs[c]?.evening_time);
    return {
      date: w.date,
      day_name: w.dayName,
      is_today: w.date === todayStr,
      morning_count: CODES.length - morningAbsent.length,
      evening_count: CODES.length - eveningAbsent.length,
      morning_absent: morningAbsent,
      evening_absent: eveningAbsent,
    };
  });

  return Response.json({ days, total: CODES.length }, { headers: corsHeaders() });
}

export async function onRequestOptions() {
  return new Response(null, { headers: corsHeaders() });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
  };
}
