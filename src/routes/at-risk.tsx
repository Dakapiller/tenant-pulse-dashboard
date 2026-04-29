import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { LineChart, Line, ResponsiveContainer, YAxis } from "recharts";
import { fetchAllSnapshots, fetchPeriods, type Snapshot } from "@/lib/data";
import { fetchAllCSStatuses, fetchAllCSTasks, currentWeekStart, riskWithDelta, excludedTenants, type CSTenantStatus, type CSTask } from "@/lib/cs";
import { fetchHealthScores } from "@/lib/health";
import { FLAG_META, FLAG_CTA, type RiskFlag } from "@/lib/risk";
import { ScoreDelta } from "@/components/DataTable";
import { ArrowRight, ListChecks, Plus, Search, ShieldCheck, X } from "lucide-react";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { NewTaskDialog } from "@/components/NewTaskDialog";

const TOP_LIMIT = 20;

export const Route = createFileRoute("/at-risk")({
  component: AtRiskPage,
});

function AtRiskPage() {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [periods, setPeriods] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<CSTenantStatus[]>([]);
  const [tasks, setTasks] = useState<CSTask[]>([]);
  const [healthScores, setHealthScores] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);

  useEffect(() => {
    (async () => {
      try {
        const [s, p, st, tk, sc] = await Promise.all([
          fetchAllSnapshots(), fetchPeriods(), fetchAllCSStatuses(), fetchAllCSTasks(), fetchHealthScores(),
        ]);
        setSnapshots(s); setPeriods(p); setStatuses(st); setTasks(tk); setHealthScores(sc);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const latest = periods[0];
  const weekStart = useMemo(() => currentWeekStart(), []);

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

  const pendingByTenant = useMemo(() => {
    const m = new Map<string, number>();
    tasks.forEach((t) => {
      if (t.status === "pending" && t.week_start === weekStart) {
        m.set(t.tenant_name, (m.get(t.tenant_name) ?? 0) + 1);
      }
    });
    return m;
  }, [tasks, weekStart]);

  const excluded = useMemo(() => excludedTenants(statuses), [statuses]);

  const cards = useMemo(() => {
    if (!latest) return [];
    type Card = {
      name: string;
      score: number;
      level: "high" | "medium" | "healthy";
      flags: RiskFlag[];
      scoreDelta: number | null;
      spark: { period: string; games: number }[];
      pending: number;
    };
    const list: Card[] = [];
    for (const [name, hist] of tenantHistory) {
      if (excluded.has(name)) continue;
      const sorted = [...hist].sort((a, b) => a.period.localeCompare(b.period));
      const hasLatest = sorted.some((s) => s.period === latest);
      if (!hasLatest) continue;
      const score = healthScores.get(name);
      if (score === undefined || score >= 30) continue;
      const sts = statusByTenant.get(name) ?? [];
      const rd = riskWithDelta(sorted, sts, score, null);
      const spark = sorted.slice(-6).map((s) => ({ period: s.period, games: s.games_online }));
      list.push({
        name,
        score: rd.score,
        level: rd.level,
        flags: rd.flags.current as RiskFlag[],
        scoreDelta: rd.delta,
        spark,
        pending: pendingByTenant.get(name) ?? 0,
      });
    }
    return list.sort((a, b) => a.score - b.score);
  }, [tenantHistory, latest, statusByTenant, pendingByTenant, excluded, healthScores]);

  if (loading) return <div className="p-10 text-muted-foreground">A carregar…</div>;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1400px] mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Em Risco</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Clubes com health score abaixo de 30, ordenados por gravidade. Os badges abaixo são indicadores informativos e não influenciam o score.
        </p>
      </header>

      {cards.length > 0 && (
        <div className="mb-4 relative max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Pesquisar clube…"
            className="w-full pl-8 pr-8 py-2 text-base sm:text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-foreground/20"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-surface text-muted-foreground"
              aria-label="Limpar pesquisa"
              type="button"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {cards.length === 0 ? (
        <div className="rounded-xl border border-border p-12 text-center">
          <ShieldCheck className="mx-auto h-10 w-10 text-success mb-3" />
          <div className="text-lg font-medium">Nenhum clube em risco</div>
          <div className="text-sm text-muted-foreground mt-1">Todos os clubes têm health score igual ou superior a 30.</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {cards
            .filter((c) => !debouncedSearch || c.name.toLowerCase().includes(debouncedSearch.toLowerCase()))
            .map((c) => {
            // All cards here have health < 30 → red tone.
            const tone = { bar: "bg-danger", text: "text-danger", bg: "bg-danger/5", border: "border-danger/30" };
            return (
              <div key={c.name} className={`rounded-xl border ${tone.border} ${tone.bg} p-5 flex flex-col`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{c.name}</div>
                    <div className={`text-xs mt-0.5 ${tone.text} font-medium`}>Em risco</div>
                  </div>
                  <div className="text-right">
                    <div className={`text-3xl font-bold tabular-nums ${tone.text}`}>{c.score}</div>
                    <div className="text-[10px] uppercase text-muted-foreground tracking-wide">Health</div>
                    <div className="mt-1"><ScoreDelta delta={c.scoreDelta} /></div>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {c.flags.map((f) => (
                    <span key={f} className="rounded-full bg-background border border-border px-2 py-0.5 text-xs">
                      {FLAG_META[f].label}
                    </span>
                  ))}
                  <span className="ml-auto inline-flex items-center gap-1 text-[11px] rounded-full bg-background border border-border px-2 py-0.5">
                    <ListChecks className="h-3 w-3" />
                    {c.pending} {c.pending === 1 ? "tarefa pendente" : "tarefas pendentes"}
                  </span>
                </div>

                {/* Why */}
                <div className="mt-4">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">Porquê</div>
                  <ul className="space-y-1 text-xs">
                    {c.flags.map((f) => (
                      <li key={f} className="flex gap-2">
                        <span className={`mt-1.5 h-1 w-1 rounded-full ${tone.bar} shrink-0`} />
                        <span>{FLAG_CTA[f as RiskFlag].reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Suggestions */}
                <div className="mt-3">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">Sugestões</div>
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {c.flags.map((f) => (
                      <li key={f} className="flex gap-2">
                        <span className="mt-1.5 h-1 w-1 rounded-full bg-foreground/60 shrink-0" />
                        <span>{FLAG_CTA[f as RiskFlag].cta}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="mt-4 h-12">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={c.spark}>
                      <YAxis hide domain={["dataMin", "dataMax"]} />
                      <Line type="monotone" dataKey="games" stroke="currentColor" strokeWidth={2} dot={false} className={tone.text} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="text-[10px] text-muted-foreground -mt-1 mb-3">Jogos online · últimos 6 meses</div>

                <Link to="/clubs" search={{ tenant: c.name }} className="mt-auto inline-flex items-center justify-between rounded-md bg-foreground text-background px-3 py-2 text-sm font-medium hover:opacity-90">
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
