-- Create bug_reports table with RLS following the product_feedback pattern.
CREATE TABLE public.bug_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_name text NOT NULL,
  title text NOT NULL,
  link text NOT NULL,
  severity text NOT NULL DEFAULT 'major',
  status text NOT NULL DEFAULT 'open',
  note text,
  reported_at date NOT NULL DEFAULT CURRENT_DATE,
  solved_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX bug_reports_tenant_idx ON public.bug_reports (tenant_name);
CREATE INDEX bug_reports_status_idx ON public.bug_reports (status);
CREATE INDEX bug_reports_solved_at_idx ON public.bug_reports (solved_at DESC NULLS LAST);

-- updated_at trigger reusing the existing touch_changelog_updated_at function
CREATE TRIGGER bug_reports_touch_updated_at
BEFORE UPDATE ON public.bug_reports
FOR EACH ROW EXECUTE FUNCTION public.touch_changelog_updated_at();

ALTER TABLE public.bug_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read bug reports"
ON public.bug_reports FOR SELECT
USING (auth.uid() IS NOT NULL);

CREATE POLICY "CS or superuser insert bug reports"
ON public.bug_reports FOR INSERT TO authenticated
WITH CHECK (has_role(auth.uid(), 'superuser'::app_role) OR has_role(auth.uid(), 'cs'::app_role));

CREATE POLICY "CS or superuser update bug reports"
ON public.bug_reports FOR UPDATE TO authenticated
USING (has_role(auth.uid(), 'superuser'::app_role) OR has_role(auth.uid(), 'cs'::app_role))
WITH CHECK (has_role(auth.uid(), 'superuser'::app_role) OR has_role(auth.uid(), 'cs'::app_role));

CREATE POLICY "Superuser delete bug reports"
ON public.bug_reports FOR DELETE TO authenticated
USING (has_role(auth.uid(), 'superuser'::app_role));