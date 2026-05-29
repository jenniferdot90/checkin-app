-- 部门打卡数据库建表 SQL（Cloudflare D1 / SQLite）
-- 执行方式见部署步骤

CREATE TABLE IF NOT EXISTS checkins (
  date         TEXT NOT NULL,          -- 日期，格式 YYYY-MM-DD（按 UTC+8）
  code         TEXT NOT NULL,          -- 人员编号（字符串，保留前导零）
  morning_time TEXT DEFAULT NULL,      -- 上午打卡时间 HH:MM:SS，未打卡为 NULL
  evening_time TEXT DEFAULT NULL,      -- 晚上打卡时间 HH:MM:SS，未打卡为 NULL
  PRIMARY KEY (date, code)             -- 每人每天唯一一条记录
);

-- 可选：创建索引加速按日期查询
CREATE INDEX IF NOT EXISTS idx_checkins_date ON checkins(date);

-- Push 订阅表（每人一条，覆盖更新）
CREATE TABLE IF NOT EXISTS push_subscriptions (
  code       TEXT PRIMARY KEY,
  endpoint   TEXT NOT NULL,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
