import type { Snapshot } from "@/lib/data";

// New conservative flag set: score only changes when a key metric moves >10%
// vs previous month, OR when there's a 4+ month consecutive negative trend.

export type RiskFlag =
  | "games_drop_5"
  | "gmv_drop_5"
  | "revenue_drop_5"
  | "rate_drop_5"
  | "games_trend_4m"
  | "gmv_trend_4m"
  | "revenue_trend_4m"
  | "no_revenue";

export const FLAG_META: Record<RiskFlag, { label: string; points: number; description: string }> = {
  games_drop_5:      { label: "Jogos em queda",   points: 25, description: "Jogos online caíram mais de 10% vs mês anterior" },
  gmv_drop_5:        { label: "GMV em queda",     points: 20, description: "GMV total caiu mais de 10% vs mês anterior" },
  revenue_drop_5:    { label: "Receita em queda", points: 25, description: "Receita caiu mais de 10% vs mês anterior" },
  rate_drop_5:       { label: "Taxa em queda",    points: 20, description: "Taxa transacionada caiu mais de 10pp vs mês anterior" },
  games_trend_4m:    { label: "Tendência negativa: jogos",   points: 30, description: "Jogos online a cair há 4+ meses consecutivos" },
  gmv_trend_4m:      { label: "Tendência negativa: GMV",     points: 25, description: "GMV total a cair há 4+ meses consecutivos" },
  revenue_trend_4m:  { label: "Tendência negativa: receita", points: 30, description: "Receita a cair há 4+ meses consecutivos" },
  no_revenue:        { label: "Sem receita",      points: 25, description: "Existe GMV mas a receita é zero" },
};

export const FLAG_CTA: Record<RiskFlag, { reason: string; cta: string }> = {
  games_drop_5: {
    reason: "Jogos online caíram mais de 10% vs mês anterior",
    cta: "Verificar se há quebra de procura ou problema técnico. Propor revisão da utilização da plataforma.",
  },
  gmv_drop_5: {
    reason: "GMV total caiu mais de 10% vs mês anterior",
    cta: "Compreender a quebra de volume. Propor ações comerciais ou de marketing.",
  },
  revenue_drop_5: {
    reason: "Receita caiu mais de 10% vs mês anterior",
    cta: "Investigar causas da quebra de receita. Confirmar pricing e fluxo de pagamento.",
  },
  rate_drop_5: {
    reason: "Taxa transacionada caiu mais de 10pp vs mês anterior",
    cta: "Investigar abandono no checkout e propor revisão de UX/pricing.",
  },
  games_trend_4m: {
    reason: "Jogos online em queda contínua há 4+ meses",
    cta: "Marcar reunião urgente. Sinal claro de desengajamento prolongado.",
  },
  gmv_trend_4m: {
    reason: "GMV em queda contínua há 4+ meses",
    cta: "Rever plano comercial e benchmarks com clubes semelhantes.",
  },
  revenue_trend_4m: {
    reason: "Receita em queda contínua há 4+ meses",
    cta: "Reunião de retenção urgente. Compreender fricções e propor plano de recuperação.",
  },
  no_revenue: {
    reason: "GMV existe mas a receita é zero — reservas não estão a converter",
    cta: "Compreender o fluxo de pagamento. Apoiar ativação ou revisão da configuração comercial.",
  },
};

export interface FlagDetail {
  flag: RiskFlag;
  label: string;
  points: number;
  reason: string; // human-readable, includes concrete numbers when available
}

export interface RiskResult {
  flags: RiskFlag[];
  flagDetails: FlagDetail[];
  score: number;
  level: "high" | "medium" | "healthy";
  dataScore?: number;
  csModifier?: number;
}

function pctChange(prev: number, cur: number): number | null {
  if (!isFinite(prev) || prev === 0) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}

function fmtPct(n: number): string {
  return `${n > 0 ? "+" : ""}${n.toFixed(1).replace(".", ",")}%`;
}

function fmtEuro(n: number): string {
  return `€${Math.round(n).toLocaleString("pt-PT")}`;
}

function fmtNum(n: number): string {
  return Math.round(n).toLocaleString("pt-PT");
}

// Returns true if the metric strictly decreases over the last `n` snapshots
// (i.e. n-1 consecutive month-over-month drops). Requires at least n snapshots.
function hasNegativeTrend(values: number[], n: number): boolean {
  if (values.length < n) return false;
  const tail = values.slice(-n);
  for (let i = 1; i < tail.length; i++) {
    if (!(tail[i] < tail[i - 1])) return false;
  }
  return true;
}

// snapshots = ALL snapshots for one tenant. We compute risk against the latest one.
export function computeRisk(snapshots: Snapshot[]): RiskResult {
  if (snapshots.length === 0) {
    return { flags: [], flagDetails: [], score: 0, level: "healthy", dataScore: 0, csModifier: 0 };
  }
  const sorted = [...snapshots].sort((a, b) => a.period.localeCompare(b.period));
  const last = sorted[sorted.length - 1];
  const prev = sorted[sorted.length - 2];

  const details: FlagDetail[] = [];
  const push = (flag: RiskFlag, reason: string) => {
    const meta = FLAG_META[flag];
    details.push({ flag, label: meta.label, points: meta.points, reason });
  };

  // ---- Month-over-month >5% drops ----
  if (prev) {
    const dGames = pctChange(prev.games_online, last.games_online);
    if (dGames !== null && dGames < -5) {
      push("games_drop_5", `Jogos caíram ${fmtPct(dGames)} (${fmtNum(prev.games_online)} → ${fmtNum(last.games_online)})`);
    }
    const dGmv = pctChange(prev.gmv_all, last.gmv_all);
    if (dGmv !== null && dGmv < -5) {
      push("gmv_drop_5", `GMV caiu ${fmtPct(dGmv)} (${fmtEuro(prev.gmv_all)} → ${fmtEuro(last.gmv_all)})`);
    }
    const dRev = pctChange(prev.revenue, last.revenue);
    if (dRev !== null && dRev < -5) {
      push("revenue_drop_5", `Receita caiu ${fmtPct(dRev)} (${fmtEuro(prev.revenue)} → ${fmtEuro(last.revenue)})`);
    }
    const ratePp = (last.transacted_rate - prev.transacted_rate) * 100; // percentage points
    if (ratePp < -5) {
      push("rate_drop_5", `Taxa transacionada caiu ${ratePp.toFixed(1).replace(".", ",")}pp (${(prev.transacted_rate * 100).toFixed(1)}% → ${(last.transacted_rate * 100).toFixed(1)}%)`);
    }
  }

  // ---- 4+ month consecutive negative trends ----
  const games = sorted.map((s) => s.games_online);
  const gmv = sorted.map((s) => s.gmv_all);
  const rev = sorted.map((s) => s.revenue);
  if (hasNegativeTrend(games, 4)) {
    push("games_trend_4m", `Jogos a cair há 4 meses consecutivos (${fmtNum(games[games.length - 4])} → ${fmtNum(games[games.length - 1])})`);
  }
  if (hasNegativeTrend(gmv, 4)) {
    push("gmv_trend_4m", `GMV a cair há 4 meses consecutivos (${fmtEuro(gmv[gmv.length - 4])} → ${fmtEuro(gmv[gmv.length - 1])})`);
  }
  if (hasNegativeTrend(rev, 4)) {
    push("revenue_trend_4m", `Receita a cair há 4 meses consecutivos (${fmtEuro(rev[rev.length - 4])} → ${fmtEuro(rev[rev.length - 1])})`);
  }

  // ---- Structural: GMV but no revenue ----
  if (last.revenue === 0 && last.gmv_all > 0) {
    push("no_revenue", `Existe GMV (${fmtEuro(last.gmv_all)}) mas a receita está a zero`);
  }

  const flags = details.map((d) => d.flag);
  // Flags are informational only — they do NOT add to the health score.
  // The real score lives in cs_tenant_status.health_score (see src/lib/health.ts).
  // We keep `flagDetails` (with their `points`) so the UI can still render the
  // descriptive badges, but the returned `score`/`level` are neutral.
  return { flags, flagDetails: details, score: 0, level: "healthy", dataScore: 0, csModifier: 0 };
}

// CS outcome / club-status modifiers. Negative = healthier.
export const CS_MODIFIER: Record<string, number> = {
  bad_relationship: 25,
  good_receptivity: -15,
  very_satisfied: -30,
  status_possible_churn: 10,
  status_changed_owner: 0,
  status_closed: 0,
  status_active: 0,
  status_churned: 0,
};

export interface CSStatusEntry {
  relationship_status: string;
  recorded_at: string;
}

export function computeRiskWithCS(
  snapshots: Snapshot[],
  csStatuses: CSStatusEntry[],
): RiskResult & { suppressed: boolean } {
  const base = computeRisk(snapshots);

  // CS modifiers no longer affect the health score (the real score is managed
  // exclusively by src/lib/health.ts). We still derive `suppressed` so the
  // legacy callers don't crash, but it's no longer used by task generation.
  const sorted = [...csStatuses].sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
  let suppressed = false;
  const fourWeeksAgo = Date.now() - 28 * 24 * 60 * 60 * 1000;
  for (const s of sorted) {
    if (s.relationship_status === "very_satisfied" && new Date(s.recorded_at).getTime() >= fourWeeksAgo) {
      suppressed = true;
      break;
    }
  }

  return {
    flags: base.flags,
    flagDetails: base.flagDetails,
    score: 0,
    level: "healthy",
    dataScore: 0,
    csModifier: 0,
    suppressed,
  };
}

export function riskHistory(snapshots: Snapshot[]): { period: string; result: RiskResult }[] {
  const sorted = [...snapshots].sort((a, b) => a.period.localeCompare(b.period));
  return sorted.map((_, i) => ({
    period: sorted[i].period,
    result: computeRisk(sorted.slice(0, i + 1)),
  }));
}

export function previousMonthRisk(
  snapshots: Snapshot[],
  csStatuses: CSStatusEntry[] = [],
): RiskResult | null {
  if (snapshots.length < 2) return null;
  const sorted = [...snapshots].sort((a, b) => a.period.localeCompare(b.period));
  const last = sorted[sorted.length - 1];
  const previousSlice = sorted.filter((s) => s.period < last.period);
  if (previousSlice.length === 0) return null;
  const prevPeriod = previousSlice[previousSlice.length - 1].period;
  const cutoff = `${prevPeriod.slice(0, 7)}-31T23:59:59Z`;
  const filteredStatuses = csStatuses.filter((s) => !s.recorded_at || s.recorded_at <= cutoff);
  return computeRiskWithCS(previousSlice, filteredStatuses);
}
