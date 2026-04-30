do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_role' and typnamespace = 'public'::regnamespace) then
    create type public.app_role as enum ('superuser', 'cs', 'pending');
  end if;
end $$;

alter table public.user_profiles
  add column if not exists display_name text;

create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  role public.app_role not null default 'pending',
  created_at timestamptz not null default now(),
  unique (user_id)
);

alter table public.user_roles enable row level security;

insert into public.user_roles (user_id, role)
select id,
  case
    when role = 'superuser' then 'superuser'::public.app_role
    when role = 'cs' then 'cs'::public.app_role
    else 'pending'::public.app_role
  end
from public.user_profiles
on conflict (user_id) do update set role = excluded.role;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles
    where user_id = _user_id
      and role = _role
  )
$$;

create or replace function public.has_role(_user_id uuid, _role text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles
    where user_id = _user_id
      and role::text = _role
  )
$$;

drop policy if exists "Users update own profile limited" on public.user_profiles;
drop policy if exists "Superuser updates all profiles" on public.user_profiles;
drop policy if exists "Superuser deletes profiles" on public.user_profiles;
drop policy if exists "Superuser reads all profiles" on public.user_profiles;

create policy "Superuser reads all profiles" on public.user_profiles
  for select using (public.has_role(auth.uid(), 'superuser'::public.app_role));

drop policy if exists "Users read own role" on public.user_roles;
drop policy if exists "Superuser reads all roles" on public.user_roles;
drop policy if exists "Superuser updates all roles" on public.user_roles;
drop policy if exists "Superuser deletes roles" on public.user_roles;

create policy "Users read own role" on public.user_roles
  for select using (auth.uid() = user_id);

create policy "Superuser reads all roles" on public.user_roles
  for select using (public.has_role(auth.uid(), 'superuser'::public.app_role));

create policy "Superuser updates all roles" on public.user_roles
  for update using (public.has_role(auth.uid(), 'superuser'::public.app_role))
  with check (public.has_role(auth.uid(), 'superuser'::public.app_role));

create policy "Superuser deletes roles" on public.user_roles
  for delete using (public.has_role(auth.uid(), 'superuser'::public.app_role));

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  next_role public.app_role;
  next_name text;
begin
  next_role := case when lower(new.email) = 'andreduquec@gmail.com' then 'superuser'::public.app_role else 'pending'::public.app_role end;
  next_name := coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1));

  insert into public.user_profiles (id, email, display_name, approved_at, approved_by)
  values (
    new.id,
    new.email,
    next_name,
    case when next_role = 'superuser'::public.app_role then now() else null end,
    null
  )
  on conflict (id) do update set
    email = excluded.email,
    display_name = coalesce(public.user_profiles.display_name, excluded.display_name);

  insert into public.user_roles (user_id, role)
  values (new.id, next_role)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

update public.user_profiles p
set display_name = coalesce(p.display_name, split_part(p.email, '@', 1))
where p.display_name is null;

insert into public.user_profiles (id, email, display_name, approved_at)
select id, email, coalesce(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name', split_part(email, '@', 1)), now()
from auth.users
where lower(email) = 'andreduquec@gmail.com'
on conflict (id) do update set
  email = excluded.email,
  display_name = coalesce(public.user_profiles.display_name, excluded.display_name),
  approved_at = coalesce(public.user_profiles.approved_at, now());

insert into public.user_roles (user_id, role)
select id, 'superuser'::public.app_role
from auth.users
where lower(email) = 'andreduquec@gmail.com'
on conflict (user_id) do update set role = 'superuser'::public.app_role;