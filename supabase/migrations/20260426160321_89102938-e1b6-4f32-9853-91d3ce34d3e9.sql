create table public.tenant_snapshots (
  id                 uuid default gen_random_uuid() primary key,
  tenant_name        text not null,
  period             date not null,
  games_online       integer default 0,
  gmv_games          numeric default 0,
  gmv_all            numeric default 0,
  transacted_amount  numeric default 0,
  b2c_commissions    numeric default 0,
  b2b_commissions    numeric default 0,
  saas               numeric default 0,
  revenue            numeric default 0,
  transacted_rate    numeric default 0,
  created_at         timestamptz default now(),
  unique (tenant_name, period)
);

alter table public.tenant_snapshots enable row level security;

-- Public read/write for the dashboard (no auth requirement)
create policy "Anyone can read snapshots"
  on public.tenant_snapshots for select
  using (true);

create policy "Anyone can insert snapshots"
  on public.tenant_snapshots for insert
  with check (true);

create policy "Anyone can update snapshots"
  on public.tenant_snapshots for update
  using (true) with check (true);

create policy "Anyone can delete snapshots"
  on public.tenant_snapshots for delete
  using (true);

create index tenant_snapshots_tenant_period_idx on public.tenant_snapshots (tenant_name, period desc);
create index tenant_snapshots_period_idx on public.tenant_snapshots (period desc);