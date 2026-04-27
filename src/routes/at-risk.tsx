import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { LineChart, Line, ResponsiveContainer, YAxis } from "recharts";
import { fetchAllSnapshots, fetchPeriods, type Snapshot } from "@/lib/data";
import { fetchAllCSStatuses, type CSTenantStatus } from "@/lib/cs";
import { computeRiskWithCS, FLAG_META } from "@/lib/risk";
import { ArrowRight, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/at-risk")({
  component: AtRiskPage,
});

function AtRiskPage() {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [periods, setPeriods] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<CSTenantStatus[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [s, p, st] = await Promise.all([fetchAllSnapshots(), fetchPeriods(), fetchAllCSStatuses()]);
        setSnapshots(s);
        setPeriods(p);
        setStatuses(st);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const latest = periods[0];

  const tenantHistory = useMemo(() => {
    const map = new Map<string, Snapshot[]>();
    snapshots.forEach((s) => {
      if (!map.has(s.tenant_name)) map.set(s.tenant_name, []);
      map.get(s.tenant_name)!.push(s);
    });
    return map;
  }, [snapshots]);

  const statusByTenant = useMemo(() => {
    const m = new Map<string, CSTenantStatus[]>();
    statuses.forEach((s) => {
      if (!m.has(s.tenant_name)) m.set(s.tenant_name, []);
      m.get(s.tenant_name)!.push(s);
    });
    return m;
  }, [statuses]);

  const cards = useMemo(() => {
    if (!latest) return [];
    const list: { name: string; risk: ReturnType<typeof computeRiskWithCS>; spark: { period: string; games: number }[] }[] = [];
    for (const [name, hist] of tenantHistory) {
      const sorted = [...hist].sort((a, b) => a.period.localeCompare(b.period));
      const hasLatest = sorted.some((s) => s.period === latest);
      if (!hasLatest) continue;
      const risk = computeRiskWithCS(sorted, statusByTenant.get(name) ?? []);
      if (risk.flags.length === 0) continue;
      const spark = sorted.slice(-6).map((s) => ({ period: s.period, games: s.games_online }));
      list.push({ name, risk, spark });
    }
    return list.sort((a, b) => b.risk.score - a.risk.score);
  }, [tenantHistory, latest, statusByTenant]);

  if (loading) return <div className="p-10 text-muted-foreground">A carregar…</div>;

  return (
    <div className="p-8 max-w-[1400px] mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Tenants em risco</h1>
        <p className="text-sm text-muted-foreground mt-1">Tenants com pelo menos uma sinalização de risco no último mês, ordenados por gravidade.</p>
      </header>

      {cards.length === 0 ? (
        <div className="rounded-xl border border-border p-12 text-center">
          <ShieldCheck className="mx-auto h-10 w-10 text-success mb-3" />
          <div className="text-lg font-medium">Todos os tenants saudáveis</div>
          <div className="text-sm text-muted-foreground mt-1">Nenhuma sinalização de risco no último snapshot.</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {cards.map((c) => {
            const tone = c.risk.level === "high"
              ? { bar: "bg-danger", text: "text-danger", bg: "bg-danger/5", border: "border-danger/30" }
              : { bar: "bg-warning", text: "text-warning", bg: "bg-warning/5", border: "border-warning/30" };
            return (
              <div key={c.name} className={`rounded-xl border ${tone.border} ${tone.bg} p-5 flex flex-col`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{c.name}</div>
                    <div className={`text-xs mt-0.5 ${tone.text} font-medium`}>
                      {c.risk.level === "high" ? "Risco alto" : "Risco médio"}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`text-3xl font-bold tabular-nums ${tone.text}`}>{c.risk.score}</div>
                    <div className="text-[10px] uppercase text-muted-foreground tracking-wide">Score de risco</div>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {c.risk.flags.map((f) => (
                    <span key={f} className="rounded-full bg-background border border-border px-2 py-0.5 text-xs" title={FLAG_META[f].description}>
                      {FLAG_META[f].label}
                    </span>
                  ))}
                </div>

                <div className="mt-4 h-16">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={c.spark}>
                      <YAxis hide domain={["dataMin", "dataMax"]} />
                      <Line type="monotone" dataKey="games" stroke="currentColor" strokeWidth={2} dot={false} className={tone.text} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="text-[10px] text-muted-foreground -mt-1 mb-3">Jogos online · últimos 6 meses</div>

                <Link to="/tenant/$name" params={{ name: c.name }} className="mt-auto inline-flex items-center justify-between rounded-md bg-foreground text-background px-3 py-2 text-sm font-medium hover:opacity-90">
                  Ver detalhe <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
