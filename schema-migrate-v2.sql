-- 迁移 v2：新增补卡字段 + 管理员设置表
-- 注意：ALTER TABLE ADD COLUMN 不会丢失现有数据

ALTER TABLE checkins ADD COLUMN morning_late TEXT DEFAULT NULL;
ALTER TABLE checkins ADD COLUMN evening_late TEXT DEFAULT NULL;

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
