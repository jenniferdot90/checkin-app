-- 迁移 v3：新增休假状态字段
-- ALTER TABLE ADD COLUMN 不会丢失现有数据
ALTER TABLE checkins ADD COLUMN leave_status INTEGER DEFAULT 0;
