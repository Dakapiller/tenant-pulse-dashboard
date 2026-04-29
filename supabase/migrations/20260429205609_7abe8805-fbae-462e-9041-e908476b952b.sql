do $$
declare
  r record;
  prev_score int;
  computed_score int;
  raw_score int;
  prev_period date;
  prev_games numeric; prev_gmv numeric; prev_rev numeric;
  cur_games numeric; cur_gmv numeric; cur_rev numeric;
  d_games numeric; d_gmv numeric; d_rev numeric;
  drops int; ups int;
  delta_v int;
  reason_v text;
  outcome_delta int;
  floor_v int;
  floor_outcome text;
  floor_recorded timestamptz;
  evt record;
begin
  delete from health_score_log;
  update cs_tenant_status set health_score = null;

  for r in (select distinct tenant_name from (
              select tenant_name from tenant_snapshots
              union select tenant_name from cs_tenant_status
            ) t) loop
    prev_score := null;
    prev_period := null;
    prev_games := null; prev_gmv := null; prev_rev := null;

    for evt in (
      select 'upload'::text as kind, period::timestamptz as ts, period,
             coalesce(games_online,0) as games, coalesce(gmv_all,0) as gmv,
             coalesce(revenue,0) as revenue, null::text as outcome
      from tenant_snapshots where tenant_name = r.tenant_name
      union all
      select 'task'::text, recorded_at, null, 0, 0, 0, relationship_status
      from cs_tenant_status
      where tenant_name = r.tenant_name
        and relationship_status in ('bad_relationship','good_receptivity','very_satisfied')
      order by 2
    ) loop
      if evt.kind = 'upload' then
        cur_games := evt.games; cur_gmv := evt.gmv; cur_rev := evt.revenue;
        if prev_score is null then
          computed_score := 100;
          reason_v := 'Novo clube — score inicial atribuído';
          delta_v := 100;
        else
          d_games := case when prev_games > 0 then ((cur_games-prev_games)/prev_games)*100 else null end;
          d_gmv   := case when prev_gmv   > 0 then ((cur_gmv-prev_gmv)/prev_gmv)*100     else null end;
          d_rev   := case when prev_rev   > 0 then ((cur_rev-prev_rev)/prev_rev)*100     else null end;
          drops := 0; ups := 0;
          if d_games is not null and d_games < -5 then drops := drops + 1; elsif d_games is not null and d_games > 5 then ups := ups + 1; end if;
          if d_gmv   is not null and d_gmv   < -5 then drops := drops + 1; elsif d_gmv   is not null and d_gmv   > 5 then ups := ups + 1; end if;
          if d_rev   is not null and d_rev   < -5 then drops := drops + 1; elsif d_rev   is not null and d_rev   > 5 then ups := ups + 1; end if;
          if drops >= 1 then
            delta_v := -10; reason_v := 'Queda detetada em métricas-chave';
          elsif ups = 3 then
            delta_v := 10;  reason_v := 'Crescimento em todas as métricas-chave';
          else
            delta_v := 0;   reason_v := null;
          end if;
          computed_score := greatest(0, least(100, prev_score + delta_v));
        end if;
        prev_period := evt.period;
        prev_games := cur_games; prev_gmv := cur_gmv; prev_rev := cur_rev;
      else
        outcome_delta := case evt.outcome
          when 'bad_relationship' then -25
          when 'good_receptivity' then 10
          when 'very_satisfied' then 25
          else 0 end;
        if prev_score is null then prev_score := 100; end if;
        delta_v := outcome_delta;
        reason_v := 'Resultado de tarefa: '||evt.outcome;
        computed_score := greatest(0, least(100, prev_score + delta_v));
      end if;

      raw_score := computed_score;

      -- Apply dynamic floor based on outcomes recorded BEFORE OR AT this event time.
      floor_v := 0; floor_outcome := null; floor_recorded := null;
      select case when relationship_status='very_satisfied' and recorded_at >= evt.ts - interval '92 days' then 80
                  when relationship_status='good_receptivity' and recorded_at >= evt.ts - interval '61 days' then 60
                  else 0 end,
             relationship_status, recorded_at
        into floor_v, floor_outcome, floor_recorded
        from cs_tenant_status
        where tenant_name = r.tenant_name
          and relationship_status in ('very_satisfied','good_receptivity')
          and recorded_at <= evt.ts
        order by case relationship_status when 'very_satisfied' then 0 else 1 end, recorded_at desc
        limit 1;
      if floor_v is null then floor_v := 0; end if;

      if reason_v is not null or prev_score is null then
        insert into health_score_log(tenant_name, changed_at, previous_score, new_score, delta, reason, source)
        values (r.tenant_name, evt.ts, coalesce(prev_score,0), raw_score, raw_score - coalesce(prev_score,0),
                coalesce(reason_v, 'Resultado de tarefa: '||evt.outcome),
                case when evt.kind='upload' then 'upload' else 'task' end);
      end if;

      if floor_v > 0 and raw_score < floor_v then
        insert into health_score_log(tenant_name, changed_at, previous_score, new_score, delta, reason, source)
        values (r.tenant_name, evt.ts + interval '1 millisecond', raw_score, floor_v, floor_v - raw_score,
                'Score mantido acima do mínimo — '||floor_outcome||' registado em '||to_char(floor_recorded::date,'YYYY-MM-DD'),
                'task');
        computed_score := floor_v;
      end if;

      prev_score := computed_score;
    end loop;

    if prev_score is not null then
      update cs_tenant_status
      set health_score = prev_score
      where id = (select id from cs_tenant_status where tenant_name = r.tenant_name order by recorded_at desc limit 1);
    end if;
  end loop;
end $$;