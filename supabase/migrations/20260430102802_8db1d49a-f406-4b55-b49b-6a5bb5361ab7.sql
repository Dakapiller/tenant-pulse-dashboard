-- Add 'denied' value to app_role enum
alter type public.app_role add value if not exists 'denied';