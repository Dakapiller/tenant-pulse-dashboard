-- Product feedback table
CREATE TABLE public.product_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_name text NOT NULL,
  reported_at date NOT NULL DEFAULT CURRENT_DATE,
  category text NOT NULL,
  feature_name text NOT NULL,
  status_tag text NOT NULL CHECK (status_tag IN ('good_to_have','must_have','blocker')),
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_product_feedback_tenant ON public.product_feedback(tenant_name);
CREATE INDEX idx_product_feedback_category_feature ON public.product_feedback(category, feature_name);
CREATE INDEX idx_product_feedback_reported_at ON public.product_feedback(reported_at DESC);

ALTER TABLE public.product_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read feedback"
  ON public.product_feedback FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "CS or superuser insert feedback"
  ON public.product_feedback FOR INSERT
  TO authenticated
  WITH CHECK (has_role(auth.uid(), 'superuser'::app_role) OR has_role(auth.uid(), 'cs'::app_role));

CREATE POLICY "CS or superuser update feedback"
  ON public.product_feedback FOR UPDATE
  TO authenticated
  USING (has_role(auth.uid(), 'superuser'::app_role) OR has_role(auth.uid(), 'cs'::app_role))
  WITH CHECK (has_role(auth.uid(), 'superuser'::app_role) OR has_role(auth.uid(), 'cs'::app_role));

CREATE POLICY "Superuser delete feedback"
  ON public.product_feedback FOR DELETE
  TO authenticated
  USING (has_role(auth.uid(), 'superuser'::app_role));