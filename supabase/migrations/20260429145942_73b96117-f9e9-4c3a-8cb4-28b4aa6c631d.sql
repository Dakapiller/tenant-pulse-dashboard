create table if not exists public.health_score_log (
  id uuid default gen_random_uuid() primary key,
  tenant_name text not null,
  changed_at timestamptz not null default now(),
  previous_score integer not null,
  new_score integer not null,
  delta integer not null,
  reason text not null,
  source text not null check (source in ('upload', 'task'))
);

create index if not exists health_score_log_tenant_idx on public.health_score_log (tenant_name, changed_at desc);
create index if not exists health_score_log_changed_at_idx on public.health_score_log (changed_at desc);

alter table public.health_score_log enable row level security;

drop policy if exists "Anyone can read health_score_log" on public.health_score_log;
drop policy if exists "Anyone can insert health_score_log" on public.health_score_log;
drop policy if exists "Anyone can update health_score_log" on public.health_score_log;
drop policy if exists "Anyone can delete health_score_log" on public.health_score_log;

create policy "Anyone can read health_score_log" on public.health_score_log for select using (true);
create policy "Anyone can insert health_score_log" on public.health_score_log for insert with check (true);
create policy "Anyone can update health_score_log" on public.health_score_log for update using (true) with check (true);
create policy "Anyone can delete health_score_log" on public.health_score_log for delete using (true);

alter table public.cs_tenant_status add column if not exists health_score integer;

do $$
declare
  r record;
  v_prev_score int;
  v_new_score int;
  v_delta int;
  v_reason text;
  v_d_games numeric;
  v_d_gmv numeric;
  v_d_revenue numeric;
  v_drops int;
  v_ups int;
  v_worst_metric text;
  v_worst_pct numeric;
  v_scores jsonb := '{}'::jsonb;
  v_task_exists boolean;
  v_week_start date;
  v_latest_id uuid;
begin
  delete from public.health_score_log;
  update public.cs_tenant_status set health_score = null where health_score is not null;

  for r in
    with tp as (
      select id, tenant_name, period, created_at,
             coalesce(games_online, 0)::numeric as games_online,
             coalesce(gmv_all, 0)::numeric as gmv_all,
             coalesce(revenue, 0)::numeric as revenue,
             row_number() over (partition by tenant_name, period order by created_at desc) as rn
      from public.tenant_snapshots
    )
    select tenant_name, period, created_at, games_online, gmv_all, revenue,
           lag(games_online) over w as prev_games,
           lag(gmv_all) over w as prev_gmv,
           lag(revenue) over w as prev_revenue
    from tp
    where rn = 1
    window w as (partition by tenant_name order by period asc)
    order by tenant_name, period asc
  loop
    v_prev_score := coalesce((v_scores ->> r.tenant_name)::int, -1);

    if v_prev_score = -1 then
      v_new_score := 100;
      v_delta := 100;
      v_reason := 'Novo clube — primeira aparição em ' || to_char(r.period, 'YYYY-MM');
      insert into public.health_score_log (tenant_name, changed_at, previous_score, new_score, delta, reason, source)
      values (r.tenant_name, coalesce(r.created_at, now()), 0, v_new_score, v_delta, v_reason, 'upload');
      v_scores := jsonb_set(v_scores, array[r.tenant_name], to_jsonb(v_new_score));
    else
      v_d_games := case when r.prev_games > 0 then ((r.games_online - r.prev_games) / r.prev_games) * 100 else null end;
      v_d_gmv := case when r.prev_gmv > 0 then ((r.gmv_all - r.prev_gmv) / r.prev_gmv) * 100 else null end;
      v_d_revenue := case when r.prev_revenue > 0 then ((r.revenue - r.prev_revenue) / r.prev_revenue) * 100 else null end;

      v_drops := 0; v_ups := 0; v_worst_metric := null; v_worst_pct := 0;
      if v_d_games is not null then
        if v_d_games < -5 then v_drops := v_drops + 1;
          if v_worst_metric is null or v_d_games < v_worst_pct then v_worst_metric := 'Jogos Online'; v_worst_pct := v_d_games; end if;
        elsif v_d_games > 5 then v_ups := v_ups + 1; end if;
      end if;
      if v_d_gmv is not null then
        if v_d_gmv < -5 then v_drops := v_drops + 1;
          if v_worst_metric is null or v_d_gmv < v_worst_pct then v_worst_metric := 'GMV'; v_worst_pct := v_d_gmv; end if;
        elsif v_d_gmv > 5 then v_ups := v_ups + 1; end if;
      end if;
      if v_d_revenue is not null then
        if v_d_revenue < -5 then v_drops := v_drops + 1;
          if v_worst_metric is null or v_d_revenue < v_worst_pct then v_worst_metric := 'Receita'; v_worst_pct := v_d_revenue; end if;
        elsif v_d_revenue > 5 then v_ups := v_ups + 1; end if;
      end if;

      v_delta := 0;
      if v_drops >= 1 then
        v_delta := -10;
        v_reason := 'Queda de performance: ' || v_worst_metric || ' desceu ' || to_char(abs(v_worst_pct), 'FM999990.0') || '%';
      elsif v_ups = 3 then
        v_delta := 10;
        v_reason := 'Subida de performance: todos os indicadores subiram';
      end if;

      if v_delta <> 0 then
        v_new_score := greatest(0, least(100, v_prev_score + v_delta));
        if v_new_score <> v_prev_score then
          insert into public.health_score_log (tenant_name, changed_at, previous_score, new_score, delta, reason, source)
          values (r.tenant_name, coalesce(r.created_at, now()), v_prev_score, v_new_score, v_new_score - v_prev_score, v_reason, 'upload');
          v_scores := jsonb_set(v_scores, array[r.tenant_name], to_jsonb(v_new_score));

          v_week_start := date_trunc('week', r.period)::date;
          select exists(
            select 1 from public.cs_tasks ct
            where ct.tenant_name = r.tenant_name
              and ct.week_start = v_week_start
              and ct.reason = v_reason
          ) into v_task_exists;

          if not v_task_exists then
            insert into public.cs_tasks (tenant_name, reason, cta, priority, week_start, status, flags)
            values (
              r.tenant_name,
              v_reason,
              case when v_delta < 0 then 'Contactar para perceber a quebra' else 'Contactar para reforçar a relação' end,
              case when v_delta < 0 then 80 else 30 end,
              v_week_start,
              'pending',
              '{}'::text[]
            );
          end if;
        end if;
      end if;
    end if;
  end loop;

  for r in
    select tenant_name, completed_at, outcome
    from public.cs_tasks
    where status = 'completed' and completed_at is not null and outcome is not null
    order by completed_at asc
  loop
    v_prev_score := coalesce((v_scores ->> r.tenant_name)::int, 100);
    v_delta := case r.outcome
      when 'bad_relationship' then -25
      when 'good_receptivity' then 10
      when 'very_satisfied' then 25
      else 0
    end;
    if v_delta <> 0 then
      v_new_score := greatest(0, least(100, v_prev_score + v_delta));
      if v_new_score <> v_prev_score then
        v_reason := case r.outcome
          when 'bad_relationship' then 'Resultado de tarefa: Má relação'
          when 'good_receptivity' then 'Resultado de tarefa: Boa recetividade'
          when 'very_satisfied' then 'Resultado de tarefa: Cliente ficou muito satisfeito'
          else 'Resultado de tarefa'
        end;
        insert into public.health_score_log (tenant_name, changed_at, previous_score, new_score, delta, reason, source)
        values (r.tenant_name, r.completed_at, v_prev_score, v_new_score, v_new_score - v_prev_score, v_reason, 'task');
        v_scores := jsonb_set(v_scores, array[r.tenant_name], to_jsonb(v_new_score));
      end if;
    end if;
  end loop;

  -- Persist final score onto the latest cs_tenant_status row per tenant; create one if none exists.
  for r in select key as tenant_name, value::text::int as score from jsonb_each_text(v_scores)
  loop
    select id into v_latest_id
    from public.cs_tenant_status
    where tenant_name = r.tenant_name
    order by recorded_at desc nulls last
    limit 1;

    if v_latest_id is not null then
      update public.cs_tenant_status set health_score = r.score where id = v_latest_id;
    else
      insert into public.cs_tenant_status (tenant_name, relationship_status, health_score, note, club_status)
      values (r.tenant_name, 'status_active', r.score, 'Score inicial calculado', 'active');
    end if;
  end loop;
end $$;
