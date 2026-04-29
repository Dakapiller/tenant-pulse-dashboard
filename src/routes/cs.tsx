import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
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
  completeCSTasksBatch,
  currentWeekStart,
  outcomeLabel,
  lastCompletedActivityAt,
  scoreWithDelta,
  excludedTenants,
  OUTCOME_OPTIONS,
  type CSTenantStatus,
  type CSTask,
} from "@/lib/cs";
import { computeRiskWithCS, FLAG_CTA, FLAG_META, type RiskFlag } from "@/lib/risk";
import { formatEuro, formatNumber, periodLabel, periodShort } from "@/lib/format";
import { DataTable, ScoreDelta, type ColumnDef } from "@/components/DataTable";
import { ArrowRight, CheckCircle2, ChevronDown, ChevronRight, Eye, EyeOff, ListChecks } from "lucide-react";

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

  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [showInactive, setShowInactive] = useState(false);

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

  // Tenants in churned/closed excluded from aggregate timeline metrics.
  const excluded = useMemo(() => excludedTenants(statuses), [statuses]);

  // Build monthly timeline series
  const series = useMemo(() => {
    const base = chartMode === "tenant" && selectedTenant
      ? snapshots.filter((s) => s.tenant_name === selectedTenant)
      : snapshots.filter((s) => !excluded.has(s.tenant_name));
    const filtered = base;
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
  }, [snapshots, chartMode, selectedTenant, excluded]);

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
    prevScore: number | null;
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
          prevScore: sd.prevScore,
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

  const visibleRows = useMemo(
    () => showInactive ? rows : rows.filter((r) => !excluded.has(r.name)),
    [rows, excluded, showInactive],
  );
  const visibleHistory = useMemo(
    () => showInactive ? historyTasks : historyTasks.filter((t) => !excluded.has(t.tenant_name)),
    [historyTasks, excluded, showInactive],
  );
  const inactiveRowsCount = rows.filter((r) => excluded.has(r.name)).length;

  const [expanded, setExpanded] = useState<string | null>(null);

  async function handleSingleComplete(tenant: string, taskId: string, outcome: string, note: string | null) {
    await completeCSTask(taskId, tenant, outcome, note);
    await loadAll();
  }

  if (loading) return <div className="p-10 text-muted-foreground">A carregar…</div>;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1400px] mx-auto">
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
          <div className="flex items-center gap-2 flex-wrap">
            {inactiveRowsCount > 0 && (
              <button
                onClick={() => setShowInactive((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-surface"
                title={showInactive ? "Ocultar clubes em churn e fechados" : "Mostrar clubes em churn e fechados"}
              >
                {showInactive ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {showInactive ? "Ocultar inativos" : `Mostrar inativos (${inactiveRowsCount})`}
              </button>
            )}
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
            {visibleRows.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-8">
                Sem clubes com tarefas neste período.
              </div>
            ) : (
              <div className="rounded-lg border border-border overflow-hidden">
                <DataTable<typeof rows[number]>
                  rows={visibleRows}
                  rowKey={(r) => r.name}
                  defaultSort={{ key: "score", dir: "desc" }}
                  onRowClick={(r) => setExpanded(expanded === r.name ? null : r.name)}
                  rowClassName={(r) => expanded === r.name ? "bg-surface/40" : ""}
                  selectable
                  selectedKeys={selectedKeys}
                  onSelectionChange={setSelectedKeys}
                  isRowSelectable={(r) => r.pending.length > 0}
                  expandedRow={(r) => expanded === r.name ? (
                    <ExpandedClubPanel
                      row={r}
                      onComplete={handleSingleComplete}
                    />
                  ) : null}
                  columns={[
                    {
                      key: "name", header: "Clube",
                      sortValue: (r) => r.name,
                      filterValue: (r) => r.name, filter: { kind: "text" },
                      render: (r) => (
                        <ClubLink name={r.name} className="font-semibold hover:underline" />
                      ),
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
              </div>
            )}
          </div>
        ) : (
          <div className="p-5">
            {visibleHistory.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-8">Sem tarefas concluídas.</div>
            ) : (
              <ul className="divide-y divide-border">
                {visibleHistory.map((t) => (
                  <li key={t.id} className="py-3 flex items-start justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <ClubLink name={t.tenant_name} />
                        <span className="text-xs px-1.5 py-0.5 rounded bg-surface">{formatFlagsLabel(t.flags)}</span>
                        <span className="text-xs text-muted-foreground">
                          {t.completed_at ? new Date(t.completed_at).toLocaleDateString("pt-PT") : ""} · Semana de {periodLabel(t.week_start)}
                        </span>
                      </div>
                      {t.reason && <div className="text-xs text-muted-foreground mt-0.5 whitespace-pre-line">{t.reason}</div>}
                      {t.note && <div className="text-xs text-muted-foreground mt-1 italic">Comentário: “{t.note}”</div>}
                    </div>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-surface shrink-0">{outcomeLabel(t.outcome)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {tab === "contacts" && selectedKeys.size > 0 && (
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
            await loadAll();
          }}
          onCancel={() => setSelectedKeys(new Set())}
        />
      )}
    </div>
  );
}

function ExpandedClubPanel({
  row, onComplete,
}: {
  row: { name: string; pending: CSTask[]; completed: CSTask[] };
  onComplete: (tenant: string, taskId: string, outcome: string, note: string | null) => Promise<void>;
}) {
  const [completedOpen, setCompletedOpen] = useState(false);
  const [outcome, setOutcome] = useState(OUTCOME_OPTIONS[0].value);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  // After dedupe, there's at most one pending task per club.
  const task = row.pending[0];

  async function handleComplete() {
    if (!task) return;
    setBusy(true);
    try {
      const n = note.trim();
      await onComplete(task.tenant_name, task.id, outcome, n.length > 0 ? n : null);
      setNote("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end gap-3 -mt-1">
        <ClubLink
          name={row.name}
          className="inline-flex items-center gap-1 text-xs font-medium text-foreground hover:underline"
        >
          Ver perfil do clube <ArrowRight className="h-3 w-3" />
        </ClubLink>
      </div>

      {task && (
        <div className="rounded-md border border-border bg-background" onClick={(e) => e.stopPropagation()}>
          <div className="px-4 py-3 border-b border-border">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">
              Sinalizações ativas ({task.flags?.length ?? 0})
            </div>
            <ul className="space-y-2">
              {(task.flags ?? []).map((f, i) => {
                const meta = FLAG_META[f as RiskFlag];
                const cta = FLAG_CTA[f as RiskFlag]?.cta;
                const reason = FLAG_CTA[f as RiskFlag]?.reason;
                return (
                  <li key={`${f}-${i}`} className="flex items-start gap-2 text-sm">
                    <span className="text-muted-foreground mt-1">•</span>
                    <div className="min-w-0">
                      <div className="font-medium">{meta?.label ?? f}</div>
                      {reason && <div className="text-xs text-muted-foreground mt-0.5">{reason}</div>}
                      {cta && <div className="text-xs text-muted-foreground/80 mt-0.5 italic">→ {cta}</div>}
                    </div>
                  </li>
                );
              })}
            </ul>
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
            <div className="flex items-center justify-end pt-1">
              <button
                onClick={handleComplete}
                disabled={busy}
                className="px-3 py-1.5 text-xs rounded-md bg-foreground text-background font-medium disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-1.5"
              >
                <CheckCircle2 className="h-3.5 w-3.5" /> {busy ? "A guardar…" : "Marcar como feita"}
              </button>
            </div>
          </div>
        </div>
      )}

      {row.completed.length > 0 && (
        <div className="rounded-md border border-border">
          <button
            onClick={(e) => { e.stopPropagation(); setCompletedOpen((v) => !v); }}
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
                  const flagsLabel = formatFlagsLabel(t.flags);
                  return (
                    <li key={t.id} className="px-3 py-2 text-xs">
                      <div className="flex items-start gap-2">
                        <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0 mt-0.5" />
                        <span className="text-muted-foreground shrink-0">
                          {t.completed_at ? new Date(t.completed_at).toLocaleDateString("pt-PT") : "—"}
                        </span>
                        <span className="font-medium shrink-0">{flagsLabel}</span>
                        <span className="text-muted-foreground">— {outcomeLabel(t.outcome)}</span>
                      </div>
                      {t.note && <div className="ml-5 mt-1 italic text-muted-foreground">"{t.note}"</div>}
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

export function formatFlagsLabel(flags: string[] | null | undefined): string {
  if (!flags || flags.length === 0) return "—";
  return flags.map((f) => FLAG_META[f as RiskFlag]?.label ?? f).join(" + ");
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

// ---------- Bulk complete-tasks bar (floating) ----------

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
          {count} {count === 1 ? "clube selecionado" : "clubes selecionados"} — marca as pendentes destes clubes
        </span>
        <span className="text-xs text-muted-foreground">
          Só afeta sinalizações pendentes dos clubes selecionados.
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
