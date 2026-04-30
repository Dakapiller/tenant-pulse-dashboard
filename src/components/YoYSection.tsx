import { useMemo } from "react";
import type { Snapshot } from "@/lib/data";
import { computeYoY } from "@/lib/yoy";
import { formatEuro, formatNumber, formatPercent, periodLabel } from "@/lib/format";
import { TrendingDown, TrendingUp, Minus } from "lucide-react";

interface YoYSectionProps {
  history: Snapshot[];
}

function formatValue(value: number, key: string, isPercent?: boolean): string {
  if (isPercent) return formatPercent(value);
  if (key === "games_online") return formatNumber(value);
  return formatEuro(value);
}

export function YoYSection({ history }: YoYSectionProps) {
  const sorted = useMemo(
    () => [...history].sort((a, b) => a.period.localeCompare(b.period)),
    [history],
  );
  const latest = sorted[sorted.length - 1];
  const yoy = useMemo(
    () => (latest ? computeYoY(sorted, latest.period) : null),
    [sorted, latest],
  );

  if (!latest || !yoy) return null;

  const refDate = new Date(latest.period);
  const prevYearLabel = `${refDate.toLocaleString("pt-PT", { month: "short", timeZone: "UTC" })} ${refDate.getUTCFullYear() - 1}`;

  return (
    <section className="rounded-lg border border-border overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border bg-surface text-sm font-medium flex items-center justify-between gap-2">
        <span>Comparação anual (YoY)</span>
        <span className="text-[11px] font-normal text-muted-foreground">
          {periodLabel(latest.period)} vs {prevYearLabel}
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-border">
        {yoy.map((m) => {
          const pct = m.pctChange;
          const tone =
            pct === null
              ? "text-muted-foreground"
              : pct > 0.5
              ? "text-success"
              : pct < -0.5
              ? "text-danger"
              : "text-muted-foreground";
          const Icon = pct === null ? Minus : pct > 0.5 ? TrendingUp : pct < -0.5 ? TrendingDown : Minus;
          return (
            <div key={m.key} className="p-3 space-y-1">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{m.label}</div>
              <div className="text-sm font-semibold tabular-nums">
                {formatValue(m.current, m.key, m.isPercent)}
              </div>
              <div className={`flex items-center gap-1 text-xs font-medium tabular-nums ${tone}`}>
                <Icon className="h-3 w-3" />
                {pct === null ? (
                  <span>{m.previous === null ? "Sem ano anterior" : "—"}</span>
                ) : (
                  <span>
                    {pct > 0 ? "+" : ""}
                    {pct.toFixed(1).replace(".", ",")}%
                  </span>
                )}
              </div>
              {m.previous !== null && (
                <div className="text-[10px] text-muted-foreground tabular-nums">
                  {prevYearLabel}: {formatValue(m.previous, m.key, m.isPercent)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
