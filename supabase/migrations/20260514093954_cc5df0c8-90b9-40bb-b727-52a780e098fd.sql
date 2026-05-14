
-- tenant_snapshots: superuser-only writes
DROP POLICY IF EXISTS "Authenticated insert" ON public.tenant_snapshots;
DROP POLICY IF EXISTS "Authenticated update" ON public.tenant_snapshots;
DROP POLICY IF EXISTS "Authenticated delete" ON public.tenant_snapshots;

CREATE POLICY "Superuser insert snapshots" ON public.tenant_snapshots
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'superuser'::public.app_role));

CREATE POLICY "Superuser update snapshots" ON public.tenant_snapshots
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'superuser'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'superuser'::public.app_role));

CREATE POLICY "Superuser delete snapshots" ON public.tenant_snapshots
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'superuser'::public.app_role));

-- cs_tenant_status: cs or superuser writes
DROP POLICY IF EXISTS "Authenticated insert" ON public.cs_tenant_status;
DROP POLICY IF EXISTS "Authenticated update" ON public.cs_tenant_status;
DROP POLICY IF EXISTS "Authenticated delete" ON public.cs_tenant_status;

CREATE POLICY "CS or superuser insert status" ON public.cs_tenant_status
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'superuser'::public.app_role)
    OR public.has_role(auth.uid(), 'cs'::public.app_role)
  );

CREATE POLICY "CS or superuser update status" ON public.cs_tenant_status
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'superuser'::public.app_role)
    OR public.has_role(auth.uid(), 'cs'::public.app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'superuser'::public.app_role)
    OR public.has_role(auth.uid(), 'cs'::public.app_role)
  );

CREATE POLICY "Superuser delete status" ON public.cs_tenant_status
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'superuser'::public.app_role));

-- club_status_log: cs or superuser inserts; superuser-only update/delete
DROP POLICY IF EXISTS "Authenticated insert" ON public.club_status_log;
DROP POLICY IF EXISTS "Authenticated update" ON public.club_status_log;
DROP POLICY IF EXISTS "Authenticated delete" ON public.club_status_log;

CREATE POLICY "CS or superuser insert log" ON public.club_status_log
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'superuser'::public.app_role)
    OR public.has_role(auth.uid(), 'cs'::public.app_role)
  );

CREATE POLICY "Superuser update log" ON public.club_status_log
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'superuser'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'superuser'::public.app_role));

CREATE POLICY "Superuser delete log" ON public.club_status_log
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'superuser'::public.app_role));

-- user_profiles: explicit deny for client writes (server uses service role)
CREATE POLICY "No client inserts on profiles" ON public.user_profiles
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (false);

CREATE POLICY "No client updates on profiles" ON public.user_profiles
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (false) WITH CHECK (false);

CREATE POLICY "No client deletes on profiles" ON public.user_profiles
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (false);
