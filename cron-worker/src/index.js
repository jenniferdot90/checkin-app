import { sendPush } from './webpush.js';

const CODES = [
  '864','332','486','748','862','065','943','292','431','995',
  '815','477','134','498','344','366','976','101','883','462','320'
];

function toUTC8(now) {
  const ms = now.getTime() + 8 * 3600 * 1000;
  const d  = new Date(ms);
  return {
    year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(),
    dayOfWeek: d.getUTCDay(),
  };
}

function pad(n) { return String(n).padStart(2, '0'); }

export default {
  async scheduled(event, env, ctx) {
    const cron   = event.cron;
    // 北京时间：09:15 上午缺卡提醒 / 10:00 上午汇总给320 / 20:30 晚上开始通知 / 21:45 晚上缺卡提醒 / 22:15 晚上汇总给320
    const period = cron.startsWith('15 1 ')  ? 'morning'
                 : cron.startsWith('0 2')    ? 'morning_summary'
                 : cron.startsWith('30 12')  ? 'evening_open'
                 : cron.startsWith('15 14')  ? 'evening_summary'
                 : 'evening';

    const now = new Date();
    const { year, month, day, dayOfWeek } = toUTC8(now);
    const date = `${year}-${pad(month)}-${pad(day)}`;

    // 周末检查：若管理员未强制开启则直接退出
    const isCalWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    if (isCalWeekend) {
      const s = await env.DB.prepare(
        "SELECT value FROM settings WHERE key = 'force_workday_date'"
      ).first();
      if (s?.value !== date) {
        console.log(`[${date}] 今日为休息日，跳过推送`);
        return;
      }
    }

    // 10:00 上午汇总 / 22:15 晚上汇总：向编号320推送仍未打卡名单
    if (period === 'morning_summary' || period === 'evening_summary') {
      const isMorning  = period === 'morning_summary';
      const timeField  = isMorning ? 'morning_time'  : 'evening_time';
      const lateField  = isMorning ? 'morning_late'  : 'evening_late';
      const timeLabel  = isMorning ? '上午10:00' : '晚上22:15';
      const { results: checkins } = await env.DB.prepare(
        `SELECT code, ${timeField}, ${lateField}, leave_status FROM checkins WHERE date = ?`
      ).bind(date).all();
      const checkinMap = {};
      for (const r of checkins) checkinMap[r.code] = r;
      const absentCodes = CODES.filter(code => {
        const r = checkinMap[code];
        if (r?.leave_status === 1) return false;
        if (r?.[timeField] || r?.[lateField]) return false;
        return true;
      });
      console.log(`[${date}] ${timeLabel} 仍未打卡 ${absentCodes.length} 人: ${absentCodes.join(', ') || '无'}`);
      if (absentCodes.length > 0) {
        await sendSummaryTo320(env, absentCodes, date, timeLabel);
      }
      return;
    }

    // 20:30 全员开始提醒：向所有已绑定且未休假的人推送
    if (period === 'evening_open') {
      const { results: checkins } = await env.DB.prepare(
        `SELECT code, leave_status FROM checkins WHERE date = ?`
      ).bind(date).all();
      const leaveSet = new Set(checkins.filter(r => r.leave_status === 1).map(r => r.code));
      const targetCodes = CODES.filter(c => !leaveSet.has(c));
      console.log(`[${date}] 20:30 晚上打卡开始，推送 ${targetCodes.length} 人`);
      await sendPushPlusOpen(env, targetCodes);
      return;
    }

    const timeField = period === 'morning' ? 'morning_time' : 'evening_time';
    const lateField = period === 'morning' ? 'morning_late' : 'evening_late';
    const periodLabel  = period === 'morning' ? '上午' : '晚上';
    const deadline     = period === 'morning' ? '09:30' : '22:00';
    const lateDeadline = period === 'morning' ? '12:00' : '00:00（次日）';

    // 查今日打卡记录（含补卡和休假）
    const { results: checkins } = await env.DB.prepare(
      `SELECT code, morning_time, morning_late, evening_time, evening_late, leave_status
       FROM checkins WHERE date = ?`
    ).bind(date).all();

    const checkinMap = {};
    for (const r of checkins) checkinMap[r.code] = r;

    // 未打卡且未休假的编号
    const absentCodes = CODES.filter(code => {
      const r = checkinMap[code];
      if (r?.leave_status === 1) return false;
      if (r?.[timeField] || r?.[lateField]) return false;
      return true;
    });

    console.log(`[${date}] ${period} 未打卡 ${absentCodes.length}/${CODES.length} 人: ${absentCodes.join(', ') || '无'}`);

    if (absentCodes.length > 0) {
      await sendPushPlus(env, absentCodes, periodLabel, deadline, lateDeadline);
    }
  },
};

// ── 20:30 全员开始提醒 ────────────────────────────────────────
async function sendPushPlusOpen(env, targetCodes) {
  if (!env.PUSHPLUS_TOKEN) return;
  if (!targetCodes.length) { console.log('20:30 全部休假，跳过'); return; }

  const { results: users } = await env.DB.prepare(
    `SELECT code, pushplus_token FROM users
     WHERE code IN (${targetCodes.map(() => '?').join(',')})
       AND pushplus_token IS NOT NULL AND pushplus_token != ''`
  ).bind(...targetCodes).all();

  if (!users.length) { console.log('20:30 无已绑定用户，跳过'); return; }

  let sent = 0, failed = 0;
  for (const user of users) {
    const content =
      `【打卡提醒】晚上打卡时间到啦！<br>` +
      `打卡窗口 <b>20:30–22:00</b>，请及时打卡。<br><br>` +
      `<a href="https://tzgafazhi.fun">→ 点此立即打卡</a>`;
    try {
      const payload = { token: env.PUSHPLUS_TOKEN, title: '🌙 晚上打卡开始啦', content, template: 'html' };
      if (user.pushplus_token !== env.PUSHPLUS_TOKEN) payload.to = user.pushplus_token;
      const res  = await fetch('https://www.pushplus.plus/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.code === 200) { sent++; console.log(`✅ 20:30 推送成功 ${user.code}`); }
      else { failed++; console.error(`❌ 20:30 推送失败 ${user.code}: ${data.msg}`); }
    } catch (e) { failed++; console.error(`❌ 20:30 推送异常 ${user.code}: ${e.message}`); }
    await new Promise(r => setTimeout(r, 500));
  }
  console.log(`20:30 推送完成 | 成功:${sent} 失败:${failed} 未绑定:${targetCodes.length - users.length}`);
}

// ── PushPlus 微信推送 ─────────────────────────────────────────
async function sendPushPlus(env, absentCodes, periodLabel, deadline, lateDeadline) {
  if (!env.PUSHPLUS_TOKEN) {
    console.log('未配置 PUSHPLUS_TOKEN，跳过微信推送');
    return;
  }

  const placeholders = absentCodes.map(() => '?').join(',');
  const { results: users } = await env.DB.prepare(
    `SELECT code, pushplus_token FROM users
     WHERE code IN (${placeholders}) AND pushplus_token IS NOT NULL AND pushplus_token != ''`
  ).bind(...absentCodes).all();

  const skipped = absentCodes.length - users.length;
  if (!users.length) {
    console.log(`微信推送：全部 ${absentCodes.length} 人未绑定，跳过`);
    return;
  }

  let sent = 0, failed = 0;

  for (const user of users) {
    const content =
      `【编号 ${user.code}】你今日${periodLabel}还未打卡。<br>` +
      `正常打卡截止 <b>${deadline}</b>，补打卡截止 <b>${lateDeadline}</b>，请尽快打卡。<br><br>` +
      `<a href="https://tzgafazhi.fun">→ 点此立即打卡</a>`;

    try {
      const payload = {
        token:    env.PUSHPLUS_TOKEN,
        title:    `⏰ 打卡提醒·${periodLabel}`,
        content,
        template: 'html',
      };
      if (user.pushplus_token !== env.PUSHPLUS_TOKEN) payload.to = user.pushplus_token;

      const res = await fetch('https://www.pushplus.plus/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.code === 200) {
        sent++;
        console.log(`✅ 微信推送成功 ${user.code}`);
      } else {
        failed++;
        console.error(`❌ 微信推送失败 ${user.code}: code=${data.code} msg=${data.msg}`);
      }
    } catch (e) {
      failed++;
      console.error(`❌ 微信推送异常 ${user.code}: ${e.message}`);
    }

    // 每条间隔 500ms，避免 PushPlus 限流
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`微信推送完成 | 成功:${sent} 失败:${failed} 未绑定跳过:${skipped}`);
}

// ── Web Push 浏览器通知（保留原有功能）───────────────────────────
async function sendWebPushAll(env, date, timeField, lateField, periodLabel, deadline) {
  if (!env.VAPID_PRIVATE_KEY || !env.VAPID_PUBLIC_KEY) return;

  const { results: subs } = await env.DB.prepare(`
    SELECT ps.code, ps.endpoint, ps.p256dh, ps.auth
    FROM push_subscriptions ps
    WHERE NOT EXISTS (
      SELECT 1 FROM checkins c
      WHERE c.date = ?
        AND c.code = ps.code
        AND (c.${timeField} IS NOT NULL OR c.${lateField} IS NOT NULL)
    )
  `).bind(date).all();

  if (!subs.length) return;

  const vapidCfg = {
    privateKeyJwk: env.VAPID_PRIVATE_KEY,
    publicKeyB64u: env.VAPID_PUBLIC_KEY,
    subject: 'mailto:j2418674806@outlook.com',
  };

  const failed = [];
  await Promise.all(subs.map(async sub => {
    const payload = {
      title: '⏰ 打卡提醒',
      body:  `${periodLabel}打卡还有 15 分钟截止（${deadline}），编号 ${sub.code} 还未打卡`,
      url:   '/',
    };
    try {
      const res = await sendPush(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
        vapidCfg
      );
      if (res.status === 410) failed.push(sub.code);
    } catch (e) {
      console.error(`Web Push 失败 ${sub.code}:`, e.message);
    }
  }));

  if (failed.length) {
    await Promise.all(failed.map(code =>
      env.DB.prepare('DELETE FROM push_subscriptions WHERE code = ?').bind(code).run()
    ));
  }
}

// ── 22:15 汇总推送给编号320 ───────────────────────────────────────
async function sendSummaryTo320(env, absentCodes, date, timeLabel) {
  if (!env.PUSHPLUS_TOKEN) return;

  const user320 = await env.DB.prepare(
    `SELECT pushplus_token FROM users WHERE code = '320' AND pushplus_token IS NOT NULL AND pushplus_token != ''`
  ).first();

  if (!user320) {
    console.log('编号320未绑定 pushplus_token，跳过汇总推送');
    return;
  }

  const content =
    `【${date} 打卡汇总】<br>` +
    `以下编号截至 ${timeLabel} 仍未打卡：<br><br>` +
    `<b>${absentCodes.join('、')}</b><br><br>` +
    `共 ${absentCodes.length} 人未打卡。`;

  try {
    const payload = {
      token:    env.PUSHPLUS_TOKEN,
      title:    `📋 ${timeLabel}未打卡·${absentCodes.length}人`,
      content,
      template: 'html',
    };
    if (user320.pushplus_token !== env.PUSHPLUS_TOKEN) {
      payload.to = user320.pushplus_token;
    }
    const res  = await fetch('https://www.pushplus.plus/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.code === 200) { console.log(`✅ ${timeLabel} 汇总推送成功 → 编号320`); }
    else { console.error(`❌ ${timeLabel} 汇总推送失败: code=${data.code} msg=${data.msg}`); }
  } catch (e) {
    console.error(`❌ ${timeLabel} 汇总推送异常: ${e.message}`);
  }
}
