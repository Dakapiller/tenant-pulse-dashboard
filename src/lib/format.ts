// Format helpers per spec
export function formatEuro(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  if (Math.abs(v) < 10 && v !== 0) {
    return `€${v.toFixed(2)}`;
  }
  return `€${Math.round(v).toLocaleString("en-US")}`;
}

export function formatNumber(n: number | null | undefined): string {
  return Number(n ?? 0).toLocaleString("en-US");
}

export function formatPercent(n: number | null | undefined): string {
  return `${Number(n ?? 0).toFixed(1)}%`;
}

export function periodLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function periodShort(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
}
