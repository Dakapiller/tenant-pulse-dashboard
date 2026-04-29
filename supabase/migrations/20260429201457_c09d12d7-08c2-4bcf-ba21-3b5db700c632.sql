-- Recalculate all health scores from scratch with the new dynamic floor logic.
-- Replays the upload deltas chronologically per tenant, then applies task outcomes,
-- then enforces the dynamic floor:
--   very_satisfied recorded in last 3 months (relative to log moment) → floor 80
--   good_receptivity recorded in last 2 months                        → floor 60

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
  -- Wipe existing log + scores so we replay cleanly.
  delete from health_score_log;
  update cs_tenant_status set health_score = null;

  for r in (
    select distinct tenant_name from (
      select tenant_name from tenant_snapshots
      union
      select tenant_name from cs_tenant_status
    ) t order by tenant_name
  ) loop
    prev_score := null;
    prev_period := null;
    prev_games := null; prev_gmv := null; prev_rev := null;

    -- Build chronological events: snapshots + completed task outcomes.
    for evt in (
      select 'upload'::text as kind,
             ts.period::timestamptz as ts,
             ts.period as period,
             coalesce(ts.games_online, 0)::numeric as games_online,
             coalesce(ts.gmv_all, 0)::numeric as gmv_all,
             coalesce(ts.revenue, 0)::numeric as revenue,
             null::text as outcome
      from tenant_snapshots ts
      where ts.tenant_name = r.tenant_name
      union all
      select 'task'::text as kind,
             cts.recorded_at as ts,
             null::date as period,
             null::numeric, null::numeric, null::numeric,
             cts.relationship_status as outcome
      from cs_tenant_status cts
      where cts.tenant_name = r.tenant_name
        and cts.relationship_status in ('bad_relationship','good_receptivity','very_satisfied')
      order by ts asc
    ) loop
      raw_score := null;
      reason_v := null;
      delta_v := 0;

      if evt.kind = 'upload' then
        cur_games := evt.games_online; cur_gmv := evt.gmv_all; cur_rev := evt.revenue;
        if prev_score is null then
          raw_score := 100;
          reason_v := 'Novo clube — primeira aparição em ' || to_char(evt.period, 'YYYY-MM');
        elsif prev_games is not null then
          d_games := case when prev_games > 0 then (cur_games - prev_games) / prev_games * 100 else null end;
          d_gmv   := case when prev_gmv   > 0 then (cur_gmv   - prev_gmv)   / prev_gmv   * 100 else null end;
          d_rev   := case when prev_rev   > 0 then (cur_rev   - prev_rev)   / prev_rev   * 100 else null end;
          drops := 0; ups := 0;
          if d_games is not null and d_games < -5 then drops := drops + 1; elsif d_games is not null and d_games > 5 then ups := ups + 1; end if;
          if d_gmv   is not null and d_gmv   < -5 then drops := drops + 1; elsif d_gmv   is not null and d_gmv   > 5 then ups := ups + 1; end if;
          if d_rev   is not null and d_rev   < -5 then drops := drops + 1; elsif d_rev   is not null and d_rev   > 5 then ups := ups + 1; end if;
          if drops >= 1 then
            raw_score := greatest(0, least(100, prev_score - 10));
            reason_v := 'Queda de performance detectada no upload de ' || to_char(evt.period, 'YYYY-MM');
          elsif ups = 3 then
            raw_score := greatest(0, least(100, prev_score + 10));
            reason_v := 'Subida de performance: todos os indicadores subiram';
          end if;
        end if;
        prev_period := evt.period;
        prev_games := cur_games; prev_gmv := cur_gmv; prev_rev := cur_rev;
      else
        -- task outcome
        outcome_delta := case evt.outcome
          when 'bad_relationship' then -25
          when 'good_receptivity' then 10
          when 'very_satisfied'   then 25
          else 0 end;
        if outcome_delta <> 0 and prev_score is not null then
          raw_score := greatest(0, least(100, prev_score + outcome_delta));
          reason_v := 'Resultado de tarefa: ' || evt.outcome;
        end if;
      end if;

      if raw_score is null then continue; end if;

      -- Compute floor at this moment in time using historical outcomes.
      floor_v := 0; floor_outcome := null; floor_recorded := null;
      select 80, 'very_satisfied', x.recorded_at into floor_v, floor_outcome, floor_recorded
      from cs_tenant_status x
      where x.tenant_name = r.tenant_name
        and x.relationship_status = 'very_satisfied'
        and x.recorded_at <= evt.ts
        and x.recorded_at >= evt.ts - interval '92 days'
      order by x.recorded_at desc limit 1;

      if floor_v < 60 then
        select 60, 'good_receptivity', x.recorded_at into floor_v, floor_outcome, floor_recorded
        from cs_tenant_status x
        where x.tenant_name = r.tenant_name
          and x.relationship_status = 'good_receptivity'
          and x.recorded_at <= evt.ts
          and x.recorded_at >= evt.ts - interval '61 days'
        order by x.recorded_at desc limit 1;
      end if;
      if floor_v is null then floor_v := 0; end if;

      -- Log raw computed change
      if (prev_score is null and raw_score <> 0) or (prev_score is not null and raw_score <> prev_score) then
        insert into health_score_log (tenant_name, previous_score, new_score, delta, reason, source, changed_at)
        values (r.tenant_name, coalesce(prev_score, 0), raw_score, raw_score - coalesce(prev_score, 0), reason_v, evt.kind, evt.ts);
      end if;

      computed_score := raw_score;
      if floor_v > 0 and computed_score < floor_v then
        insert into health_score_log (tenant_name, previous_score, new_score, delta, reason, source, changed_at)
        values (
          r.tenant_name, computed_score, floor_v, floor_v - computed_score,
          'Score mantido acima do mínimo — ' ||
            case floor_outcome when 'very_satisfied' then 'Cliente muito satisfeito' when 'good_receptivity' then 'Boa recetividade' else floor_outcome end ||
            ' registado em ' || to_char(floor_recorded::date, 'YYYY-MM-DD'),
          'task',
          evt.ts + interval '1 millisecond'
        );
        computed_score := floor_v;
      end if;

      prev_score := computed_score;
    end loop;

    -- Persist final score onto latest cs_tenant_status row.
    if prev_score is not null then
      update cs_tenant_status
      set health_score = prev_score
      where id = (
        select id from cs_tenant_status
        where tenant_name = r.tenant_name
        order by recorded_at desc limit 1
      );
    end if;
  end loop;
end $$;