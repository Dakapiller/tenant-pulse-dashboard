-- 1. handle_new_user: trigger function, should not be callable directly by API roles
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- 2. Drop unused text-based has_role overload (canonical version uses app_role enum)
DROP FUNCTION IF EXISTS public.has_role(uuid, text);

-- 3. has_role(uuid, app_role): required by RLS policies for signed-in users.
--    Lock down to the minimum surface: authenticated + service_role only,
--    no anon, no PUBLIC.
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;