
DROP INDEX IF EXISTS cs_tasks_pending_unique;
CREATE UNIQUE INDEX IF NOT EXISTS cs_tasks_pending_unique_tenant_week
  ON cs_tasks (tenant_name, week_start)
  WHERE status = 'pending';
