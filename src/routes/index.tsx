import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  PieChart, Pie, Cell,
} from "recharts";
import { fetchAllSnapshots, fetchPeriods, type Snapshot } from "@/lib/data";
import {
  fetchAllCSStatuses, fetchAllCSTasks, currentClubStatus, currentWeekStart, lastCompletedActivityAt,
  outcomeLabel, excludedTenants, type CSTenantStatus, type CSTask, type ClubStatus, CLUB_STATUS_LABEL,
} from "@/lib/cs";
import { computeRiskWithCS, FLAG_META } from "@/lib/risk";
import { fetchHealthScores, fetchHealthScoresAt, healthLevel } from "@/lib/health";
import { formatEuro, formatNumber, periodLabel, periodShort } from "@/lib/format";
import { DataTable, ScoreDelta, type ColumnDef } from "@/components/DataTable";
import { ClubLink } from "@/components/ClubLink";
import { Activity, AlertTriangle, Building2, Euro, Sparkles, TrendingDown, Upload } from "lucide-react";

export const Route = createFileRoute("/")({
  component: DashboardPage,
});

interface ClubAgg {
  name: string;
  score: number;
  prevScore: number | null;
  scoreDelta: number | null; // current - previous (negative = improvement)
  level: "high" | "medium" | "healthy";
  prevLevel: "high" | "medium" | "healthy" | null;
  flags: string[];
  status: ClubStatus;
  lastContact: string | null;
  pending: number;
  latest: Snapshot | null;
  prevSnapshot: Snapshot | null;
}

function DashboardPage() {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [periods, setPeriods] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<CSTenantStatus[]>([]);
  const [tasks, setTasks] = useState<CSTask[]>([]);
  const [healthScores, setHealthScores] = useState<Map<string, number>>(new Map());
  // Score per tenant as of the start of the current calendar month — used to compute
  // monthly improvements ("Evolução positiva este mês"). Defaults to current score
  // when missing so unchanged clubs show 0 delta (not a fake improvement).
  const [prevMonthScores, setPrevMonthScores] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [snapshotsLoaded, setSnapshotsLoaded] = useState(false);
  const [tasksLoaded, setTasksLoaded] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState<string>("");

  // Phase 0 — fast: periods + CS statuses → renders KPI shell + period selector.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Start of the current calendar month (UTC) — anchor for monthly delta.
        const now = new Date();
        const monthStartIso = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
        const [p, st, sc, prevSc] = await Promise.all([
          fetchPeriods(),
          fetchAllCSStatuses(),
          fetchHealthScores(),
          fetchHealthScoresAt(monthStartIso),
        ]);
        if (cancelled) return;
        setPeriods(p);
        setStatuses(st);
        setHealthScores(sc);
        setPrevMonthScores(prevSc);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Phase 1 — heavier: all snapshots → drives charts + KPI numbers.
  // Deferred behind a microtask so the KPI shell paints first.
  useEffect(() => {
    if (loading) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const s = await fetchAllSnapshots();
        if (!cancelled) setSnapshots(s);
      } finally {
        if (!cancelled) setSnapshotsLoaded(true);
      }
    }, 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [loading]);

  // Phase 2 — heaviest: tasks → drives positives + recent activity.
  // Waits until snapshots are in so we never block paint of the charts.
  useEffect(() => {
    if (!snapshotsLoaded) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const tk = await fetchAllCSTasks();
        if (!cancelled) setTasks(tk);
      } finally {
        if (!cancelled) setTasksLoaded(true);
      }
    }, 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [snapshotsLoaded]);

  // Default selected period to the latest available, but allow the user to change it.
  useEffect(() => {
    if (periods.length > 0 && !selectedPeriod) setSelectedPeriod(periods[0]);
  }, [periods, selectedPeriod]);

  const latestPeriod = selectedPeriod || periods[0];
  const previousPeriod = useMemo(() => {
    if (!latestPeriod) return null;
    const idx = periods.indexOf(latestPeriod);
    return idx >= 0 && idx + 1 < periods.length ? periods[idx + 1] : null;
  }, [periods, latestPeriod]);
  const weekStart = useMemo(() => currentWeekStart(), []);

  // Pre-sort once per tenant so downstream consumers don't re-sort on every period change.
  const tenantHistory = useMemo(() => {
    const m = new Map<string, Snapshot[]>();
    snapshots.forEach((s) => {
      if (!m.has(s.tenant_name)) m.set(s.tenant_name, []);
      m.get(s.tenant_name)!.push(s);
    });
    for (const arr of m.values()) arr.sort((a, b) => a.period.localeCompare(b.period));
    return m;
  }, [snapshots]);

  const tenantStatuses = useMemo(() => {
    const m = new Map<string, CSTenantStatus[]>();
    statuses.forEach((s) => {
      if (!m.has(s.tenant_name)) m.set(s.tenant_name, []);
      m.get(s.tenant_name)!.push(s);
    });
    // sort ascending by recorded_at so slicing by cutoff is a simple linear scan
    for (const arr of m.values()) arr.sort((a, b) => (a.recorded_at ?? "").localeCompare(b.recorded_at ?? ""));
    return m;
  }, [statuses]);

  const tasksByTenant = useMemo(() => {
    const m = new Map<string, CSTask[]>();
    tasks.forEach((t) => {
      if (!m.has(t.tenant_name)) m.set(t.tenant_name, []);
      m.get(t.tenant_name)!.push(t);
    });
    return m;
  }, [tasks]);

  // Tenants in churned/closed status — excluded from ALL aggregate metrics
  const excluded = useMemo(() => excludedTenants(statuses), [statuses]);
  const includedSnapshots = useMemo(
    () => snapshots.filter((s) => !excluded.has(s.tenant_name)),
    [snapshots, excluded],
  );

  // Per-tenant aggregate as of the SELECTED period (history truncated to <= selected,
  // statuses filtered by recorded_at <= end of selected month).
  const clubs: ClubAgg[] = useMemo(() => {
    const list: ClubAgg[] = [];
    if (!latestPeriod) return list;
    const cutoff = `${latestPeriod.slice(0, 7)}-31T23:59:59Z`;
    for (const [name, sortedAll] of tenantHistory) {
      // tenantHistory is already sorted ascending. Find slice end via lastIndex with period <= latestPeriod.
      let endIdx = -1;
      for (let i = sortedAll.length - 1; i >= 0; i--) {
        if (sortedAll[i].period <= latestPeriod) { endIdx = i; break; }
      }
      if (endIdx < 0) continue;
      const sorted = endIdx === sortedAll.length - 1 ? sortedAll : sortedAll.slice(0, endIdx + 1);
      const stsAll = tenantStatuses.get(name) ?? [];
      // tenantStatuses is sorted ascending by recorded_at — find first index past cutoff
      let stsEnd = stsAll.length;
      for (let i = 0; i < stsAll.length; i++) {
        if ((stsAll[i].recorded_at ?? "") > cutoff) { stsEnd = i; break; }
      }
      const sts = stsEnd === stsAll.length ? stsAll : stsAll.slice(0, stsEnd);
      const tks = tasksByTenant.get(name) ?? [];
      const risk = computeRiskWithCS(sorted, sts);
      const status = currentClubStatus(sts);
      const pending = tks.filter((t) => t.status === "pending" && t.week_start === weekStart).length;
      const latest = sorted[sorted.length - 1] ?? null;
      let prevSnapshot: Snapshot | null = null;
      if (latest && sorted.length >= 2) {
        prevSnapshot = sorted[sorted.length - 2] ?? null;
      }
      // Real health score from DB (current value). Historical per-period scores
      // would require querying health_score_log, so prevScore stays null here.
      const isLatestPeriod = !!latest && latest.period === latestPeriod;
      const realScore = isLatestPeriod ? healthScores.get(name) : undefined;
      const score = realScore ?? 100;
      const lvlMap = { risk: "high", monitor: "medium", healthy: "healthy" } as const;
      const level = lvlMap[healthLevel(score)];
      // Previous = score at start of the current calendar month (from health_score_log).
      // Tenants with no log entry before that cutoff fall back to the current score
      // (no change → no fake improvement).
      const prevScoreVal = prevMonthScores.has(name) ? (prevMonthScores.get(name) as number) : score;
      const prevLvl = lvlMap[healthLevel(prevScoreVal)];
      list.push({
        name,
        score,
        prevScore: prevScoreVal,
        scoreDelta: score - prevScoreVal,
        level,
        prevLevel: prevLvl,
        flags: risk.flags,
        status,
        lastContact: lastCompletedActivityAt(tks),
        pending,
        latest,
        prevSnapshot,
      });
    }
    return list;
  }, [tenantHistory, tenantStatuses, tasksByTenant, weekStart, latestPeriod, healthScores]);

  // KPIs
  const kpis = useMemo(() => {
    // "Active club" = reported a snapshot in the selected period AND not churned/closed/changed_owner.
    // Defaulting unmapped tenants to "active" was inflating this number (e.g. 324 vs ~270 real).
    const activeClubs = clubs.filter((c) => {
      if (c.status === "churned" || c.status === "closed" || c.status === "changed_owner") return false;
      if (!c.latest || c.latest.period !== latestPeriod) return false;
      const games = Number(c.latest.games_online ?? 0);
      const gmv = Number(c.latest.gmv_all ?? 0);
      const rev = Number(c.latest.revenue ?? 0);
      return games > 0 || gmv > 0 || rev > 0;
    }).length;
    const churnedThisYear = (() => {
      const year = new Date().getUTCFullYear();
      const set = new Set<string>();
      statuses.forEach((s) => {
        if (s.club_status === "churned" && s.recorded_at && new Date(s.recorded_at).getUTCFullYear() === year) {
          set.add(s.tenant_name);
        }
      });
      return set.size;
    })();
    const highRisk = clubs.filter((c) => c.score < 30 && c.status !== "churned" && c.status !== "closed").length;
    const monthGmv = (() => {
      if (!latestPeriod) return 0;
      return includedSnapshots.filter((s) => s.period === latestPeriod).reduce((acc, s) => acc + Number(s.gmv_all ?? 0), 0);
    })();
    const monthRevenue = (() => {
      if (!latestPeriod) return 0;
      return includedSnapshots.filter((s) => s.period === latestPeriod).reduce((acc, s) => acc + Number(s.revenue ?? 0), 0);
    })();
    return { activeClubs, churnedThisYear, highRisk, monthGmv, monthRevenue };
  }, [clubs, statuses, includedSnapshots, latestPeriod]);
  // (latestPeriod intentionally referenced inside activeClubs filter above)

  // Monthly trend series — current and prior-year overlay
  const monthlySeries = useMemo(() => {
    const byPeriod = new Map<string, { games: number; gmv: number; revenue: number }>();
    includedSnapshots.forEach((s) => {
      // Truncate the chart at the selected period
      if (latestPeriod && s.period > latestPeriod) return;
      const cur = byPeriod.get(s.period) ?? { games: 0, gmv: 0, revenue: 0 };
      cur.games += Number(s.games_online ?? 0);
      cur.gmv += Number(s.gmv_all ?? 0);
      cur.revenue += Number(s.revenue ?? 0);
      byPeriod.set(s.period, cur);
    });
    const arr = Array.from(byPeriod.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([p, v]) => ({
        period: p,
        label: periodShort(p),
        games: v.games,
        gmv: Math.round(v.gmv),
        revenue: Math.round(v.revenue),
      }));
    // Build prior-year overlay aligned by month (e.g. "01" of any year aligns).
    const map = new Map(arr.map((r) => [r.period, r]));
    return arr.map((r) => {
      const d = new Date(r.period);
      const priorIso = new Date(Date.UTC(d.getUTCFullYear() - 1, d.getUTCMonth(), 1)).toISOString().slice(0, 10);
      const prior = map.get(priorIso);
      return {
        ...r,
        gamesPrev: prior?.games ?? null,
        gmvPrev: prior?.gmv ?? null,
        revenuePrev: prior?.revenue ?? null,
      };
    });
  }, [includedSnapshots, latestPeriod]);

  // YoY comparison row
  const yoyRow = useMemo(() => {
    return monthlySeries
      .filter((r) => r.gamesPrev !== null && r.gmvPrev !== null && r.revenuePrev !== null)
      .map((r) => ({
        period: r.period,
        label: r.label,
        games: pctChange(r.games, r.gamesPrev as number),
        gmv: pctChange(r.gmv, r.gmvPrev as number),
        revenue: pctChange(r.revenue, r.revenuePrev as number),
      }));
  }, [monthlySeries]);

  // Health distribution per month — limited to last 12 months for perf.
  // For each month we slice the (already-sorted) history at the month and run risk.
  const healthByMonth = useMemo(() => {
    const allPeriods = [...new Set(includedSnapshots.map((s) => s.period))]
      .filter((p) => !latestPeriod || p <= latestPeriod)
      .sort();
    const periodsAsc = allPeriods.slice(-12);
    if (periodsAsc.length === 0) return [];
    // Group tenants by period once (single pass) instead of filtering N times.
    const tenantsByPeriod = new Map<string, Set<string>>();
    for (const p of periodsAsc) tenantsByPeriod.set(p, new Set());
    for (const s of includedSnapshots) {
      const set = tenantsByPeriod.get(s.period);
      if (set) set.add(s.tenant_name);
    }
    return periodsAsc.map((p) => {
      const tenantsThatMonth = tenantsByPeriod.get(p)!;
      const cutoffSts = `${p.slice(0, 7)}-31T23:59:59Z`;
      let healthy = 0, medium = 0, high = 0;
      const isLatestColumn = p === latestPeriod;
      for (const name of tenantsThatMonth) {
        if (isLatestColumn) {
          // Latest column: use the real DB health score.
          const score = healthScores.get(name);
          if (score === undefined) { healthy++; continue; }
          const lvl = healthLevel(score);
          if (lvl === "risk") high++;
          else if (lvl === "monitor") medium++;
          else healthy++;
          continue;
        }
        // Prior months: legacy per-period computation (no historical health score available).
        const fullHist = tenantHistory.get(name);
        if (!fullHist || fullHist.length === 0) { healthy++; continue; }
        let endIdx = -1;
        for (let i = fullHist.length - 1; i >= 0; i--) {
          if (fullHist[i].period <= p) { endIdx = i; break; }
        }
        if (endIdx < 0) { healthy++; continue; }
        const hist = endIdx === fullHist.length - 1 ? fullHist : fullHist.slice(0, endIdx + 1);
        const stsAll = tenantStatuses.get(name) ?? [];
        let stsEnd = stsAll.length;
        for (let i = 0; i < stsAll.length; i++) {
          if ((stsAll[i].recorded_at ?? "") > cutoffSts) { stsEnd = i; break; }
        }
        const sts = stsEnd === stsAll.length ? stsAll : stsAll.slice(0, stsEnd);
        const r = computeRiskWithCS(hist, sts);
        if (r.level === "high") high++;
        else if (r.level === "medium") medium++;
        else healthy++;
      }
      return {
        period: p,
        label: periodShort(p),
        Saudável: healthy,
        Médio: medium,
        Alto: high,
        total: healthy + medium + high,
      };
    });
  }, [includedSnapshots, tenantHistory, tenantStatuses, latestPeriod, healthScores]);

  // Positive metrics
  const positives = useMemo(() => {
    if (!latestPeriod) return { improved: 0, leftHighRisk: 0, revenueGrew: 0, csImpacted: 0 };
    let improved = 0, leftHighRisk = 0, revenueGrew = 0, csImpacted = 0;
    const monthStart = new Date(`${latestPeriod}T00:00:00Z`).toISOString();
    for (const c of clubs) {
      if (excluded.has(c.name)) continue;
      if (c.scoreDelta !== null && c.scoreDelta < 0) improved++;
      if (c.prevLevel === "high" && c.level !== "high") leftHighRisk++;
      if (c.latest && c.prevSnapshot && Number(c.latest.revenue ?? 0) > Number(c.prevSnapshot.revenue ?? 0)) revenueGrew++;
      const tks = tasksByTenant.get(c.name) ?? [];
      const completedThisMonth = tks.some((t) => t.status === "completed" && t.completed_at && t.completed_at >= monthStart);
      if (completedThisMonth && c.scoreDelta !== null && c.scoreDelta < 0) csImpacted++;
    }
    return { improved, leftHighRisk, revenueGrew, csImpacted };
  }, [clubs, latestPeriod, tasksByTenant, excluded]);

  // Status distribution donut — must align with the "Clubes ativos" KPI:
  // a club only counts as "active" if it reported activity in the latest period.
  // Tenants without a recorded status default to "active", which inflated the count
  // (e.g. 324 vs ~270 real). Apply the same activity filter here.
  const statusDistribution = useMemo(() => {
    const counts: Record<ClubStatus, number> = {
      active: 0, possible_churn: 0, churned: 0, closed: 0, changed_owner: 0,
    };
    for (const c of clubs) {
      if (c.status === "active") {
        if (!c.latest || c.latest.period !== latestPeriod) continue;
        const games = Number(c.latest.games_online ?? 0);
        const gmv = Number(c.latest.gmv_all ?? 0);
        const rev = Number(c.latest.revenue ?? 0);
        if (games <= 0 && gmv <= 0 && rev <= 0) continue;
      }
      counts[c.status]++;
    }
    return (Object.keys(counts) as ClubStatus[])
      .map((k) => ({ name: CLUB_STATUS_LABEL[k], key: k, value: counts[k] }))
      .filter((s) => s.value > 0);
  }, [clubs, latestPeriod]);

  // (Radar de Risco was removed — full at-risk view lives at /at-risk and the full club table at /clubs.)

  // Recent CS activity (last 10)
  const recentActivity = useMemo(() => {
    return tasks
      .filter((t) => t.status === "completed" && t.completed_at)
      .sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""))
      .slice(0, 10);
  }, [tasks]);

  if (loading) return <div className="p-10 text-muted-foreground">A carregar…</div>;

  if (!latestPeriod) {
    return (
      <div className="p-10">
        <div className="max-w-xl mx-auto mt-20 text-center">
          <div className="mx-auto mb-4 h-14 w-14 rounded-full bg-surface flex items-center justify-center">
            <Upload className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-semibold mb-2">Ainda sem dados</h1>
          <p className="text-muted-foreground mb-6">Carregue o seu primeiro ficheiro XLSX mensal para começar.</p>
          <Link to="/upload" className="inline-flex items-center gap-2 rounded-md bg-foreground text-background px-4 py-2 text-sm font-medium hover:opacity-90">
            <Upload className="h-4 w-4" /> Ir para Carregar
          </Link>
        </div>
      </div>
    );
  }


  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1500px] mx-auto">
      <header className="mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Visão geral</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Centro de comando para prevenção de churn — {periodLabel(latestPeriod)}
          </p>
        </div>
        <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
          Período
          <select
            value={selectedPeriod}
            onChange={(e) => setSelectedPeriod(e.target.value)}
            className="px-3 h-9 rounded-md border border-border bg-background text-sm min-w-[160px]"
          >
            {periods.map((p) => (
              <option key={p} value={p}>{periodLabel(p)}</option>
            ))}
          </select>
        </label>
      </header>

      {/* Row 1 — KPIs */}
      {/* Row 1 — KPIs (KPIs that depend on snapshots show skeletons until Phase 1 lands) */}
      <section className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4 mb-6">
        <KpiCard icon={<Building2 className="h-4 w-4" />} label="Clubes ativos" value={snapshotsLoaded ? formatNumber(kpis.activeClubs) : "…"} />
        <KpiCard icon={<TrendingDown className="h-4 w-4" />} label="Churned este ano" value={formatNumber(kpis.churnedThisYear)} tone="danger" />
        <KpiCard icon={<AlertTriangle className="h-4 w-4" />} label="Em risco alto" value={snapshotsLoaded ? formatNumber(kpis.highRisk) : "…"} tone="warning" />
        <KpiCard icon={<Euro className="h-4 w-4" />} label="GMV mês" value={snapshotsLoaded ? formatEuro(kpis.monthGmv) : "…"} />
        <KpiCard icon={<Activity className="h-4 w-4" />} label="Receita mês" value={snapshotsLoaded ? formatEuro(kpis.monthRevenue) : "…"} />
      </section>
      <p className="text-[11px] text-muted-foreground -mt-3 mb-6">
        Clubes ativos = clubes com atividade reportada no período selecionado, excluindo churned, fechados e mudança de proprietário.
      </p>

      {/* Row 2 — Charts (deferred until snapshots load) */}
      {!snapshotsLoaded ? (
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          <ChartSkeleton />
          <ChartSkeleton />
        </section>
      ) : (
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <div className="rounded-xl border border-border bg-background p-5">
          <h2 className="text-sm font-semibold mb-1">Tendência mensal</h2>
          <p className="text-xs text-muted-foreground mb-3">Jogos online · GMV · Receita (com sobreposição do ano anterior)</p>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthlySeries} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.93 0.01 250)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="oklch(0.6 0.02 250)" />
                <YAxis yAxisId="left" tick={{ fontSize: 11 }} stroke="oklch(0.6 0.02 250)" tickFormatter={(v) => formatNumber(Number(v))} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} stroke="oklch(0.6 0.02 250)" tickFormatter={(v) => `€${Math.round(Number(v) / 1000)}k`} />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid oklch(0.93 0.01 250)" }}
                  formatter={(v, name) => name === "Jogos online" || name === "Jogos (ano anterior)" ? formatNumber(Number(v)) : formatEuro(Number(v))}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line yAxisId="left" type="monotone" dataKey="games" name="Jogos online" stroke="oklch(0.18 0.02 250)" strokeWidth={2} dot={{ r: 2 }} />
                <Line yAxisId="right" type="monotone" dataKey="gmv" name="GMV total" stroke="oklch(0.55 0.18 260)" strokeWidth={2} dot={{ r: 2 }} />
                <Line yAxisId="right" type="monotone" dataKey="revenue" name="Receita" stroke="oklch(0.65 0.18 145)" strokeWidth={2} dot={{ r: 2 }} />
                <Line yAxisId="left" type="monotone" dataKey="gamesPrev" name="Jogos (ano anterior)" stroke="oklch(0.18 0.02 250)" strokeOpacity={0.45} strokeDasharray="4 3" strokeWidth={1.5} dot={false} />
                <Line yAxisId="right" type="monotone" dataKey="gmvPrev" name="GMV (ano anterior)" stroke="oklch(0.55 0.18 260)" strokeOpacity={0.45} strokeDasharray="4 3" strokeWidth={1.5} dot={false} />
                <Line yAxisId="right" type="monotone" dataKey="revenuePrev" name="Receita (ano anterior)" stroke="oklch(0.65 0.18 145)" strokeOpacity={0.45} strokeDasharray="4 3" strokeWidth={1.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          {yoyRow.length > 0 && (
            <div className="mt-4">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">Comparação ano a ano</div>
              <div className="flex flex-wrap gap-2">
                {yoyRow.map((r) => (
                  <div key={r.period} className="rounded-md border border-border px-2.5 py-1.5">
                    <div className="text-[10px] text-muted-foreground mb-1">{r.label}</div>
                    <div className="flex items-center gap-1.5">
                      <YoyBadge label="Jogos" pct={r.games} />
                      <YoyBadge label="GMV" pct={r.gmv} />
                      <YoyBadge label="Receita" pct={r.revenue} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-border bg-background p-5">
          <h2 className="text-sm font-semibold mb-1">Distribuição de saúde dos clubes</h2>
          <p className="text-xs text-muted-foreground mb-3">Total de clubes carregados por mês</p>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={healthByMonth} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.93 0.01 250)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="oklch(0.6 0.02 250)" />
                <YAxis tick={{ fontSize: 11 }} stroke="oklch(0.6 0.02 250)" />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid oklch(0.93 0.01 250)" }}
                  formatter={(v) => formatNumber(Number(v))}
                  labelFormatter={(label, payload) => {
                    const total = payload?.[0]?.payload?.total ?? 0;
                    return `${label} · ${formatNumber(total)} clubes`;
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Saudável" stackId="a" fill="oklch(0.7 0.15 145)" />
                <Bar dataKey="Médio" stackId="a" fill="oklch(0.78 0.15 75)" />
                <Bar dataKey="Alto" stackId="a" fill="oklch(0.65 0.2 25)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>
      )}

      {/* Row 3 — Positives + status donut */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="lg:col-span-2 rounded-xl border border-success/30 bg-success/5 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Sparkles className="h-4 w-4 text-success" />
            <h2 className="text-sm font-semibold">Evolução positiva este mês</h2>
            {previousPeriod && (
              <span className="text-xs text-muted-foreground">vs {periodShort(previousPeriod)}</span>
            )}
          </div>
          {tasksLoaded ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <PositiveCard value={positives.improved} title="Clubes melhorados" subtitle="Score de saúde diminuiu vs mês anterior" />
              <PositiveCard value={positives.leftHighRisk} title="Saíram de risco alto" subtitle="Estavam ≥60 e baixaram para médio ou saudável" />
              <PositiveCard value={positives.revenueGrew} title="Receita cresceu" subtitle="Receita mensal superior à do mês anterior" />
              <PositiveCard value={positives.csImpacted} title="Impacto CS" subtitle="Tarefa CS concluída este mês e score melhorou" />
            </div>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[0,1,2,3].map((i) => <CardSkeleton key={i} />)}
            </div>
          )}
        </div>
        <div className="rounded-xl border border-border bg-background p-5">
          <h2 className="text-sm font-semibold mb-1">Distribuição por estado</h2>
          <p className="text-xs text-muted-foreground mb-3">{periodLabel(latestPeriod)}</p>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={statusDistribution}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={45}
                  outerRadius={75}
                  paddingAngle={2}
                >
                  {statusDistribution.map((d) => (
                    <Cell key={d.key} fill={STATUS_COLOR[d.key]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v, n) => [formatNumber(Number(v)), String(n)]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>



      {/* Row 5 — Recent CS activity */}
      <section className="rounded-xl border border-border bg-background overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold">Atividade CS recente</h2>
        </div>
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left">Data</th>
                <th className="px-4 py-3 text-left">Clube</th>
                <th className="px-4 py-3 text-left">Resultado</th>
                <th className="px-4 py-3 text-left">Razão</th>
              </tr>
            </thead>
            <tbody>
              {!tasksLoaded ? (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground text-sm">A carregar atividade…</td></tr>
              ) : recentActivity.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground text-sm">Sem atividade recente.</td></tr>
              ) : recentActivity.map((t) => (
                <tr key={t.id} className="border-t border-border hover:bg-surface">
                  <td className="px-4 py-2 text-xs text-muted-foreground">{t.completed_at ? new Date(t.completed_at).toLocaleDateString("pt-PT") : "—"}</td>
                  <td className="px-4 py-2 font-medium"><ClubLink name={t.tenant_name} /></td>
                  <td className="px-4 py-2"><OutcomeBadge outcome={t.outcome} /></td>
                  <td className="px-4 py-2 text-xs text-muted-foreground truncate max-w-md">{t.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function pctChange(cur: number, prev: number): number | null {
  if (!prev) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}

const STATUS_COLOR: Record<ClubStatus, string> = {
  active: "oklch(0.7 0.15 145)",
  possible_churn: "oklch(0.78 0.15 75)",
  churned: "oklch(0.65 0.2 25)",
  closed: "oklch(0.7 0.02 250)",
  changed_owner: "oklch(0.65 0.12 270)",
};

function ChartSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-background p-5">
      <div className="h-3 w-32 bg-surface rounded animate-pulse mb-2" />
      <div className="h-3 w-56 bg-surface rounded animate-pulse mb-4" />
      <div className="h-72 bg-surface/60 rounded animate-pulse" />
    </div>
  );
}

function CardSkeleton() {
  return (
    <div className="rounded-lg bg-background border border-success/20 p-3">
      <div className="h-7 w-10 bg-surface rounded animate-pulse" />
      <div className="h-3 w-20 bg-surface rounded animate-pulse mt-2" />
      <div className="h-2.5 w-28 bg-surface rounded animate-pulse mt-1" />
    </div>
  );
}

function PositiveCard({ value, title, subtitle }: { value: number; title: string; subtitle: string }) {
  return (
    <div className="rounded-lg bg-background border border-success/20 p-3">
      <div className="text-2xl font-bold tabular-nums text-success">{value}</div>
      <div className="text-xs font-medium mt-1">{title}</div>
      <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{subtitle}</div>
    </div>
  );
}

function YoyBadge({ label, pct }: { label: string; pct: number | null }) {
  if (pct === null) return null;
  const positive = pct >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium ${positive ? "bg-success/10 text-success" : "bg-danger/10 text-danger"}`}>
      {label} {positive ? "▲" : "▼"} {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

function KpiCard({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone?: "danger" | "warning" }) {
  const toneClass = tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-background p-4">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="uppercase tracking-wide">{label}</span>
        <span className={toneClass}>{icon}</span>
      </div>
      <div className={`mt-2 text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</div>
    </div>
  );
}

function ScoreBadge({ score, level }: { score: number; level: "high" | "medium" | "healthy" }) {
  const map = {
    high: "bg-danger/10 text-danger",
    medium: "bg-warning/15 text-warning",
    healthy: "bg-success/10 text-success",
  } as const;
  return (
    <span className={`inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${map[level]}`}>{score}</span>
  );
}

function OutcomeBadge({ outcome }: { outcome: string | null }) {
  if (!outcome) return <span className="text-xs text-muted-foreground">—</span>;
  const map: Record<string, { bg: string; label: string }> = {
    very_satisfied: { bg: "bg-success/10 text-success", label: "Muito satisfeito" },
    good_receptivity: { bg: "bg-success/10 text-success", label: "Boa recetividade" },
    bad_relationship: { bg: "bg-danger/10 text-danger", label: "Má relação" },
  };
  const m = map[outcome] ?? { bg: "bg-surface text-foreground", label: outcomeLabel(outcome) };
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${m.bg}`}>{m.label}</span>;
}

// Re-export RiskBadge for backward-compat (used by /cs and /tenant routes).
export function RiskBadge({ level, score, delta }: { level: "high" | "medium" | "healthy"; score: number; delta?: number | null }) {
  const map = {
    high: { bg: "bg-danger/10", text: "text-danger", label: "Risco alto" },
    medium: { bg: "bg-warning/15", text: "text-warning", label: "Médio" },
    healthy: { bg: "bg-success/10", text: "text-success", label: "Saudável" },
  } as const;
  const m = map[level];
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${m.bg} ${m.text}`}>
        <span className="h-1.5 w-1.5 rounded-full bg-current" />
        {m.label} · {score}
      </span>
      {delta !== undefined && <ScoreDelta delta={delta ?? null} />}
    </span>
  );
}
