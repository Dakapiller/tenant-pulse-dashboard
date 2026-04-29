-- 1. user_profiles table
create table public.user_profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  email text not null,
  role text not null default 'pending' check (role in ('superuser','cs','pending')),
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references auth.users(id)
);

alter table public.user_profiles enable row level security;

-- 2. SECURITY DEFINER helper to avoid recursive RLS
create or replace function public.has_role(_user_id uuid, _role text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_profiles where id = _user_id and role = _role
  )
$$;

-- 3. Policies on user_profiles
create policy "Users read own profile" on public.user_profiles
  for select using (auth.uid() = id);

create policy "Superuser reads all profiles" on public.user_profiles
  for select using (public.has_role(auth.uid(), 'superuser'));

create policy "Users update own profile limited" on public.user_profiles
  for update using (auth.uid() = id);

create policy "Superuser updates all profiles" on public.user_profiles
  for update using (public.has_role(auth.uid(), 'superuser'));

create policy "Superuser deletes profiles" on public.user_profiles
  for delete using (public.has_role(auth.uid(), 'superuser'));

-- INSERT only via trigger (security definer); no client insert policy

-- 4. Auto-create profile on signup; auto-promote bootstrap superuser email
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_profiles (id, email, role, approved_at)
  values (
    new.id,
    new.email,
    case when new.email = 'andreduquec@gmail.com' then 'superuser' else 'pending' end,
    case when new.email = 'andreduquec@gmail.com' then now() else null end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 5. Bootstrap superuser if email already exists
insert into public.user_profiles (id, email, role, approved_at)
select id, email, 'superuser', now()
from auth.users where email = 'andreduquec@gmail.com'
on conflict (id) do update set role = 'superuser', approved_at = coalesce(public.user_profiles.approved_at, now());

-- 6. Tighten RLS on all data tables: drop open policies, add authenticated-only
do $$
declare
  t text;
  p record;
begin
  foreach t in array array['tenant_snapshots','cs_tasks','cs_tenant_status','club_status_log','health_score_log']
  loop
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy if exists %I on public.%I', p.policyname, t);
    end loop;
    execute format('create policy "Authenticated read" on public.%I for select using (auth.uid() is not null)', t);
    execute format('create policy "Authenticated insert" on public.%I for insert with check (auth.uid() is not null)', t);
    execute format('create policy "Authenticated update" on public.%I for update using (auth.uid() is not null)', t);
    execute format('create policy "Authenticated delete" on public.%I for delete using (auth.uid() is not null)', t);
  end loop;
end $$;