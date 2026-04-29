ALTER TABLE public.cs_tenant_status
  ADD COLUMN IF NOT EXISTS is_priority boolean NOT NULL DEFAULT false;

DELETE FROM public.cs_tasks
  WHERE status = 'pending'
    AND week_start < DATE '2026-03-31';