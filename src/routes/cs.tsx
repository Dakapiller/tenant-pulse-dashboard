import { createFileRoute, Link } from "@tanstack/react-router";
import { Fragment, useEffect, useMemo, useState } from "react";
import { RiskBadge } from "./index";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import { fetchAllSnapshots, type Snapshot } from "@/lib/data";
import {
  fetchAllCSStatuses,
  fetchAllCSTasks,
  insertCSTasks,
  completeCSTask,
  currentWeekStart,
  outcomeLabel,
  lastCompletedActivityAt,
  scoreWithDelta,
  OUTCOME_OPTIONS,
  type CSTenantStatus,
  type CSTask,
} from "@/lib/cs";
import { computeRiskWithCS, FLAG_CTA, FLAG_META, type RiskFlag } from "@/lib/risk";
import { formatEuro, formatNumber, periodLabel, periodShort } from "@/lib/format";
import { DataTable, ScoreDelta, type ColumnDef } from "@/components/DataTable";
import { CheckCircle2, ChevronDown, ChevronRight, ListChecks } from "lucide-react";

export const Route = createFileRoute("/cs")({
  component: CSPage,
});

type RangeKey = "week" | "month" | "year";

function CSPage() {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [statuses, setStatuses] = useState<CSTenantStatus[]>([]);
  const [allTasks, setAllTasks] = useState<CSTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"contacts" | "history">("contacts");
  const [range, setRange] = useState<RangeKey>("week");

  const [chartMode, setChartMode] = useState<"aggregate" | "tenant">("aggregate");
  const [selectedTenant, setSelectedTenant] = useState<string>("");

  const weekStart = useMemo(() => currentWeekStart(), []);

  async function loadAll() {
    const [snaps, sts, at] = await Promise.all([
      fetchAllSnapshots(),
      fetchAllCSStatuses(),
      fetchAllCSTasks(),
    ]);
    setSnapshots(snaps);
    setStatuses(sts);
    setAllTasks(at);
    return { snaps, sts, at };
  }

  useEffect(() => {
    (async () => {
      try {
        const { snaps, sts, at } = await loadAll();
        // Generate this week's tasks if none yet
        const wk = at.filter((t) => t.week_start === weekStart);
        if (wk.length === 0) {
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
    const byPeriod = new Map<string, { games: number; gmv_all: number; revenue: number; activeClubs: Set<string> }>();
    filtered.forEach((s) => {
      const cur = byPeriod.get(s.period) ?? { games: 0, gmv_all: 0, revenue: 0, activeClubs: new Set<string>() };
      cur.games += Number(s.games_online ?? 0);
      cur.gmv_all += Number(s.gmv_all ?? 0);
      cur.revenue += Number(s.revenue ?? 0);
      if (Number(s.gmv_all ?? 0) > 0) cur.activeClubs.add(s.tenant_name);
      byPeriod.set(s.period, cur);
    });
    return Array.from(byPeriod.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([period, v]) => ({
        period,
        label: periodShort(period),
        games: v.games,
        gmv_all: Math.round(v.gmv_all),
        revenue: Math.round(v.revenue),
        activeClubs: v.activeClubs.size,
      }));
  }, [snapshots, chartMode, selectedTenant]);

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

  // Range bounds
  const rangeBounds = useMemo(() => {
    const now = new Date();
    let from: Date;
    if (range === "week") {
      // Monday of current week
      from = new Date(weekStart + "T00:00:00Z");
    } else if (range === "month") {
      from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    } else {
      from = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    }
    return { fromIso: from.toISOString() };
  }, [range, weekStart]);

  // Carry-over rule: pending tasks (week_start <= current week)
  // Completed: completed_at >= rangeBounds.fromIso
  const pendingTasks = useMemo(() => {
    return allTasks.filter((t) => t.status === "pending");
  }, [allTasks]);

  const completedInRange = useMemo(() => {
    return allTasks.filter((t) => t.status === "completed" && t.completed_at && t.completed_at >= rangeBounds.fromIso);
  }, [allTasks, rangeBounds.fromIso]);

  // Build per-club rows: clubs with pending OR recently completed in range
  type Row = {
    name: string;
    score: number;
    scoreDelta: number | null;
    level: "high" | "medium" | "healthy";
    pending: CSTask[];
    completed: CSTask[];
    lastContact: string | null;
  };

  const rows: Row[] = useMemo(() => {
    const map = new Map<string, Row>();
    const ensure = (name: string): Row => {
      let r = map.get(name);
      if (!r) {
        const hist = tenantHistory.get(name) ?? [];
        const sts = tenantStatuses.get(name) ?? [];
        const sd = scoreWithDelta(hist, sts);
        r = {
          name,
          score: sd.score,
          scoreDelta: sd.delta,
          level: sd.level,
          pending: [],
          completed: [],
          lastContact: lastCompletedActivityAt(allTasks.filter((t) => t.tenant_name === name)),
        };
        map.set(name, r);
      }
      return r;
    };
    pendingTasks.forEach((t) => ensure(t.tenant_name).pending.push(t));
    completedInRange.forEach((t) => ensure(t.tenant_name).completed.push(t));
    return Array.from(map.values()).sort((a, b) => {
      // pending desc, then score desc
      if ((b.pending.length > 0 ? 1 : 0) !== (a.pending.length > 0 ? 1 : 0)) {
        return (b.pending.length > 0 ? 1 : 0) - (a.pending.length > 0 ? 1 : 0);
      }
      return b.score - a.score;
    });
  }, [pendingTasks, completedInRange, tenantHistory, tenantStatuses, allTasks]);

  const historyTasks = useMemo(
    () => allTasks.filter((t) => t.status === "completed").sort((a, b) =>
      (b.completed_at ?? "").localeCompare(a.completed_at ?? "")),
    [allTasks],
  );

  const [expanded, setExpanded] = useState<string | null>(null);

  async function handleComplete(task: CSTask, outcome: string, note: string) {
    await completeCSTask(task.id, task.tenant_name, outcome, note.trim() || null);
    await loadAll();
  }

  if (loading) return <div className="p-10 text-muted-foreground">A carregar…</div>;

  return (
    <div className="p-8 max-w-[1400px] mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Customer Success</h1>
        <p className="text-sm text-muted-foreground mt-1">Tendências YoY e plano de contactos.</p>
      </header>

      {/* SECÇÃO A — TIMELINE */}
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
        </div>

        {yoyPairs.length > 0 && (
          <div className="mt-5">
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Comparação ano a ano</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {yoyPairs.map(({ current, prior }) => (
                <div key={current.period} className="rounded-md border border-border p-3 text-xs">
                  <div className="font-medium mb-1.5">{periodShort(current.period)} vs {periodShort(prior.period)}</div>
                  <div className="flex flex-wrap gap-1.5">
                    <YoyBadge label="Jogos" cur={current.games} prev={prior.games} />
                    <YoyBadge label="GMV" cur={current.gmv_all} prev={prior.gmv_all} />
                    <YoyBadge label="Rec." cur={current.revenue} prev={prior.revenue} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* SECTION B — CONTACTOS */}
      <section className="rounded-xl border border-border overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <ListChecks className="h-4 w-4" />
            <h2 className="text-base font-semibold">Contactos</h2>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-md border border-border p-0.5 bg-background">
              <button onClick={() => setTab("contacts")} className={`px-3 py-1.5 text-xs rounded ${tab === "contacts" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}>Contactos</button>
              <button onClick={() => setTab("history")} className={`px-3 py-1.5 text-xs rounded ${tab === "history" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}>Histórico</button>
            </div>
            {tab === "contacts" && (
              <div className="inline-flex rounded-md border border-border p-0.5 bg-background">
                {(["week", "month", "year"] as RangeKey[]).map((k) => (
                  <button
                    key={k}
                    onClick={() => setRange(k)}
                    className={`px-3 py-1.5 text-xs rounded ${range === k ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    {k === "week" ? "Esta semana" : k === "month" ? "Este mês" : "Este ano"}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {tab === "contacts" ? (
          <div className="p-5">
            {rows.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-8">
                Sem clubes com tarefas neste período.
              </div>
            ) : (
              <div className="rounded-lg border border-border overflow-hidden">
                <DataTable<typeof rows[number]>
                  rows={rows}
                  rowKey={(r) => r.name}
                  defaultSort={{ key: "score", dir: "desc" }}
                  onRowClick={(r) => setExpanded(expanded === r.name ? null : r.name)}
                  rowClassName={(r) => expanded === r.name ? "bg-surface/40" : ""}
                  columns={[
                    {
                      key: "name", header: "Clube",
                      sortValue: (r) => r.name,
                      filterValue: (r) => r.name, filter: { kind: "text" },
                      render: (r) => <span className="font-semibold">{r.name}</span>,
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
                          <ScoreDelta delta={r.scoreDelta} />
                        </span>
                      ),
                    },
                    {
                      key: "pending", header: "Pendentes",
                      sortValue: (r) => r.pending.length,
                      render: (r) => r.pending.length > 0 ? (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-danger/10 text-danger font-medium">
                          {r.pending.length} pendentes
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-success">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Concluído
                        </span>
                      ),
                    },
                    {
                      key: "lastContact", header: "Último contacto",
                      sortValue: (r) => r.lastContact ?? "",
                      render: (r) => (
                        <span className="text-xs text-muted-foreground">
                          {r.lastContact ? new Date(r.lastContact).toLocaleDateString("pt-PT") : "Nunca"}
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
                {expanded && rows.find((r) => r.name === expanded) && (
                  <div className="border-t border-border bg-surface/40 px-4 py-4">
                    <ExpandedClubPanel
                      row={rows.find((r) => r.name === expanded)!}
                      weekStart={weekStart}
                      onComplete={handleComplete}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="p-5">
            {historyTasks.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-8">Sem tarefas concluídas.</div>
            ) : (
              <ul className="divide-y divide-border">
                {historyTasks.map((t) => (
                  <li key={t.id} className="py-3 flex items-start justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Link to="/tenant/$name" params={{ name: t.tenant_name }} className="font-medium hover:underline">{t.tenant_name}</Link>
                        <span className="text-xs text-muted-foreground">
                          {t.completed_at ? new Date(t.completed_at).toLocaleDateString("pt-PT") : ""} · Semana de {periodLabel(t.week_start)}
                        </span>
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

function ExpandedClubPanel({
  row, weekStart, onComplete,
}: {
  row: { name: string; pending: CSTask[]; completed: CSTask[] };
  weekStart: string;
  onComplete: (t: CSTask, outcome: string, note: string) => Promise<void>;
}) {
  const [completedOpen, setCompletedOpen] = useState(false);
  const [completingId, setCompletingId] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      {row.pending.length > 0 && (
        <ul className="space-y-2">
          {row.pending.map((t) => {
            const flag = (t.flags ?? [])[0] as RiskFlag | undefined;
            const flagLabel = flag ? FLAG_META[flag]?.label ?? flag : "Sinalização";
            const carryover = t.week_start < weekStart;
            const isCompleting = completingId === t.id;
            return (
              <li key={t.id} className="rounded-md border border-border bg-background">
                <div className="flex items-start gap-3 px-3 py-2.5 text-sm">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-foreground/60 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{flagLabel}</span>
                      {carryover && (
                        <span className="text-[10px] uppercase rounded-full bg-muted text-muted-foreground px-1.5 py-0.5">
                          Carry-over
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">{t.reason}</div>
                  </div>
                  {!isCompleting && (
                    <button
                      onClick={() => setCompletingId(t.id)}
                      className="text-xs font-medium text-foreground hover:underline shrink-0"
                    >
                      Marcar feita ▸
                    </button>
                  )}
                </div>
                {isCompleting && (
                  <CompleteForm
                    onCancel={() => setCompletingId(null)}
                    onConfirm={async (outcome, note) => {
                      await onComplete(t, outcome, note);
                      setCompletingId(null);
                    }}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      {row.completed.length > 0 && (
        <div className="rounded-md border border-border">
          <button
            onClick={() => setCompletedOpen((v) => !v)}
            className="w-full text-left px-3 py-2 text-xs font-medium hover:bg-surface inline-flex items-center gap-1.5"
          >
            {completedOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            Ver {row.completed.length} concluída{row.completed.length === 1 ? "" : "s"}
          </button>
          {completedOpen && (
            <ul className="border-t border-border divide-y divide-border">
              {row.completed
                .sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""))
                .map((t) => {
                  const flag = (t.flags ?? [])[0] as RiskFlag | undefined;
                  const flagLabel = flag ? FLAG_META[flag]?.label ?? flag : "—";
                  return (
                    <li key={t.id} className="px-3 py-2 text-xs flex items-start gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0 mt-0.5" />
                      <span className="text-muted-foreground shrink-0">
                        {t.completed_at ? new Date(t.completed_at).toLocaleDateString("pt-PT") : "—"}
                      </span>
                      <span className="font-medium shrink-0">{flagLabel}</span>
                      <span className="text-muted-foreground">— {outcomeLabel(t.outcome)}</span>
                      {t.outcome && (
                        <span className="text-muted-foreground italic truncate">
                          {/* Note isn't on task; outcome is the label */}
                        </span>
                      )}
                    </li>
                  );
                })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function CompleteForm({
  onCancel, onConfirm,
}: {
  onCancel: () => void;
  onConfirm: (outcome: string, note: string) => Promise<void>;
}) {
  const [outcome, setOutcome] = useState(OUTCOME_OPTIONS[0].value);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="border-t border-border bg-surface/40 px-3 py-2.5 space-y-2">
      <select
        value={outcome}
        onChange={(e) => setOutcome(e.target.value)}
        className="w-full px-2 py-1.5 rounded-md border border-border bg-background text-xs"
      >
        {OUTCOME_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Nota opcional…"
        className="w-full px-2 py-1.5 rounded-md border border-border bg-background text-xs"
      />
      <div className="flex items-center justify-end gap-2">
        <button onClick={onCancel} disabled={busy} className="text-xs text-muted-foreground hover:text-foreground">Cancelar</button>
        <button
          onClick={async () => {
            setBusy(true);
            try { await onConfirm(outcome, note); } finally { setBusy(false); }
          }}
          disabled={busy}
          className="px-3 py-1 text-xs rounded-md bg-foreground text-background font-medium hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "A guardar…" : "Confirmar"}
        </button>
      </div>
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

// Generate weekly tasks from current data + statuses (called once per week if none exist)
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
    for (const f of risk.flags) {
      const meta = FLAG_CTA[f];
      tasks.push({
        tenant_name: name,
        reason: meta.reason,
        cta: meta.cta,
        priority: risk.score,
        flags: [f],
        week_start: weekStart,
      });
    }
  }

  if (tasks.length > 0) await insertCSTasks(tasks);
}
