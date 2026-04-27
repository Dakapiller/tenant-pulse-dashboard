// Helpers de formatação (PT-PT)
export function formatEuro(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  if (Math.abs(v) < 10 && v !== 0) {
    return `€${v.toFixed(2).replace(".", ",")}`;
  }
  return `€${Math.round(v).toLocaleString("pt-PT")}`;
}

export function formatNumber(n: number | null | undefined): string {
  return Number(n ?? 0).toLocaleString("pt-PT");
}

export function formatPercent(n: number | null | undefined): string {
  return `${(Number(n ?? 0) * 100).toFixed(1).replace(".", ",")}%`;
}

export function periodLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("pt-PT", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function periodShort(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("pt-PT", { month: "short", year: "2-digit", timeZone: "UTC" });
}
