/**
 * GET /api/status
 * 返回服务器当前时间、日期、时段、全部 21 人打卡状态
 * 所有时间以服务器 UTC+8 为准
 */

const CODES = [
  '864', '332', '486', '748', '862', '065', '943', '292', '431', '995',
  '815', '477', '134', '498', '344', '366', '976', '101', '883', '462', '320'
];

const DAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** 把 UTC Date 对象转成 UTC+8 的各字段 */
function toUTC8(now) {
  const utc8Ms = now.getTime() + 8 * 60 * 60 * 1000;
  const d = new Date(utc8Ms);
  return {
    year:    d.getUTCFullYear(),
    month:   d.getUTCMonth() + 1,
    day:     d.getUTCDate(),
    hours:   d.getUTCHours(),
    minutes: d.getUTCMinutes(),
    seconds: d.getUTCSeconds(),
    dayOfWeek: d.getUTCDay(),   // 0=周日 … 6=周六
  };
}

/** 根据 UTC+8 时分计算当前时段 */
function getPeriod(hours, minutes, isWeekend) {
  if (isWeekend) return 'none';
  const t = hours * 60 + minutes;
  if (t < 6 * 60)                          return 'before_morning'; // 00:00–05:59
  if (t < 9 * 60 + 30)                     return 'morning';        // 06:00–09:29
  if (t < 20 * 60 + 30)                    return 'between';        // 09:30–20:29
  if (t < 22 * 60)                         return 'evening';        // 20:30–21:59
  return 'after_evening';                                            // 22:00–23:59
}

export async function onRequestGet(context) {
  const { env } = context;

  const now = new Date();
  const { year, month, day, hours, minutes, seconds, dayOfWeek } = toUTC8(now);

  const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const serverTime = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  const period = getPeriod(hours, minutes, isWeekend);

  // 查询当天所有打卡记录
  const { results } = await env.DB.prepare(
    'SELECT code, morning_time, evening_time FROM checkins WHERE date = ?'
  ).bind(date).all();

  const recordMap = {};
  for (const r of results) {
    recordMap[r.code] = r;
  }

  const statusList = CODES.map(code => ({
    code,
    morning_time: recordMap[code]?.morning_time ?? null,
    evening_time: recordMap[code]?.evening_time ?? null,
  }));

  return Response.json({
    server_time: serverTime,
    date,
    day_of_week: DAY_NAMES[dayOfWeek],
    is_weekend: isWeekend,
    period,
    status_list: statusList,
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
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
  };
}
