create table if not exists public.cs_tasks (
  id uuid default gen_random_uuid() primary key,
  tenant_name text not null,
  reason text not null,
  cta text not null,
  priority integer not null,
  status text not null default 'pending',
  outcome text default null,
  flags text[] default '{}',
  created_at timestamptz default now(),
  completed_at timestamptz default null,
  week_start date not null
);

create table if not exists public.cs_tenant_status (
  id uuid default gen_random_uuid() primary key,
  tenant_name text not null,
  relationship_status text not null,
  note text default null,
  recorded_at timestamptz default now()
);

alter table public.cs_tasks enable row level security;
alter table public.cs_tenant_status enable row level security;

create policy "Anyone can read cs_tasks" on public.cs_tasks for select using (true);
create policy "Anyone can insert cs_tasks" on public.cs_tasks for insert with check (true);
create policy "Anyone can update cs_tasks" on public.cs_tasks for update using (true) with check (true);
create policy "Anyone can delete cs_tasks" on public.cs_tasks for delete using (true);

create policy "Anyone can read cs_tenant_status" on public.cs_tenant_status for select using (true);
create policy "Anyone can insert cs_tenant_status" on public.cs_tenant_status for insert with check (true);
create policy "Anyone can update cs_tenant_status" on public.cs_tenant_status for update using (true) with check (true);
create policy "Anyone can delete cs_tenant_status" on public.cs_tenant_status for delete using (true);

create index if not exists idx_cs_tasks_week on public.cs_tasks(week_start);
create index if not exists idx_cs_tasks_tenant on public.cs_tasks(tenant_name);
create index if not exists idx_cs_status_tenant on public.cs_tenant_status(tenant_name);