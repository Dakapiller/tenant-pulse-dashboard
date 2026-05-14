-- Cancel pending tasks for clubs whose latest status is non-active
WITH latest_status AS (
  SELECT DISTINCT ON (tenant_name) tenant_name, club_status
  FROM public.cs_tenant_status
  WHERE club_status IS NOT NULL
  ORDER BY tenant_name, recorded_at DESC
),
inactive AS (
  SELECT tenant_name FROM latest_status
  WHERE club_status IN ('churned','closed','changed_owner')
)
UPDATE public.cs_tasks
SET status = 'cancelled',
    outcome = 'cancelled_inactive',
    note = 'Não está ativo',
    completed_at = now()
WHERE status = 'pending'
  AND tenant_name IN (SELECT tenant_name FROM inactive);