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
    dayOfWeek: d.getUTCDay(),
  };
}

export async function onRequestGet({ env }) {
  const now = new Date();
  const { year, month, day, dayOfWeek } = toUTC8(now);
  const pad = n => String(n).padStart(2, '0');
  const todayStr = `${year}-${pad(month)}-${pad(day)}`;
  const todayMs  = Date.UTC(year, month - 1, day);

  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const mondayMs = todayMs - daysFromMonday * 86400000;

  const workdays = [];
  for (let i = 0; i < 7; i++) {
    const ms = mondayMs + i * 86400000;
    if (ms > todayMs) break;
    const d2  = new Date(ms);
    const dow = d2.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const y = d2.getUTCFullYear(), m = d2.getUTCMonth() + 1, dd = d2.getUTCDate();
    workdays.push({ date: `${y}-${pad(m)}-${pad(dd)}`, dayName: DAY_NAMES[dow] });
  }

  if (!workdays.length) {
    return Response.json({ days: [], total: CODES.length }, { headers: cors() });
  }

  const placeholders = workdays.map(() => '?').join(',');
  const { results } = await env.DB.prepare(
    `SELECT date, code, morning_time, morning_late, evening_time, evening_late, leave_status
     FROM checkins WHERE date IN (${placeholders})`
  ).bind(...workdays.map(w => w.date)).all();

  const recordMap = {};
  for (const r of results) {
    if (!recordMap[r.date]) recordMap[r.date] = {};
    recordMap[r.date][r.code] = r;
  }

  const days = workdays.map(w => {
    const recs = recordMap[w.date] || {};
    // 正常打卡或补打卡都算已打卡
    const leaveList    = CODES.filter(c => recs[c]?.leave_status === 1);
    const morningAbsent = CODES.filter(c => !recs[c]?.morning_time && !recs[c]?.morning_late && recs[c]?.leave_status !== 1);
    const eveningAbsent = CODES.filter(c => !recs[c]?.evening_time && !recs[c]?.evening_late && recs[c]?.leave_status !== 1);
    return {
      date:           w.date,
      day_name:       w.dayName,
      is_today:       w.date === todayStr,
      morning_count:  CODES.length - morningAbsent.length - leaveList.length,
      evening_count:  CODES.length - eveningAbsent.length - leaveList.length,
      morning_absent: morningAbsent,
      evening_absent: eveningAbsent,
      leave_list:     leaveList,
    };
  });

  return Response.json({ days, total: CODES.length }, { headers: cors() });
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
