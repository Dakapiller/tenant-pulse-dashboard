import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { RiskBadge } from "./index";
import { ClubLink } from "@/components/ClubLink";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import { fetchAllSnapshots, type Snapshot } from "@/lib/data";
import {
  fetchAllCSStatuses,
  fetchPendingCSTasks,
  insertCSTasks,
  completeCSTask,
  completeCSTasksBatch,
  postponeCSTask,
  currentWeekStart,
  scoreWithDelta,
  excludedTenants,
  OUTCOME_OPTIONS,
  type CSTenantStatus,
  type CSTask,
} from "@/lib/cs";
import { computeRiskWithCS, FLAG_CTA, FLAG_META, type RiskFlag } from "@/lib/risk";
import { fetchHealthScores } from "@/lib/health";
import { formatEuro, formatNumber, periodShort } from "@/lib/format";
import { DataTable, ScoreDelta } from "@/components/DataTable";
import { AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, ChevronRight, Clock, Eye, EyeOff, ListChecks, Plus } from "lucide-react";
import { NewTaskDialog } from "@/components/NewTaskDialog";

export const Route = createFileRoute("/cs/tasks")({
  component: CSTasksPage,
});

function CSTasksPage() {
  const [statuses, setStatuses] = useState<CSTenantStatus[]>([]);
  const [pendingTasks, setPendingTasks] = useState<CSTask[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [snapshotsLoaded, setSnapshotsLoaded] = useState(false);
  const [healthScores, setHealthScores] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);

  const [chartMode, setChartMode] = useState<"aggregate" | "tenant">("aggregate");
  const [selectedTenant, setSelectedTenant] = useState<string>("");
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [showInactive, setShowInactive] = useState(false);

  const weekStart = useMemo(() => currentWeekStart(), []);
  const didGenerateRef = useRef(false);

  // Phase 0 — render the contacts table ASAP.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [sts, pending, sc] = await Promise.all([fetchAllCSStatuses(), fetchPendingCSTasks(), fetchHealthScores()]);
        if (cancelled) return;
        setStatuses(sts);
        setPendingTasks(pending);
        setHealthScores(sc);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Phase 1 — snapshots feed the Cronologia chart and the weekly task generator.
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

  // Phase 2 — generate this week's tasks once snapshots are in.
  useEffect(() => {
    if (!snapshotsLoaded || didGenerateRef.current) return;
    if (snapshots.length === 0) return;
    const wkExists = pendingTasks.some((t) => t.week_start === weekStart);
    if (wkExists) { didGenerateRef.current = true; return; }
    didGenerateRef.current = true;
    let cancelled = false;
    const idle: (cb: () => void) => void =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      typeof (window as any).requestIdleCallback === "function"
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ? (cb) => (window as any).requestIdleCallback(cb, { timeout: 2000 })
        : (cb) => window.setTimeout(cb, 250);
    idle(async () => {
      try {
        await generateWeeklyTasks(snapshots, statuses, weekStart);
        if (!cancelled) {
          const refreshed = await fetchPendingCSTasks();
          if (!cancelled) setPendingTasks(refreshed);
        }
      } catch (err) {
        console.error("[cs/tasks] weekly task generation failed", err);
      }
    });
    return () => { cancelled = true; };
  }, [snapshotsLoaded, snapshots, statuses, pendingTasks, weekStart]);

  // Per-tenant indices (sorted ascending so downstream skips re-sorting).
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
    for (const arr of m.values()) arr.sort((a, b) => (a.recorded_at ?? "").localeCompare(b.recorded_at ?? ""));
    return m;
  }, [statuses]);

  const pendingByTenant = useMemo(() => {
    const m = new Map<string, CSTask[]>();
    pendingTasks.forEach((t) => {
      if (!m.has(t.tenant_name)) m.set(t.tenant_name, []);
      m.get(t.tenant_name)!.push(t);
    });
    return m;
  }, [pendingTasks]);

  const tenantNames = useMemo(
    () => Array.from(tenantHistory.keys()).sort((a, b) => a.localeCompare(b)),
    [tenantHistory],
  );

  useEffect(() => {
    if (chartMode === "tenant" && !selectedTenant && tenantNames.length > 0) {
      setSelectedTenant(tenantNames[0]);
    }
  }, [chartMode, selectedTenant, tenantNames]);

  const excluded = useMemo(() => excludedTenants(statuses), [statuses]);

  const series = useMemo(() => {
    if (snapshots.length === 0) return [];
    const base = chartMode === "tenant" && selectedTenant
      ? snapshots.filter((s) => s.tenant_name === selectedTenant)
      : snapshots.filter((s) => !excluded.has(s.tenant_name));
    const byPeriod = new Map<string, { games: number; gmv_all: number; revenue: number; activeClubs: Set<string> }>();
    base.forEach((s) => {
      const cur = byPeriod.get(s.period) ?? { games: 0, gmv_all: 0, revenue: 0, activeClubs: new Set<string>() };
      cur.games += Number(s.games_online ?? 0);
      cur.gmv_all += Number(s.gmv_all ?? 0);
      cur.revenue += Number(s.revenue ?? 0);
      if (Number(s.gmv_all ?? 0) > 0) cur.activeClubs.add(s.tenant_name);
      byPeriod.set(s.period, cur);
    });
    const all = Array.from(byPeriod.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([period, v]) => ({
        period,
        label: periodShort(period),
        games: v.games,
        gmv_all: Math.round(v.gmv_all),
        revenue: Math.round(v.revenue),
        activeClubs: v.activeClubs.size,
      }));
    return all.length > 24 ? all.slice(-24) : all;
  }, [snapshots, chartMode, selectedTenant, excluded]);

  // Build per-club rows from pending tasks. Split pending into "this week" and
  // "overdue" (week_start < current week_start).
  type Row = {
    name: string;
    score: number;
    prevScore: number | null;
    scoreDelta: number | null;
    level: "high" | "medium" | "healthy";
    pending: CSTask[];   // this week's tasks
    overdue: CSTask[];   // earlier weeks still pending
  };

  const rows: Row[] = useMemo(() => {
    const list: Row[] = [];
    for (const [name, all] of pendingByTenant) {
      const hist = tenantHistory.get(name) ?? [];
      const sts = tenantStatuses.get(name) ?? [];
      const sd = scoreWithDelta(hist, sts, healthScores.get(name) ?? null, null);
      const thisWeek = all.filter((t) => t.week_start === weekStart);
      const overdue = all.filter((t) => t.week_start < weekStart);
      list.push({
        name,
        score: sd.score,
        prevScore: sd.prevScore,
        scoreDelta: sd.delta,
        level: sd.level,
        pending: thisWeek,
        overdue,
      });
    }
    return list.sort((a, b) => a.score - b.score);
  }, [pendingByTenant, tenantHistory, tenantStatuses, healthScores, weekStart]);

  // Rows shown in the main "this week" table — anyone with at least one task
  // for this week. Clubs that only have overdue tasks live in the overdue panel.
  const thisWeekRows = useMemo(() => rows.filter((r) => r.pending.length > 0), [rows]);
  const overdueOnlyRows = useMemo(
    () => rows.filter((r) => r.pending.length === 0 && r.overdue.length > 0),
    [rows],
  );

  const visibleRows = useMemo(
    () => showInactive ? thisWeekRows : thisWeekRows.filter((r) => !excluded.has(r.name)),
    [thisWeekRows, excluded, showInactive],
  );
  const visibleOverdueOnly = useMemo(
    () => showInactive ? overdueOnlyRows : overdueOnlyRows.filter((r) => !excluded.has(r.name)),
    [overdueOnlyRows, excluded, showInactive],
  );
  const inactiveRowsCount = thisWeekRows.filter((r) => excluded.has(r.name)).length;

  const [overdueOpen, setOverdueOpen] = useState(true);

  const [expanded, setExpanded] = useState<string | null>(null);

  async function reloadPending() {
    const p = await fetchPendingCSTasks();
    setPendingTasks(p);
  }

  async function handleClubComplete(tenant: string, taskIds: string[], outcome: string, note: string | null) {
    await completeCSTasksBatch(tenant, taskIds, outcome, note);
    await reloadPending();
    setExpanded(null);
  }

  async function handleClubPostpone(taskIds: string[], target: string) {
    for (const id of taskIds) await postponeCSTask(id, target);
    await reloadPending();
    setExpanded(null);
  }

  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const activeClubNames = useMemo(
    () => tenantNames.filter((n) => !excluded.has(n)),
    [tenantNames, excluded],
  );

  if (loading) return (
    <div className="p-10 text-muted-foreground">A carregar…</div>
  );


  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1400px] mx-auto pb-24 md:pb-8">
        <header className="mb-6 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Customer Success</h1>
            <p className="text-sm text-muted-foreground mt-1">Tendências e plano de contactos.</p>
          </div>
          <button
            onClick={() => setNewTaskOpen(true)}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-foreground text-background px-4 min-h-11 sm:min-h-9 text-sm font-medium hover:opacity-90 w-full sm:w-auto"
          >
            <Plus className="h-4 w-4" /> Nova tarefa
          </button>
        </header>

        <NewTaskDialog
          open={newTaskOpen}
          onClose={() => setNewTaskOpen(false)}
          activeClubs={activeClubNames}
          onCreated={reloadPending}
        />

        {/* Cronologia (deferred until snapshots load) */}
        <section className="rounded-xl border border-border p-5 mb-8">
          <div className="flex items-end justify-between gap-4 flex-wrap mb-4">
            <div>
              <h2 className="text-base font-semibold">Cronologia</h2>
              <p className="text-xs text-muted-foreground mt-1">
                {chartMode === "aggregate" ? "Todos os tenants combinados" : `Tenant: ${selectedTenant || "—"}`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="inline-flex rounded-md border border-border bg-background p-0.5">
                <button
                  onClick={() => setChartMode("aggregate")}
                  className={`px-3 py-1.5 text-xs rounded ${chartMode === "aggregate" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
                >Agregado</button>
                <button
                  onClick={() => setChartMode("tenant")}
                  className={`px-3 py-1.5 text-xs rounded ${chartMode === "tenant" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
                >Por tenant</button>
              </div>
              {chartMode === "tenant" && (
                <select
                  value={selectedTenant}
                  onChange={(e) => setSelectedTenant(e.target.value)}
                  className="px-3 py-1.5 rounded-md border border-border bg-background text-xs min-w-44"
                >
                  {tenantNames.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              )}
            </div>
          </div>

          <div className="h-72">
            {!snapshotsLoaded ? (
              <div className="h-full bg-surface/40 rounded animate-pulse" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={series} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.93 0.01 250)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="oklch(0.6 0.02 250)" />
                  <YAxis yAxisId="left" tick={{ fontSize: 11 }} stroke="oklch(0.6 0.02 250)" tickFormatter={(v) => formatNumber(Number(v))} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} stroke="oklch(0.6 0.02 250)" tickFormatter={(v) => `€${Math.round(Number(v) / 1000)}k`} />
                  <Tooltip
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid oklch(0.93 0.01 250)" }}
                    formatter={(v, name) => name === "Jogos online" || name === "Clubes ativos" ? formatNumber(Number(v)) : formatEuro(Number(v))}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line yAxisId="left" type="monotone" dataKey="games" name="Jogos online" stroke="oklch(0.18 0.02 250)" strokeWidth={2} dot={{ r: 2 }} />
                  {chartMode === "aggregate" && (
                    <Line yAxisId="left" type="monotone" dataKey="activeClubs" name="Clubes ativos" stroke="oklch(0.6 0.18 200)" strokeWidth={2} dot={{ r: 2 }} />
                  )}
                  <Line yAxisId="right" type="monotone" dataKey="gmv_all" name="GMV total" stroke="oklch(0.55 0.18 260)" strokeWidth={2} dot={{ r: 2 }} />
                  <Line yAxisId="right" type="monotone" dataKey="revenue" name="Receita" stroke="oklch(0.65 0.18 145)" strokeWidth={2} dot={{ r: 2 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>

        {/* Tarefas pendentes */}
        {/* Atrasadas — pending tasks from previous weeks for clubs that don't
            also have a current-week task. Clubs with both render in the main
            table below and merge their overdue bullets there. */}
        {visibleOverdueOnly.length > 0 && (
          <section className="rounded-xl border border-danger/40 bg-danger/5 overflow-hidden mb-6">
            <button
              type="button"
              onClick={() => setOverdueOpen((v) => !v)}
              className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-danger/10"
            >
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-danger" />
                <h2 className="text-base font-semibold text-danger">
                  ⚠ Atrasadas · {visibleOverdueOnly.length} {visibleOverdueOnly.length === 1 ? "clube" : "clubes"}
                </h2>
              </div>
              {overdueOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
            {overdueOpen && (
              <div className="border-t border-danger/30">
                <ul className="divide-y divide-danger/20">
                  {visibleOverdueOnly.map((r) => {
                    const isOpen = expanded === `overdue:${r.name}`;
                    return (
                      <li key={r.name} className="px-5 py-3">
                        <button
                          type="button"
                          onClick={() => setExpanded(isOpen ? null : `overdue:${r.name}`)}
                          className="w-full flex items-center justify-between gap-3 text-left"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <ClubLink name={r.name} className="font-semibold hover:underline truncate" />
                            <RiskBadge level={r.level} score={r.score} />
                            <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-danger/15 text-danger font-medium">
                              {r.overdue.length} atrasada{r.overdue.length === 1 ? "" : "s"}
                            </span>
                          </div>
                          {isOpen ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                        </button>
                        {isOpen && (
                          <div className="mt-3">
                            <ExpandedClubPanel
                              row={{ name: r.name, pending: [], overdue: r.overdue }}
                              onComplete={handleClubComplete}
                              onPostpone={handleClubPostpone}
                            />
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </section>
        )}

        <section className="rounded-xl border border-border overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <ListChecks className="h-4 w-4" />
              <h2 className="text-base font-semibold">Tarefas pendentes</h2>
            </div>
            {inactiveRowsCount > 0 && (
              <button
                onClick={() => setShowInactive((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-surface"
              >
                {showInactive ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {showInactive ? "Ocultar inativos" : `Mostrar inativos (${inactiveRowsCount})`}
              </button>
            )}
          </div>

          <div className="p-5">
            {visibleRows.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-8">
                Sem clubes com tarefas pendentes.
              </div>
            ) : (
              <div className="rounded-lg border border-border overflow-hidden">
                <DataTable<typeof rows[number]>
                  rows={visibleRows}
                  rowKey={(r) => r.name}
                  defaultSort={{ key: "score", dir: "desc" }}
                  pageSize={50}
                  onRowClick={(r) => setExpanded(expanded === r.name ? null : r.name)}
                  rowClassName={(r) => expanded === r.name ? "bg-surface/40" : ""}
                  selectable
                  selectedKeys={selectedKeys}
                  onSelectionChange={setSelectedKeys}
                  isRowSelectable={(r) => r.pending.length > 0}
                  expandedRow={(r) => expanded === r.name ? (
                    <ExpandedClubPanel row={r} onComplete={handleClubComplete} onPostpone={handleClubPostpone} />
                  ) : null}
                  columns={[
                    {
                      key: "name", header: "Clube",
                      sortValue: (r) => r.name,
                      filterValue: (r) => r.name, filter: { kind: "text" },
                      render: (r) => (<ClubLink name={r.name} className="font-semibold hover:underline" />),
                    },
                    {
                      key: "score", header: "Saúde",
                      sortValue: (r) => r.score,
                      filter: { kind: "select", options: [
                        { value: "high", label: "Alto" }, { value: "medium", label: "Médio" }, { value: "healthy", label: "Saudável" },
                      ]},
                      filterValue: (r) => r.level,
                      render: (r) => (
                        <span className="inline-flex items-center gap-1.5">
                          <RiskBadge level={r.level} score={r.score} />
                          <ScoreDelta delta={r.scoreDelta} previous={r.prevScore} current={r.score} />
                        </span>
                      ),
                    },
                    {
                      key: "pending", header: "Pendentes",
                      sortValue: (r) => r.pending.length,
                      render: (r) => (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-danger/10 text-danger font-medium">
                          {r.pending.length} pendentes
                        </span>
                      ),
                    },
                    {
                      key: "expand", header: "",
                      align: "right",
                      render: (r) => expanded === r.name
                        ? <ChevronDown className="h-4 w-4 inline" />
                        : <ChevronRight className="h-4 w-4 inline" />,
                    },
                  ]}
                />
              </div>
            )}
          </div>
        </section>

        {selectedKeys.size > 0 && (
          <BulkCompleteBar
            count={selectedKeys.size}
            onApply={async (outcome, note) => {
              const names = Array.from(selectedKeys);
              for (const name of names) {
                const r = rows.find((x) => x.name === name);
                if (!r) continue;
                for (const t of r.pending) {
                  await completeCSTask(t.id, t.tenant_name, outcome, note.trim() || null);
                }
              }
              setSelectedKeys(new Set());
              await reloadPending();
            }}
            onCancel={() => setSelectedKeys(new Set())}
          />
        )}
    </div>
  );
}

function ExpandedClubPanel({
  row, onComplete, onPostpone,
}: {
  row: { name: string; pending: CSTask[]; overdue?: CSTask[] };
  onComplete: (tenant: string, taskIds: string[], outcome: string, note: string | null) => Promise<void>;
  onPostpone?: (taskIds: string[], target: string) => Promise<void>;
}) {
  const [outcome, setOutcome] = useState(OUTCOME_OPTIONS[0].value);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [postponeOpen, setPostponeOpen] = useState(false);
  const [postponeTarget, setPostponeTarget] = useState<string>(() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 7);
    return currentWeekStart(d);
  });

  const overdueTasks = row.overdue ?? [];
  const tasks = [...row.pending, ...overdueTasks];

  async function handleComplete() {
    if (tasks.length === 0) return;
    setBusy(true);
    try {
      const n = note.trim();
      await onComplete(
        tasks[0].tenant_name,
        tasks.map((t) => t.id),
        outcome,
        n.length > 0 ? n : null,
      );
      setNote("");
    } finally {
      setBusy(false);
    }
  }

  // Build a flat list of {reason, cta, isOverdue} bullets across every pending task for this club.
  // Tasks are generated with one line per flag joined by "\n", so split back out.
  type Bullet = { reason: string; cta: string; flags: string[]; isOverdue: boolean; weekStart: string };
  const bullets: Bullet[] = [];
  const buildBullets = (taskList: CSTask[], isOverdue: boolean) => {
    for (const t of taskList) {
      const reasons = (t.reason ?? "").split("\n").filter((s) => s.trim().length > 0);
      const ctas = (t.cta ?? "").split("\n").filter((s) => s.trim().length > 0);
      const flags = t.flags ?? [];
      const n = Math.max(reasons.length, ctas.length, 1);
      for (let i = 0; i < n; i++) {
        bullets.push({
          reason: reasons[i] ?? reasons[0] ?? "",
          cta: ctas[i] ?? ctas[0] ?? "",
          flags: flags[i] ? [flags[i]] : [],
          isOverdue,
          weekStart: t.week_start,
        });
      }
    }
  };
  buildBullets(row.pending, false);
  buildBullets(overdueTasks, true);

  return (
    <div className="space-y-3" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-end gap-3 -mt-1">
        <ClubLink
          name={row.name}
          className="inline-flex items-center gap-1 text-xs font-medium text-foreground hover:underline"
        >
          Ver perfil do clube <ArrowRight className="h-3 w-3" />
        </ClubLink>
      </div>

      <div className="rounded-md border border-border bg-background">
        <div className="px-4 py-3 border-b border-border">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">
            Tarefas pendentes ({tasks.length})
            {overdueTasks.length > 0 && (
              <span className="ml-1 text-danger">· {overdueTasks.length} atrasada{overdueTasks.length === 1 ? "" : "s"}</span>
            )}
          </div>
          {bullets.length === 0 ? (
            <div className="text-xs text-muted-foreground">Sem detalhes disponíveis.</div>
          ) : (
            <ul className="space-y-2">
              {bullets.map((b, i) => {
                const flag = b.flags[0] as RiskFlag | undefined;
                const meta = flag ? FLAG_META[flag] : undefined;
                return (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <span className={b.isOverdue ? "text-danger mt-1" : "text-muted-foreground mt-1"}>•</span>
                    <div className="min-w-0">
                      <div className="font-medium flex items-center gap-2 flex-wrap">
                        <span>{meta?.label ?? b.reason}</span>
                        {b.isOverdue && (
                          <span className="inline-flex items-center text-[10px] uppercase font-semibold text-danger bg-danger/10 px-1.5 py-0.5 rounded-full">
                            Atrasada
                          </span>
                        )}
                      </div>
                      {meta && b.reason && (
                        <div className="text-xs text-muted-foreground mt-0.5">{b.reason}</div>
                      )}
                      {b.cta && (
                        <div className="text-xs text-muted-foreground/80 mt-0.5 italic">→ {b.cta}</div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="px-4 py-3 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Resultado</label>
            <select
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
              className="px-2 py-1 rounded-md border border-border bg-background text-xs"
            >
              {OUTCOME_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Comentário (opcional, fica no histórico)
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Notas sobre o contacto…"
              rows={2}
              className="mt-1 w-full px-2 py-1.5 rounded-md border border-border bg-background text-xs resize-y"
            />
          </div>
          <div className="flex items-center justify-between gap-2 pt-1 flex-wrap">
            {onPostpone ? (
              postponeOpen ? (
                <div className="flex items-center gap-2 flex-wrap">
                  <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Adiar para</label>
                  <input
                    type="date"
                    value={postponeTarget}
                    onChange={(e) => setPostponeTarget(e.target.value)}
                    className="px-2 py-1 rounded-md border border-border bg-background text-xs"
                  />
                  <span className="text-[10px] text-muted-foreground">
                    → semana de {currentWeekStart(new Date(postponeTarget))}
                  </span>
                  <button
                    type="button"
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await onPostpone(tasks.map((t) => t.id), postponeTarget);
                        setPostponeOpen(false);
                      } finally { setBusy(false); }
                    }}
                    disabled={busy}
                    className="px-2.5 py-1 text-[11px] rounded-md bg-foreground text-background font-medium disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-1"
                  >
                    <Clock className="h-3 w-3" /> {busy ? "A guardar…" : "Confirmar adiar"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPostponeOpen(false)}
                    className="text-[11px] text-muted-foreground hover:text-foreground"
                  >Cancelar</button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setPostponeOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-surface text-muted-foreground"
                  title="Adiar todas as tarefas para outra semana"
                >
                  <Clock className="h-3.5 w-3.5" /> Adiar todas
                </button>
              )
            ) : <span />}
            <button
              onClick={handleComplete}
              disabled={busy || tasks.length === 0}
              className="px-3 py-1.5 text-xs rounded-md bg-foreground text-background font-medium disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-1.5"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              {busy ? "A guardar…" : `Marcar ${tasks.length === 1 ? "como feita" : `as ${tasks.length} como feitas`}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function formatFlagsLabel(flags: string[] | null | undefined): string {
  if (!flags || flags.length === 0) return "—";
  return flags.map((f) => FLAG_META[f as RiskFlag]?.label ?? f).join(" + ");
}

async function generateWeeklyTasks(snapshots: Snapshot[], statuses: CSTenantStatus[], weekStart: string) {
  const histByTenant = new Map<string, Snapshot[]>();
  snapshots.forEach((s) => {
    if (!histByTenant.has(s.tenant_name)) histByTenant.set(s.tenant_name, []);
    histByTenant.get(s.tenant_name)!.push(s);
  });
  const statusByTenant = new Map<string, CSTenantStatus[]>();
  statuses.forEach((s) => {
    if (!statusByTenant.has(s.tenant_name)) statusByTenant.set(s.tenant_name, []);
    statusByTenant.get(s.tenant_name)!.push(s);
  });

  const latest = snapshots.reduce<string>((acc, s) => (s.period > acc ? s.period : acc), "");
  if (!latest) return;

  const tasks: { tenant_name: string; reason: string; cta: string; priority: number; flags: string[]; week_start: string }[] = [];
  for (const [name, hist] of histByTenant) {
    if (!hist.some((s) => s.period === latest)) continue;
    const stats = statusByTenant.get(name) ?? [];
    const risk = computeRiskWithCS(hist, stats);
    if (risk.suppressed) continue;
    if (risk.flags.length === 0) continue;
    const reason = risk.flags.map((f) => FLAG_CTA[f].reason).join("\n");
    const cta = risk.flags.map((f) => FLAG_CTA[f].cta).join("\n");
    tasks.push({
      tenant_name: name,
      reason,
      cta,
      priority: risk.score,
      flags: [...risk.flags],
      week_start: weekStart,
    });
  }

  if (tasks.length > 0) await insertCSTasks(tasks);
}

function BulkCompleteBar({
  count, onApply, onCancel,
}: {
  count: number;
  onApply: (outcome: string, note: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [outcome, setOutcome] = useState(OUTCOME_OPTIONS[0].value);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div
      className="fixed left-0 right-0 bottom-0 z-40 lg:left-60 border-t border-border bg-background/95 backdrop-blur shadow-lg"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-auto max-w-[1400px] px-4 py-3 flex items-center gap-3 flex-wrap">
        <span className="text-sm font-medium">
          {count} {count === 1 ? "clube selecionado" : "clubes selecionados"}
        </span>
        <div className="flex items-center gap-2 flex-wrap ml-auto">
          <select
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            className="px-2 py-1.5 text-base sm:text-sm rounded-md border border-border bg-background"
          >
            {OUTCOME_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Nota opcional…"
            className="px-2 py-1.5 text-base sm:text-sm rounded-md border border-border bg-background min-w-[180px]"
          />
          <button
            onClick={async () => {
              setBusy(true);
              try { await onApply(outcome, note); } finally { setBusy(false); }
            }}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md bg-foreground text-background px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            <CheckCircle2 className="h-4 w-4" /> {busy ? "A guardar…" : "Marcar todas como feitas"}
          </button>
          <button onClick={onCancel} className="text-sm text-muted-foreground hover:text-foreground px-2 py-2">Cancelar</button>
        </div>
      </div>
    </div>
  );
}
