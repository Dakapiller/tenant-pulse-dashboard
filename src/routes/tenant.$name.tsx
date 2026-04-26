import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { fetchSnapshotsForTenant, type Snapshot } from "@/lib/data";
import { computeRisk, riskHistory, FLAG_META } from "@/lib/risk";
import { formatEuro, formatNumber, formatPercent, periodLabel, periodShort } from "@/lib/format";
import { ArrowLeft } from "lucide-react";
import { RiskBadge } from "./index";

export const Route = createFileRoute("/tenant/$name")({
  component: TenantDetail,
});

function TenantDetail() {
  const { name } = useParams({ from: "/tenant/$name" });
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const data = await fetchSnapshotsForTenant(name);
        if (cancelled) return;
        setSnapshots(data);
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
  const risk = useMemo(() => computeRisk(sorted), [sorted]);
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

  if (loading) return <div className="p-10 text-muted-foreground">Loading…</div>;
  if (error) return <div className="p-10 text-danger">{error}</div>;

  if (sorted.length === 0) {
    return (
      <div className="p-10">
        <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"><ArrowLeft className="h-4 w-4" />Back</Link>
        <div className="text-muted-foreground">No data for {name}.</div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-[1400px] mx-auto">
      <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3"><ArrowLeft className="h-4 w-4" />Overview</Link>
      <header className="mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{name}</h1>
          <div className="mt-2 flex items-center gap-3">
            <RiskBadge level={risk.level} score={risk.score} />
            <span className="text-sm text-muted-foreground">{sorted.length} months of data</span>
          </div>
        </div>
        <div>
          <label className="text-xs uppercase tracking-wide text-muted-foreground block mb-1">Period</label>
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
          <Stat label="Games online" value={formatNumber(selected.games_online)} />
          <Stat label="GMV (all)" value={formatEuro(selected.gmv_all)} />
          <Stat label="Revenue" value={formatEuro(selected.revenue)} />
          <Stat label="Transacted rate" value={formatPercent(selected.transacted_rate)} />
        </section>
      )}

      <section className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
        <ChartCard title="Games online">
          <MiniLine data={chartData} dataKey="games" />
        </ChartCard>
        <ChartCard title="GMV (games)">
          <MiniLine data={chartData} dataKey="gmv_games" euro />
        </ChartCard>
        <ChartCard title="Revenue">
          <MiniLine data={chartData} dataKey="revenue" euro />
        </ChartCard>
        <ChartCard title="Transacted rate (%)">
          <MiniLine data={chartData} dataKey="rate" pct />
        </ChartCard>
      </section>

      <section className="rounded-xl border border-border overflow-hidden mb-8">
        <div className="px-4 py-3 border-b border-border bg-surface text-sm font-medium">Monthly comparison</div>
        <div className="max-h-[460px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface z-10 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left">Period</th>
                <th className="px-4 py-3 text-right">Games</th>
                <th className="px-4 py-3 text-right">Δ</th>
                <th className="px-4 py-3 text-right">GMV all</th>
                <th className="px-4 py-3 text-right">Δ</th>
                <th className="px-4 py-3 text-right">Revenue</th>
                <th className="px-4 py-3 text-right">Δ</th>
                <th className="px-4 py-3 text-right">Rate</th>
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
        <h3 className="text-sm font-medium mb-3">Risk history</h3>
        {history.filter((h) => h.result.flags.length > 0).length === 0 ? (
          <div className="text-sm text-muted-foreground">No risk flags triggered in any month.</div>
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
    </div>
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
        <Line type="monotone" dataKey={dataKey} stroke="oklch(0.18 0.02 250)" strokeWidth={2} dot={{ r: 2 }} />
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
