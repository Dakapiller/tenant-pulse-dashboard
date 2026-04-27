-- Add club_status column to cs_tenant_status
ALTER TABLE public.cs_tenant_status
  ADD COLUMN IF NOT EXISTS club_status text DEFAULT 'active';

-- Create club_status_log table
CREATE TABLE IF NOT EXISTS public.club_status_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_name text NOT NULL,
  previous_status text NOT NULL,
  new_status text NOT NULL,
  note text DEFAULT NULL,
  changed_by text DEFAULT 'cs',
  changed_at timestamptz DEFAULT now()
);

ALTER TABLE public.club_status_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read club_status_log"
  ON public.club_status_log FOR SELECT USING (true);

CREATE POLICY "Anyone can insert club_status_log"
  ON public.club_status_log FOR INSERT WITH CHECK (true);

CREATE POLICY "Anyone can update club_status_log"
  ON public.club_status_log FOR UPDATE USING (true) WITH CHECK (true);

CREATE POLICY "Anyone can delete club_status_log"
  ON public.club_status_log FOR DELETE USING (true);

CREATE INDEX IF NOT EXISTS idx_club_status_log_tenant ON public.club_status_log (tenant_name, changed_at DESC);