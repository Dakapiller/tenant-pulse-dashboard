import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import { fetchAllSnapshots, type Snapshot } from "@/lib/data";
import {
  fetchAllCSStatuses,
  fetchCSTasksForWeek,
  fetchAllCSTasks,
  insertCSTasks,
  completeCSTask,
  currentWeekStart,
  outcomeLabel,
  OUTCOME_OPTIONS,
  type CSTenantStatus,
  type CSTask,
} from "@/lib/cs";
import { computeRiskWithCS, FLAG_CTA, FLAG_META, type RiskFlag } from "@/lib/risk";
import { formatEuro, formatNumber, periodShort, periodLabel } from "@/lib/format";
import { CheckCircle2, ChevronDown, ChevronRight, ListChecks, ArrowUpRight } from "lucide-react";

export const Route = createFileRoute("/cs")({
  component: CSPage,
});

function CSPage() {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [statuses, setStatuses] = useState<CSTenantStatus[]>([]);
  const [weekTasks, setWeekTasks] = useState<CSTask[]>([]);
  const [allTasks, setAllTasks] = useState<CSTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"week" | "history">("week");
  const [chartMode, setChartMode] = useState<"aggregate" | "tenant">("aggregate");
  const [selectedTenant, setSelectedTenant] = useState<string>("");

  const weekStart = useMemo(() => currentWeekStart(), []);

  async function loadAll() {
    const [snaps, sts, wt, at] = await Promise.all([
      fetchAllSnapshots(),
      fetchAllCSStatuses(),
      fetchCSTasksForWeek(weekStart),
      fetchAllCSTasks(),
    ]);
    setSnapshots(snaps);
    setStatuses(sts);
    setWeekTasks(wt);
    setAllTasks(at);
    return { snaps, sts, wt };
  }

  useEffect(() => {
    (async () => {
      try {
        const { snaps, sts, wt } = await loadAll();
        // Generate this week's tasks if none yet
        if (wt.length === 0) {
          await generateWeeklyTasks(snaps, sts, weekStart);
          await loadAll();
        }
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Per-tenant data
  const tenantHistory = useMemo(() => {
    const m = new Map<string, Snapshot[]>();
    snapshots.forEach((s) => {
      if (!m.has(s.tenant_name)) m.set(s.tenant_name, []);
      m.get(s.tenant_name)!.push(s);
    });
    return m;
  }, [snapshots]);

  const tenantStatuses = useMemo(() => {
    const m = new Map<string, CSTenantStatus[]>();
    statuses.forEach((s) => {
      if (!m.has(s.tenant_name)) m.set(s.tenant_name, []);
      m.get(s.tenant_name)!.push(s);
    });
    return m;
  }, [statuses]);

  const tenantNames = useMemo(
    () => Array.from(tenantHistory.keys()).sort((a, b) => a.localeCompare(b)),
    [tenantHistory],
  );

  useEffect(() => {
    if (chartMode === "tenant" && !selectedTenant && tenantNames.length > 0) {
      setSelectedTenant(tenantNames[0]);
    }
  }, [chartMode, selectedTenant, tenantNames]);

  // Build monthly timeline series
  const series = useMemo(() => {
    const filtered = chartMode === "tenant" && selectedTenant
      ? snapshots.filter((s) => s.tenant_name === selectedTenant)
      : snapshots;
    const byPeriod = new Map<string, { games: number; gmv_all: number; revenue: number }>();
    filtered.forEach((s) => {
      const cur = byPeriod.get(s.period) ?? { games: 0, gmv_all: 0, revenue: 0 };
      cur.games += Number(s.games_online ?? 0);
      cur.gmv_all += Number(s.gmv_all ?? 0);
      cur.revenue += Number(s.revenue ?? 0);
      byPeriod.set(s.period, cur);
    });
    const arr = Array.from(byPeriod.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([period, v]) => ({
        period,
        label: periodShort(period),
        games: v.games,
        gmv_all: Math.round(v.gmv_all),
        revenue: Math.round(v.revenue),
      }));
    return arr;
  }, [snapshots, chartMode, selectedTenant]);

  // YoY pairs
  const yoyPairs = useMemo(() => {
    const map = new Map(series.map((p) => [p.period, p]));
    const pairs: { current: typeof series[number]; prior: typeof series[number] }[] = [];
    for (const cur of series) {
      const d = new Date(cur.period);
      const prior = new Date(Date.UTC(d.getUTCFullYear() - 1, d.getUTCMonth(), d.getUTCDate()))
        .toISOString().slice(0, 10);
      const p = map.get(prior);
      if (p) pairs.push({ current: cur, prior: p });
    }
    return pairs;
  }, [series]);

  // Tasks split
  const pendingTasks = useMemo(
    () => weekTasks.filter((t) => t.status === "pending").sort((a, b) => b.priority - a.priority),
    [weekTasks],
  );
  const completedThisWeek = useMemo(
    () => weekTasks.filter((t) => t.status === "completed").sort((a, b) =>
      (b.completed_at ?? "").localeCompare(a.completed_at ?? "")),
    [weekTasks],
  );
  const historyTasks = useMemo(
    () => allTasks.filter((t) => t.status === "completed" && t.week_start !== weekStart),
    [allTasks, weekStart],
  );

  const grouped = useMemo(() => {
    const high: typeof pendingTasks = [];
    const medium: typeof pendingTasks = [];
    pendingTasks.forEach((t) => {
      if (t.priority >= 60) high.push(t);
      else medium.push(t);
    });
    return { high, medium };
  }, [pendingTasks]);

  async function handleComplete(task: CSTask, outcome: string, note: string) {
    await completeCSTask(task.id, task.tenant_name, outcome, note.trim() || null);
    await loadAll();
  }

  if (loading) return <div className="p-10 text-muted-foreground">Loading…</div>;

  return (
    <div className="p-8 max-w-[1400px] mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Customer Success</h1>
        <p className="text-sm text-muted-foreground mt-1">YoY trends and weekly outreach plan.</p>
      </header>

      {/* SECTION A — TIMELINE */}
      <section className="rounded-xl border border-border p-5 mb-8">
        <div className="flex items-end justify-between gap-4 flex-wrap mb-4">
          <div>
            <h2 className="text-base font-semibold">Timeline</h2>
            <p className="text-xs text-muted-foreground mt-1">
              {chartMode === "aggregate" ? "All tenants combined" : `Tenant: ${selectedTenant || "—"}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-md border border-border bg-background p-0.5">
              <button
                onClick={() => setChartMode("aggregate")}
                className={`px-3 py-1.5 text-xs rounded ${chartMode === "aggregate" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
              >Aggregate</button>
              <button
                onClick={() => setChartMode("tenant")}
                className={`px-3 py-1.5 text-xs rounded ${chartMode === "tenant" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
              >Per-tenant</button>
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
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.93 0.01 250)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="oklch(0.6 0.02 250)" />
              <YAxis yAxisId="left" tick={{ fontSize: 11 }} stroke="oklch(0.6 0.02 250)" tickFormatter={(v) => formatNumber(Number(v))} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} stroke="oklch(0.6 0.02 250)" tickFormatter={(v) => `€${Math.round(Number(v) / 1000)}k`} />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid oklch(0.93 0.01 250)" }}
                formatter={(v, name) => {
                  if (name === "Games online") return formatNumber(Number(v));
                  return formatEuro(Number(v));
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line yAxisId="left" type="monotone" dataKey="games" name="Games online" stroke="oklch(0.18 0.02 250)" strokeWidth={2} dot={{ r: 2 }} />
              <Line yAxisId="right" type="monotone" dataKey="gmv_all" name="GMV all" stroke="oklch(0.55 0.18 260)" strokeWidth={2} dot={{ r: 2 }} />
              <Line yAxisId="right" type="monotone" dataKey="revenue" name="Revenue" stroke="oklch(0.65 0.18 145)" strokeWidth={2} dot={{ r: 2 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* YoY badges */}
        {yoyPairs.length > 0 && (
          <div className="mt-5">
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Year-over-year</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {yoyPairs.map(({ current, prior }) => (
                <div key={current.period} className="rounded-md border border-border p-3 text-xs">
                  <div className="font-medium mb-1.5">{periodShort(current.period)} vs {periodShort(prior.period)}</div>
                  <div className="flex flex-wrap gap-1.5">
                    <YoyBadge label="Games" cur={current.games} prev={prior.games} />
                    <YoyBadge label="GMV" cur={current.gmv_all} prev={prior.gmv_all} />
                    <YoyBadge label="Rev" cur={current.revenue} prev={prior.revenue} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* SECTION B — WEEKLY TODOS */}
      <section className="rounded-xl border border-border overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <ListChecks className="h-4 w-4" />
            <h2 className="text-base font-semibold">Weekly outreach</h2>
            <span className="text-xs text-muted-foreground">Week of {periodLabel(weekStart)}</span>
          </div>
          <div className="inline-flex rounded-md border border-border p-0.5 bg-background">
            <button onClick={() => setTab("week")} className={`px-3 py-1.5 text-xs rounded ${tab === "week" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}>This week</button>
            <button onClick={() => setTab("history")} className={`px-3 py-1.5 text-xs rounded ${tab === "history" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}>History</button>
          </div>
        </div>

        {tab === "week" ? (
          <div className="p-5 space-y-6">
            {pendingTasks.length === 0 && completedThisWeek.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-8">
                No tasks generated for this week. All tenants healthy or suppressed.
              </div>
            ) : null}

            {grouped.high.length > 0 && (
              <TaskGroup level="high" tasks={grouped.high} statuses={tenantStatuses} histories={tenantHistory} onComplete={handleComplete} />
            )}
            {grouped.medium.length > 0 && (
              <TaskGroup level="medium" tasks={grouped.medium} statuses={tenantStatuses} histories={tenantHistory} onComplete={handleComplete} />
            )}

            {completedThisWeek.length > 0 && (
              <Collapsible title={`Completed this week (${completedThisWeek.length})`}>
                <ul className="divide-y divide-border">
                  {completedThisWeek.map((t) => (
                    <li key={t.id} className="py-2 flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2 min-w-0">
                        <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                        <Link to="/tenant/$name" params={{ name: t.tenant_name }} className="font-medium hover:underline truncate">{t.tenant_name}</Link>
                        <span className="text-muted-foreground truncate">— {t.reason}</span>
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0 ml-3">{outcomeLabel(t.outcome)}</span>
                    </li>
                  ))}
                </ul>
              </Collapsible>
            )}
          </div>
        ) : (
          <div className="p-5">
            {historyTasks.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-8">No completed tasks from prior weeks.</div>
            ) : (
              <ul className="divide-y divide-border">
                {historyTasks.map((t) => (
                  <li key={t.id} className="py-3 flex items-start justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Link to="/tenant/$name" params={{ name: t.tenant_name }} className="font-medium hover:underline">{t.tenant_name}</Link>
                        <span className="text-xs text-muted-foreground">Week of {periodLabel(t.week_start)}</span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">{t.reason}</div>
                    </div>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-surface shrink-0">{outcomeLabel(t.outcome)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function YoyBadge({ label, cur, prev }: { label: string; cur: number; prev: number }) {
  if (prev === 0) return null;
  const diff = ((cur - prev) / Math.abs(prev)) * 100;
  const positive = diff >= 0;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${positive ? "bg-success/10 text-success" : "bg-danger/10 text-danger"}`}>
      {label} {positive ? "+" : ""}{diff.toFixed(1)}%
    </span>
  );
}

function TaskGroup({
  level, tasks, statuses, histories, onComplete,
}: {
  level: "high" | "medium";
  tasks: CSTask[];
  statuses: Map<string, CSTenantStatus[]>;
  histories: Map<string, Snapshot[]>;
  onComplete: (t: CSTask, outcome: string, note: string) => Promise<void>;
}) {
  const tone = level === "high"
    ? { header: "bg-danger/10 text-danger border-danger/30", label: "High risk" }
    : { header: "bg-warning/15 text-warning border-warning/30", label: "Medium risk" };
  return (
    <div>
      <div className={`inline-flex items-center gap-2 rounded-md border px-3 py-1 text-xs font-medium mb-3 ${tone.header}`}>
        <span className="h-1.5 w-1.5 rounded-full bg-current" />
        {tone.label} · {tasks.length}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {tasks.map((t) => {
          const tenantSnaps = histories.get(t.tenant_name) ?? [];
          const tenantStatus = statuses.get(t.tenant_name) ?? [];
          const live = computeRiskWithCS(tenantSnaps, tenantStatus);
          return <TaskCard key={t.id} task={t} score={live.score} onComplete={onComplete} />;
        })}
      </div>
    </div>
  );
}

function TaskCard({ task, score, onComplete }: { task: CSTask; score: number; onComplete: (t: CSTask, outcome: string, note: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState(OUTCOME_OPTIONS[0].value);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const tone = score >= 60 ? { text: "text-danger", bg: "bg-danger/10" } : { text: "text-warning", bg: "bg-warning/15" };

  return (
    <div className="rounded-xl border border-border bg-background p-4 flex flex-col">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to="/tenant/$name" params={{ name: task.tenant_name }} className="font-semibold hover:underline inline-flex items-center gap-1">
            {task.tenant_name}
            <ArrowUpRight className="h-3.5 w-3.5 opacity-60" />
          </Link>
          <div className="mt-1 flex flex-wrap gap-1">
            {(task.flags ?? []).map((f) => (
              <span key={f} className="text-[10px] rounded-full bg-surface px-1.5 py-0.5">{FLAG_META[f as RiskFlag]?.label ?? f}</span>
            ))}
          </div>
        </div>
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${tone.bg} ${tone.text}`}>
          {score}
        </span>
      </div>

      <p className="text-sm mt-3">{task.reason}</p>
      <div className="mt-3 rounded-md bg-surface border border-border p-3 text-xs leading-relaxed">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Suggested action</div>
        {task.cta}
      </div>

      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="mt-4 inline-flex items-center justify-center gap-1.5 rounded-md bg-foreground text-background px-3 py-2 text-sm font-medium hover:opacity-90"
        >
          <CheckCircle2 className="h-4 w-4" /> Mark as done
        </button>
      ) : (
        <div className="mt-4 rounded-md border border-border p-3 space-y-2">
          <label className="block text-xs font-medium">Outcome</label>
          <select
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            className="w-full px-2 py-1.5 rounded-md border border-border bg-background text-sm"
          >
            {OUTCOME_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional note…"
            rows={2}
            className="w-full px-2 py-1.5 rounded-md border border-border bg-background text-sm"
          />
          <div className="flex gap-2 justify-end">
            <button onClick={() => setOpen(false)} className="px-3 py-1.5 text-xs rounded-md border border-border hover:bg-surface" disabled={busy}>Cancel</button>
            <button
              onClick={async () => {
                setBusy(true);
                try { await onComplete(task, outcome, note); } finally { setBusy(false); }
              }}
              disabled={busy}
              className="px-3 py-1.5 text-xs rounded-md bg-foreground text-background font-medium hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Saving…" : "Confirm"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Collapsible({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border border-border">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium hover:bg-surface">
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        {title}
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

// Generate weekly tasks from current data + statuses (called once per week if none exist)
async function generateWeeklyTasks(snapshots: Snapshot[], statuses: CSTenantStatus[], weekStart: string) {
  // Group
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

  // Latest period
  const latest = snapshots.reduce<string>((acc, s) => (s.period > acc ? s.period : acc), "");
  if (!latest) return;

  const tasks: { tenant_name: string; reason: string; cta: string; priority: number; flags: string[]; week_start: string }[] = [];
  for (const [name, hist] of histByTenant) {
    if (!hist.some((s) => s.period === latest)) continue;
    const stats = statusByTenant.get(name) ?? [];
    const risk = computeRiskWithCS(hist, stats);
    if (risk.suppressed) continue;
    if (risk.flags.length === 0) continue;
    for (const f of risk.flags) {
      const meta = FLAG_CTA[f];
      tasks.push({
        tenant_name: name,
        reason: meta.reason,
        cta: meta.cta,
        priority: risk.score, // overall score determines ordering
        flags: [f],
        week_start: weekStart,
      });
    }
  }

  if (tasks.length > 0) await insertCSTasks(tasks);
}
