-- 012 rollback: Drop roster tables
-- WARNING: Destructive — only use if 012 needs to be reverted

DROP TABLE IF EXISTS roster_daily_metrics CASCADE;
DROP TABLE IF EXISTS roster_audit_log CASCADE;
DROP TABLE IF EXISTS roster_tasks CASCADE;
