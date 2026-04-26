import type { Snapshot } from "@/lib/data";

export type RiskFlag =
  | "games_dropping"
  | "no_revenue"
  | "saas_only"
  | "rate_declining"
  | "gmv_stagnant"
  | "spike_then_crash";

export const FLAG_META: Record<RiskFlag, { label: string; points: number; description: string }> = {
  games_dropping: { label: "Games dropping", points: 30, description: "Games online down 2+ consecutive months" },
  no_revenue: { label: "No revenue", points: 25, description: "Revenue = 0 but GMV > 0" },
  saas_only: { label: "SaaS only", points: 20, description: "SaaS > 0 but no B2C commissions and no revenue" },
  rate_declining: { label: "Rate declining", points: 20, description: "Transacted rate dropped >10pp vs 2 months ago" },
  gmv_stagnant: { label: "GMV stagnant", points: 15, description: "GMV all changed <5% over last 2 months" },
  spike_then_crash: { label: "Spike then crash", points: 25, description: "Games spiked 2x then dropped back" },
};

export interface RiskResult {
  flags: RiskFlag[];
  score: number;
  level: "high" | "medium" | "healthy";
}

// snapshots = ALL snapshots for one tenant, sorted asc by period.
// We score the LAST snapshot using up to 3 most recent (last, prev, prev2).
export function computeRisk(snapshots: Snapshot[]): RiskResult {
  if (snapshots.length === 0) return { flags: [], score: 0, level: "healthy" };
  const sorted = [...snapshots].sort((a, b) => a.period.localeCompare(b.period));
  const last = sorted[sorted.length - 1];
  const prev = sorted[sorted.length - 2];
  const prev2 = sorted[sorted.length - 3];

  const flags: RiskFlag[] = [];

  // games_dropping: down 2+ consecutive months → need last < prev < prev2
  if (prev && prev2 && last.games_online < prev.games_online && prev.games_online < prev2.games_online) {
    flags.push("games_dropping");
  }
  // no_revenue
  if (last.revenue === 0 && last.gmv_all > 0) flags.push("no_revenue");
  // saas_only
  if (last.saas > 0 && last.b2c_commissions === 0 && last.revenue === 0) flags.push("saas_only");
  // rate_declining: dropped >10pp vs 2 months ago
  if (prev2 && prev2.transacted_rate - last.transacted_rate > 10) flags.push("rate_declining");
  // gmv_stagnant: <5% change over last 2 months (compare last vs prev2)
  if (prev2 && prev2.gmv_all > 0) {
    const change = Math.abs((last.gmv_all - prev2.gmv_all) / prev2.gmv_all);
    if (change < 0.05) flags.push("gmv_stagnant");
  }
  // spike_then_crash: prev > 2x prev2, last dropped back (last < prev)
  if (prev && prev2 && prev2.games_online > 0 && prev.games_online > 2 * prev2.games_online && last.games_online < prev.games_online) {
    flags.push("spike_then_crash");
  }

  const score = Math.min(100, flags.reduce((s, f) => s + FLAG_META[f].points, 0));
  const level: RiskResult["level"] = score >= 60 ? "high" : score >= 30 ? "medium" : "healthy";
  return { flags, score, level };
}

// For "Risk history" — score every month using its rolling 3-month window.
export function riskHistory(snapshots: Snapshot[]): { period: string; result: RiskResult }[] {
  const sorted = [...snapshots].sort((a, b) => a.period.localeCompare(b.period));
  return sorted.map((_, i) => ({
    period: sorted[i].period,
    result: computeRisk(sorted.slice(0, i + 1)),
  }));
}
