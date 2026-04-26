import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { fetchAllSnapshots, fetchPeriods, type Snapshot } from "@/lib/data";
import { computeRisk } from "@/lib/risk";
import { formatEuro, formatNumber, formatPercent, periodLabel } from "@/lib/format";
import { ArrowUpDown, Search, Upload } from "lucide-react";

export const Route = createFileRoute("/")({
  component: OverviewPage,
});

type SortKey = "tenant_name" | "games_online" | "gmv_games" | "gmv_all" | "revenue" | "transacted_rate";

function OverviewPage() {
  const [allSnapshots, setAllSnapshots] = useState<Snapshot[]>([]);
  const [periods, setPeriods] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("revenue");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [snaps, ps] = await Promise.all([fetchAllSnapshots(), fetchPeriods()]);
        if (cancelled) return;
        setAllSnapshots(snaps);
        setPeriods(ps);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const latestPeriod = periods[0];

  const latestRows = useMemo(() => {
    if (!latestPeriod) return [];
    return allSnapshots.filter((s) => s.period === latestPeriod);
  }, [allSnapshots, latestPeriod]);

  // Risk per tenant (uses last 3 history)
  const tenantHistory = useMemo(() => {
    const map = new Map<string, Snapshot[]>();
    allSnapshots.forEach((s) => {
      if (!map.has(s.tenant_name)) map.set(s.tenant_name, []);
      map.get(s.tenant_name)!.push(s);
    });
    return map;
  }, [allSnapshots]);

  const totals = useMemo(() => {
    const t = { tenants: latestRows.length, games: 0, gmvAll: 0, revenue: 0 };
    latestRows.forEach((r) => {
      t.games += Number(r.games_online ?? 0);
      t.gmvAll += Number(r.gmv_all ?? 0);
      t.revenue += Number(r.revenue ?? 0);
    });
    return t;
  }, [latestRows]);

  const maxGames = useMemo(() => Math.max(1, ...latestRows.map((r) => r.games_online ?? 0)), [latestRows]);

  const filteredSorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = latestRows;
    if (q) rows = rows.filter((r) => r.tenant_name.toLowerCase().includes(q));
    const dir = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "string" && typeof bv === "string") return av.localeCompare(bv) * dir;
      return (Number(av) - Number(bv)) * dir;
    });
  }, [latestRows, search, sortKey, sortDir]);

  function toggleSort(k: SortKey) {
    if (k === sortKey) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir(k === "tenant_name" ? "asc" : "desc"); }
  }

  if (loading) return <div className="p-10 text-muted-foreground">Loading…</div>;
  if (error) return <div className="p-10 text-danger">{error}</div>;

  if (!latestPeriod) {
    return (
      <div className="p-10">
        <div className="max-w-xl mx-auto mt-20 text-center">
          <div className="mx-auto mb-4 h-14 w-14 rounded-full bg-surface flex items-center justify-center">
            <Upload className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-semibold mb-2">No data yet</h1>
          <p className="text-muted-foreground mb-6">Upload your first monthly XLSX to see tenant health metrics.</p>
          <Link to="/upload" className="inline-flex items-center gap-2 rounded-md bg-foreground text-background px-4 py-2 text-sm font-medium hover:opacity-90">
            <Upload className="h-4 w-4" /> Go to Upload
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-[1400px] mx-auto">
      <header className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
          <p className="text-sm text-muted-foreground mt-1">Latest snapshot — {periodLabel(latestPeriod)}</p>
        </div>
      </header>

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <MetricCard label="Total tenants" value={formatNumber(totals.tenants)} />
        <MetricCard label="Total games online" value={formatNumber(totals.games)} />
        <MetricCard label="Total GMV (all products)" value={formatEuro(totals.gmvAll)} />
        <MetricCard label="Total revenue" value={formatEuro(totals.revenue)} />
      </section>

      <section className="rounded-xl border border-border bg-background overflow-hidden">
        <div className="p-4 border-b border-border flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tenant…"
              className="w-full pl-9 pr-3 py-2 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="text-xs text-muted-foreground">{filteredSorted.length} tenants</div>
        </div>

        <div className="max-h-[640px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface z-10">
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <Th onClick={() => toggleSort("tenant_name")} active={sortKey === "tenant_name"}>Tenant</Th>
                <Th onClick={() => toggleSort("games_online")} active={sortKey === "games_online"}>Games online</Th>
                <Th onClick={() => toggleSort("gmv_games")} active={sortKey === "gmv_games"} align="right">GMV games</Th>
                <Th onClick={() => toggleSort("gmv_all")} active={sortKey === "gmv_all"} align="right">GMV all</Th>
                <Th onClick={() => toggleSort("revenue")} active={sortKey === "revenue"} align="right">Revenue</Th>
                <Th onClick={() => toggleSort("transacted_rate")} active={sortKey === "transacted_rate"} align="right">Rate</Th>
                <th className="px-4 py-3">Risk</th>
              </tr>
            </thead>
            <tbody>
              {filteredSorted.map((r) => {
                const risk = computeRisk(tenantHistory.get(r.tenant_name) ?? []);
                const ratePct = r.transacted_rate ?? 0;
                const rateColor = ratePct >= 40 ? "text-success" : ratePct >= 15 ? "text-warning" : "text-danger";
                const games = r.games_online ?? 0;
                const w = Math.max(2, Math.round((games / maxGames) * 100));
                return (
                  <tr key={r.id} className="border-t border-border hover:bg-surface">
                    <td className="px-4 py-2.5">
                      <Link to="/tenant/$name" params={{ name: r.tenant_name }} className="font-medium hover:underline">
                        {r.tenant_name}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="tabular-nums w-12">{formatNumber(games)}</span>
                        <div className="flex-1 max-w-[120px] h-1.5 rounded-full bg-surface overflow-hidden">
                          <div className="h-full bg-foreground/80" style={{ width: `${w}%` }} />
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatEuro(r.gmv_games)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatEuro(r.gmv_all)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatEuro(r.revenue)}</td>
                    <td className={`px-4 py-2.5 text-right tabular-nums font-medium ${rateColor}`}>{formatPercent(ratePct)}</td>
                    <td className="px-4 py-2.5"><RiskBadge level={risk.level} score={risk.score} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-background p-5">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function Th({ children, onClick, active, align }: { children: React.ReactNode; onClick: () => void; active: boolean; align?: "right" }) {
  return (
    <th className={`px-4 py-3 ${align === "right" ? "text-right" : ""}`}>
      <button onClick={onClick} className={`inline-flex items-center gap-1 hover:text-foreground ${active ? "text-foreground" : ""}`}>
        {children}
        <ArrowUpDown className="h-3 w-3 opacity-60" />
      </button>
    </th>
  );
}

export function RiskBadge({ level, score }: { level: "high" | "medium" | "healthy"; score: number }) {
  const map = {
    high: { bg: "bg-danger/10", text: "text-danger", label: "High risk" },
    medium: { bg: "bg-warning/15", text: "text-warning", label: "Medium" },
    healthy: { bg: "bg-success/10", text: "text-success", label: "Healthy" },
  } as const;
  const m = map[level];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${m.bg} ${m.text}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {m.label} · {score}
    </span>
  );
}
