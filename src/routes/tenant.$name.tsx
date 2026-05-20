import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { fetchSnapshotsForTenant, type Snapshot } from "@/lib/data";
import { computeRiskWithCS, riskHistory, FLAG_META } from "@/lib/risk";
import { fetchHealthScoreForTenant, healthLevel } from "@/lib/health";
import { fetchCSStatusesForTenant, fetchCSTasksForTenant, outcomeLabel, taskStatusLabel, type CSTenantStatus, type CSTask } from "@/lib/cs";
import { formatEuro, formatNumber, formatPercent, periodLabel, periodShort } from "@/lib/format";
import { ArrowLeft, MessageSquare } from "lucide-react";
import { RiskBadge } from "./index";

export const Route = createFileRoute("/tenant/$name")({
  component: TenantDetail,
});

function TenantDetail() {
  const { name } = useParams({ from: "/tenant/$name" });
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [csStatuses, setCsStatuses] = useState<CSTenantStatus[]>([]);
  const [csTasks, setCsTasks] = useState<CSTask[]>([]);
  const [healthScore, setHealthScore] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const [data, sts, tks, hs] = await Promise.all([
          fetchSnapshotsForTenant(name),
          fetchCSStatusesForTenant(name),
          fetchCSTasksForTenant(name),
          fetchHealthScoreForTenant(name),
        ]);
        if (cancelled) return;
        setSnapshots(data);
        setCsStatuses(sts);
        setCsTasks(tks);
        setHealthScore(hs);
        if (data.length > 0) setPeriod(data[data.length - 1].period);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [name]);

  const sorted = useMemo(() => [...snapshots].sort((a, b) => a.period.localeCompare(b.period)), [snapshots]);
  const chartData = useMemo(
    () => sorted.map((s) => ({
      period: periodShort(s.period),
      games: s.games_online,
      gmv_games: Number(s.gmv_games),
      revenue: Number(s.revenue),
      rate: Number(s.transacted_rate),
    })),
    [sorted],
  );

  const selected = useMemo(() => sorted.find((s) => s.period === period), [sorted, period]);
  const risk = useMemo(() => computeRiskWithCS(sorted, csStatuses), [sorted, csStatuses]);
  const history = useMemo(() => riskHistory(sorted), [sorted]);

  const monthly = useMemo(() => {
    return sorted.map((s, i) => {
      const prev = sorted[i - 1];
      const delta = (k: keyof Snapshot) => {
        if (!prev) return null;
        const a = Number(prev[k] ?? 0);
        const b = Number(s[k] ?? 0);
        if (a === 0) return null;
        return ((b - a) / Math.abs(a)) * 100;
      };
      return {
        period: s.period,
        snapshot: s,
        deltas: {
          games_online: delta("games_online"),
          gmv_all: delta("gmv_all"),
          revenue: delta("revenue"),
          transacted_rate: delta("transacted_rate"),
        },
      };
    });
  }, [sorted]);

  if (loading) return <div className="p-10 text-muted-foreground">A carregar…</div>;
  if (error) return <div className="p-10 text-danger">{error}</div>;

  if (sorted.length === 0) {
    return (
      <div className="p-10">
        <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"><ArrowLeft className="h-4 w-4" />Voltar</Link>
        <div className="text-muted-foreground">Sem dados para {name}.</div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1400px] mx-auto">
      <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3"><ArrowLeft className="h-4 w-4" />Visão geral</Link>
      <header className="mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{name}</h1>
          <div className="mt-2 flex items-center gap-3">
            {(() => {
              const s = healthScore ?? 100;
              const lvl = healthLevel(s);
              const badgeLevel = lvl === "risk" ? "high" : lvl === "monitor" ? "medium" : "healthy";
              return <RiskBadge level={badgeLevel} score={s} />;
            })()}
            <span className="text-sm text-muted-foreground">{sorted.length} meses de dados</span>
          </div>
        </div>
        <div>
          <label className="text-xs uppercase tracking-wide text-muted-foreground block mb-1">Período</label>
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="px-3 py-2 rounded-md border border-border bg-background text-sm min-w-48"
          >
            {[...sorted].reverse().map((s) => (
              <option key={s.period} value={s.period}>{periodLabel(s.period)}</option>
            ))}
          </select>
        </div>
      </header>

      {selected && (
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <Stat label="Jogos online" value={formatNumber(selected.games_online)} />
          <Stat label="GMV (total)" value={formatEuro(selected.gmv_all)} />
          <Stat label="Receita" value={formatEuro(selected.revenue)} />
          <Stat label="Taxa transacionada" value={formatPercent(selected.transacted_rate)} />
        </section>
      )}

      <section className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
        <ChartCard title="Jogos online">
          <MiniLine data={chartData} dataKey="games" />
        </ChartCard>
        <ChartCard title="GMV (jogos)">
          <MiniLine data={chartData} dataKey="gmv_games" euro />
        </ChartCard>
        <ChartCard title="Receita">
          <MiniLine data={chartData} dataKey="revenue" euro />
        </ChartCard>
        <ChartCard title="Taxa transacionada (%)">
          <MiniLine data={chartData} dataKey="rate" pct />
        </ChartCard>
      </section>

      <section className="rounded-xl border border-border overflow-hidden mb-8">
        <div className="px-4 py-3 border-b border-border bg-surface text-sm font-medium">Comparação mensal</div>
        <div className="max-h-[460px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface z-10 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left">Período</th>
                <th className="px-4 py-3 text-right">Jogos</th>
                <th className="px-4 py-3 text-right">Δ</th>
                <th className="px-4 py-3 text-right">GMV total</th>
                <th className="px-4 py-3 text-right">Δ</th>
                <th className="px-4 py-3 text-right">Receita</th>
                <th className="px-4 py-3 text-right">Δ</th>
                <th className="px-4 py-3 text-right">Taxa</th>
                <th className="px-4 py-3 text-right">Δ</th>
              </tr>
            </thead>
            <tbody>
              {[...monthly].reverse().map((m) => (
                <tr key={m.period} className="border-t border-border hover:bg-surface">
                  <td className="px-4 py-2.5">{periodLabel(m.period)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatNumber(m.snapshot.games_online)}</td>
                  <td className="px-4 py-2.5 text-right"><Delta v={m.deltas.games_online} /></td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatEuro(m.snapshot.gmv_all)}</td>
                  <td className="px-4 py-2.5 text-right"><Delta v={m.deltas.gmv_all} /></td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatEuro(m.snapshot.revenue)}</td>
                  <td className="px-4 py-2.5 text-right"><Delta v={m.deltas.revenue} /></td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatPercent(m.snapshot.transacted_rate)}</td>
                  <td className="px-4 py-2.5 text-right"><Delta v={m.deltas.transacted_rate} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-border p-5">
        <h3 className="text-sm font-medium mb-3">Histórico de risco</h3>
        {history.filter((h) => h.result.flags.length > 0).length === 0 ? (
          <div className="text-sm text-muted-foreground">Nenhuma sinalização de risco em qualquer mês.</div>
        ) : (
          <ul className="space-y-2">
            {[...history].reverse().filter((h) => h.result.flags.length > 0).map((h) => (
              <li key={h.period} className="flex items-start gap-3 text-sm">
                <span className="font-medium w-32 shrink-0">{periodLabel(h.period)}</span>
                <div className="flex flex-wrap gap-1.5">
                  {h.result.flags.map((f) => (
                    <span key={f} className="rounded-full bg-surface px-2 py-0.5 text-xs" title={FLAG_META[f].description}>
                      {FLAG_META[f].label}
                    </span>
                  ))}
                </div>
                <RiskBadge level={h.result.level} score={h.result.score} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {csTasks.some((t) => t.status === "pending") && (
        <section className="rounded-xl border border-warning/40 bg-warning/5 p-5 mt-6">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2 text-warning">
            <MessageSquare className="h-4 w-4" /> Tarefas pendentes · {csTasks.filter((t) => t.status === "pending").length}
          </h3>
          <ul className="space-y-3">
            {csTasks
              .filter((t) => t.status === "pending")
              .sort((a, b) => a.week_start.localeCompare(b.week_start))
              .map((t) => (
                <li key={t.id} className="text-sm rounded-md border border-warning/30 bg-background p-3">
                  <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                    <span>Semana de {t.week_start}</span>
                    <span className={`uppercase font-semibold rounded-full px-1.5 py-0.5 text-[10px] ${t.priority >= 80 ? "bg-danger/15 text-danger" : t.priority >= 50 ? "bg-warning/15 text-warning" : "bg-surface"}`}>
                      {t.priority >= 80 ? "Alta" : t.priority >= 50 ? "Média" : "Baixa"}
                    </span>
                  </div>
                  <div className="mt-1 font-medium whitespace-pre-line">{t.reason}</div>
                  <div className="text-muted-foreground mt-0.5 whitespace-pre-line">CTA: {t.cta}</div>
                </li>
              ))}
          </ul>
        </section>
      )}

      <section className="rounded-xl border border-border p-5 mt-6">
        <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
          <MessageSquare className="h-4 w-4" /> Histórico CS
        </h3>
        <CSHistory tasks={csTasks} statuses={csStatuses} />
      </section>
    </div>
  );
}

function CSHistory({ tasks, statuses }: { tasks: CSTask[]; statuses: CSTenantStatus[] }) {
  // Include both completed and cancelled tasks in the per-tenant history.
  // Cancelled tasks show as "Anulada" via taskStatusLabel (status takes precedence over outcome).
  const historyTasks = tasks.filter((t) => t.status === "completed" || t.status === "cancelled");

  type Entry = {
    key: string;
    date: string;
    statusLabel: string | null; // when set, takes precedence over outcome (e.g. "Anulada")
    statusTip?: string | null;
    outcome: string | null;
    note: string | null;
    reason: string | null;
    flags: string[];
  };

  const entries: Entry[] = [];
  historyTasks.forEach((t) => {
    const isCancelled = t.status === "cancelled";
    entries.push({
      key: `t-${t.id}`,
      date: t.completed_at ?? t.created_at,
      statusLabel: isCancelled ? taskStatusLabel(t) : null,
      statusTip: isCancelled && t.outcome ? outcomeLabel(t.outcome) : null,
      outcome: t.outcome,
      note: isCancelled ? (t.note ?? null) : null,
      reason: t.reason,
      flags: t.flags ?? [],
    });
  });

  // Add standalone statuses (not within 60s of a completed task)
  const completed = historyTasks.filter((t) => t.status === "completed");
  statuses.forEach((s) => {
    const matched = completed.find((t) =>
      t.completed_at && Math.abs(new Date(t.completed_at).getTime() - new Date(s.recorded_at).getTime()) < 60_000
      && t.outcome === s.relationship_status
    );
    if (matched) {
      const e = entries.find((x) => x.key === `t-${matched.id}`);
      if (e) e.note = s.note;
      return;
    }
    entries.push({
      key: `s-${s.id}`,
      date: s.recorded_at,
      statusLabel: null,
      outcome: s.relationship_status,
      note: s.note,
      reason: null,
      flags: [],
    });
  });

  entries.sort((a, b) => b.date.localeCompare(a.date));

  if (entries.length === 0) {
    return <div className="text-sm text-muted-foreground">Sem interações de CS registadas.</div>;
  }

  return (
    <ul className="divide-y divide-border">
      {entries.map((e) => (
        <li key={e.key} className="py-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-xs text-muted-foreground">
              {new Date(e.date).toLocaleString("pt-PT", { dateStyle: "medium", timeStyle: "short" })}
            </div>
            {e.statusLabel ? (
              <span
                title={e.statusTip ?? undefined}
                className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border font-medium line-through decoration-muted-foreground/40"
              >
                {e.statusLabel}
              </span>
            ) : (
              <span className="text-xs px-2 py-0.5 rounded-full bg-surface font-medium">{outcomeLabel(e.outcome)}</span>
            )}
          </div>
          {e.reason && <div className="text-sm mt-1.5">{e.reason}</div>}
          {e.flags.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {e.flags.map((f) => (
                <span key={f} className="rounded-full bg-surface px-2 py-0.5 text-[10px]">
                  {FLAG_META[f as keyof typeof FLAG_META]?.label ?? f}
                </span>
              ))}
            </div>
          )}
          {e.note && <div className="text-xs text-muted-foreground mt-1.5 italic">"{e.note}"</div>}
        </li>
      ))}
    </ul>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border p-5">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">{title}</div>
      <div className="h-44">{children}</div>
    </div>
  );
}

function MiniLine({ data, dataKey, euro, pct }: { data: { period: string; [k: string]: number | string }[]; dataKey: string; euro?: boolean; pct?: boolean }) {
  const fmt = (v: number) => (euro ? formatEuro(v) : pct ? formatPercent(v) : formatNumber(v));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.93 0.01 250)" vertical={false} />
        <XAxis dataKey="period" tick={{ fontSize: 11 }} stroke="oklch(0.6 0.02 250)" />
        <YAxis tick={{ fontSize: 11 }} stroke="oklch(0.6 0.02 250)" width={50} tickFormatter={(v) => (euro ? `€${Math.round(Number(v) / 1000)}k` : pct ? `${v}%` : formatNumber(Number(v)))} />
        <Tooltip
          formatter={(v) => fmt(Number(v))}
          contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid oklch(0.93 0.01 250)" }}
        />
        <Line type="monotone" dataKey={dataKey} stroke="oklch(0.18 0.02 250)" strokeWidth={2} dot={{ r: 2 }}  isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function Delta({ v }: { v: number | null }) {
  if (v === null) return <span className="text-muted-foreground">—</span>;
  const positive = v >= 0;
  return (
    <span className={`tabular-nums text-xs font-medium ${positive ? "text-success" : "text-danger"}`}>
      {positive ? "▲" : "▼"} {Math.abs(v).toFixed(1)}%
    </span>
  );
}
