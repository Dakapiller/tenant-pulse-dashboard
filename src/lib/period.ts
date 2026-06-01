// Period selection model used by the dashboard PeriodSelector.
// `periods` (descending list of "YYYY-MM-01" strings) comes from fetchPeriods().

export type PeriodMode = "month" | "range" | "ytd" | "year" | "all";

export interface PeriodSelection {
  mode: PeriodMode;
  month?: string; // YYYY-MM-01
  from?: string;  // YYYY-MM-01 (inclusive)
  to?: string;    // YYYY-MM-01 (inclusive)
  year?: number;
}

export interface ResolvedPeriod {
  start: string;          // YYYY-MM-01 (earliest included period)
  end: string;            // YYYY-MM-01 (latest included period)
  periods: string[];      // sorted ascending, intersected with available
  label: string;
}

const MONTHS_PT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function monthLabel(iso: string): string {
  const d = new Date(iso);
  return `${MONTHS_PT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function yearOf(iso: string): number {
  return new Date(iso).getUTCFullYear();
}

export function resolvePeriod(sel: PeriodSelection, available: string[]): ResolvedPeriod | null {
  if (available.length === 0) return null;
  const asc = [...available].sort();
  const min = asc[0];
  const max = asc[asc.length - 1];

  let from = min;
  let to = max;
  let label = "Todo o período";

  switch (sel.mode) {
    case "month": {
      const m = sel.month ?? max;
      from = m; to = m;
      label = monthLabel(m);
      break;
    }
    case "range": {
      from = sel.from ?? min;
      to = sel.to ?? max;
      if (from > to) [from, to] = [to, from];
      label = `${monthLabel(from)} – ${monthLabel(to)}`;
      break;
    }
    case "ytd": {
      const y = new Date().getUTCFullYear();
      from = `${y}-01-01`;
      to = max;
      label = `YTD ${y}`;
      break;
    }
    case "year": {
      const y = sel.year ?? yearOf(max);
      from = `${y}-01-01`;
      to = `${y}-12-01`;
      label = `Ano ${y}`;
      break;
    }
    case "all": {
      from = min; to = max;
      label = "Todo o período";
      break;
    }
  }

  const periods = asc.filter((p) => p >= from && p <= to);
  if (periods.length === 0) return null;
  return {
    start: periods[0],
    end: periods[periods.length - 1],
    periods,
    label,
  };
}

export function availableYears(available: string[]): number[] {
  const set = new Set<number>();
  for (const p of available) set.add(yearOf(p));
  return [...set].sort((a, b) => b - a);
}
