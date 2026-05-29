import { sendPush } from './webpush.js';

const VAPID_SUBJECT = 'mailto:j2418674806@outlook.com';

// Cron 触发时间（UTC）：
//   "15 1 * * 1-5"  → 北京 09:15，上午打卡截止前 15 分钟
//   "45 13 * * 1-5" → 北京 21:45，晚上打卡截止前 15 分钟

export default {
  async scheduled(event, env, ctx) {
    const cron = event.cron;                   // e.g. "15 1 * * 1-5"
    const period = cron.startsWith('15 1')
      ? 'morning'   // UTC 01:15 → 北京 09:15
      : 'evening';  // UTC 13:45 → 北京 21:45

    const now = new Date();
    // 转北京时间日期
    const utc8 = new Date(now.getTime() + 8 * 3600 * 1000);
    const date = utc8.toISOString().slice(0, 10);

    const timeField = period === 'morning' ? 'morning_time' : 'evening_time';

    // 查出订阅了提醒但今天对应时段还没打卡的用户
    const { results: subs } = await env.DB.prepare(`
      SELECT ps.code, ps.endpoint, ps.p256dh, ps.auth
      FROM push_subscriptions ps
      WHERE NOT EXISTS (
        SELECT 1 FROM checkins c
        WHERE c.date = ? AND c.code = ps.code AND c.${timeField} IS NOT NULL
      )
    `).bind(date).all();

    if (!subs.length) return;

    const vapidCfg = {
      privateKeyJwk: env.VAPID_PRIVATE_KEY,
      publicKeyB64u: env.VAPID_PUBLIC_KEY,
      subject:       VAPID_SUBJECT,
    };

    const periodLabel = period === 'morning' ? '上午' : '晚上';
    const deadline    = period === 'morning' ? '09:30' : '22:00';

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
        // 410 Gone：订阅已失效，删除
        if (res.status === 410) {
          failed.push(sub.code);
        }
      } catch (e) {
        console.error(`推送失败 ${sub.code}:`, e.message);
      }
    }));

    if (failed.length) {
      await Promise.all(failed.map(code =>
        env.DB.prepare('DELETE FROM push_subscriptions WHERE code = ?').bind(code).run()
      ));
    }
  },
};
