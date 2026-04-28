
-- Remove duplicate pending CS tasks (same club, week, flag, reason)
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY tenant_name, week_start, status, flags, reason
           ORDER BY created_at ASC, id ASC
         ) AS rn
  FROM cs_tasks
  WHERE status = 'pending'
)
DELETE FROM cs_tasks
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Prevent future duplicates of pending tasks for the same flag+week+club
CREATE UNIQUE INDEX IF NOT EXISTS cs_tasks_pending_unique
  ON cs_tasks (tenant_name, week_start, flags, reason)
  WHERE status = 'pending';
