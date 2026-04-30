import type { Snapshot } from "@/lib/data";

export interface YoYMetric {
  key: "gmv_all" | "games_online" | "revenue" | "transacted_rate";
  label: string;
  current: number;
  previous: number | null;
  pctChange: number | null; // null se não há ano anterior ou base = 0
  isPercent?: boolean;
}

/**
 * Given the full history (asc or desc) and a reference period (YYYY-MM-DD),
 * return YoY comparison vs the same calendar month one year earlier.
 */
export function computeYoY(history: Snapshot[], referencePeriod: string): YoYMetric[] | null {
  const ref = history.find((s) => s.period === referencePeriod);
  if (!ref) return null;

  const refDate = new Date(ref.period);
  const prevYear = new Date(Date.UTC(refDate.getUTCFullYear() - 1, refDate.getUTCMonth(), 1));
  const prevPeriod = prevYear.toISOString().slice(0, 10);
  const prev = history.find((s) => s.period === prevPeriod) ?? null;

  const build = (
    key: YoYMetric["key"],
    label: string,
    isPercent = false,
  ): YoYMetric => {
    const cur = Number(ref[key] ?? 0);
    const old = prev ? Number(prev[key] ?? 0) : null;
    let pct: number | null = null;
    if (old !== null && Math.abs(old) > 0) {
      pct = ((cur - old) / Math.abs(old)) * 100;
    } else if (old !== null && old === 0 && cur > 0) {
      pct = null; // crescimento a partir de zero — não é representável em %
    }
    return { key, label, current: cur, previous: old, pctChange: pct, isPercent };
  };

  return [
    build("gmv_all", "GMV"),
    build("games_online", "Jogos online"),
    build("revenue", "Receita"),
    build("transacted_rate", "Taxa de conversão", true),
  ];
}
