import type { Snapshot } from "@/lib/data";

export type RiskFlag =
  | "games_dropping"
  | "no_revenue"
  | "saas_only"
  | "rate_declining"
  | "gmv_stagnant"
  | "spike_then_crash";

export const FLAG_META: Record<RiskFlag, { label: string; points: number; description: string }> = {
  games_dropping: { label: "Jogos a cair", points: 30, description: "Jogos online em queda há 2+ meses consecutivos" },
  no_revenue: { label: "Sem receita", points: 25, description: "Receita = 0 mas GMV > 0" },
  saas_only: { label: "Só SaaS", points: 20, description: "SaaS > 0 mas sem comissões B2C nem receita" },
  rate_declining: { label: "Taxa em queda", points: 20, description: "Taxa transacionada caiu mais de 10pp face a 2 meses atrás" },
  gmv_stagnant: { label: "GMV estagnado", points: 15, description: "GMV total variou menos de 5% nos últimos 2 meses" },
  spike_then_crash: { label: "Pico e queda", points: 25, description: "Jogos duplicaram e voltaram a cair" },
};

export const FLAG_CTA: Record<RiskFlag, { reason: string; cta: string }> = {
  games_dropping: {
    reason: "Jogos online em queda há 2+ meses consecutivos",
    cta: "Verificar se há um problema técnico ou quebra de procura. Propor uma reunião de revisão da plataforma.",
  },
  no_revenue: {
    reason: "Existe GMV mas a receita é zero — as reservas não estão a converter",
    cta: "Compreender o fluxo de pagamento. Oferecer apoio na ativação ou revisão da configuração comercial.",
  },
  saas_only: {
    reason: "Paga SaaS mas sem atividade B2C — a ferramenta não está a ser usada comercialmente",
    cta: "Marcar uma demonstração das funcionalidades B2C. Mostrar o valor das reservas online vs. manuais.",
  },
  rate_declining: {
    reason: "A taxa transacionada caiu significativamente — menos reservas a concluir o pagamento",
    cta: "Investigar abandono no checkout. Propor revisão de UX ou orientação de pricing.",
  },
  gmv_stagnant: {
    reason: "O GMV quase não variou em 2 meses — crescimento estagnado",
    cta: "Discutir alavancas de crescimento. Partilhar benchmarks com clubes semelhantes.",
  },
  spike_then_crash: {
    reason: "Pico inesperado de atividade seguido de uma queda acentuada",
    cta: "Compreender o que causou o pico e a queda. Pode ser um evento pontual ou um sinal de churn.",
  },
};

export interface RiskResult {
  flags: RiskFlag[];
  score: number;
  level: "high" | "medium" | "healthy";
  dataScore?: number;
  csModifier?: number;
}

// snapshots = ALL snapshots for one tenant, sorted asc by period.
// We score the LAST snapshot using up to 3 most recent (last, prev, prev2).
export function computeRisk(snapshots: Snapshot[]): RiskResult {
  if (snapshots.length === 0) return { flags: [], score: 0, level: "healthy", dataScore: 0, csModifier: 0 };
  const sorted = [...snapshots].sort((a, b) => a.period.localeCompare(b.period));
  const last = sorted[sorted.length - 1];
  const prev = sorted[sorted.length - 2];
  const prev2 = sorted[sorted.length - 3];

  const flags: RiskFlag[] = [];

  if (prev && prev2 && last.games_online < prev.games_online && prev.games_online < prev2.games_online) {
    flags.push("games_dropping");
  }
  if (last.revenue === 0 && last.gmv_all > 0) flags.push("no_revenue");
  if (last.saas > 0 && last.b2c_commissions === 0 && last.revenue === 0) flags.push("saas_only");
  if (prev2 && (prev2.transacted_rate - last.transacted_rate) * 100 > 10) flags.push("rate_declining");
  if (prev2 && prev2.gmv_all > 0) {
    const change = Math.abs((last.gmv_all - prev2.gmv_all) / prev2.gmv_all);
    if (change < 0.05) flags.push("gmv_stagnant");
  }
  if (prev && prev2 && prev2.games_online > 0 && prev.games_online > 2 * prev2.games_online && last.games_online < prev.games_online) {
    flags.push("spike_then_crash");
  }

  const dataScore = Math.min(100, flags.reduce((s, f) => s + FLAG_META[f].points, 0));
  const score = dataScore;
  const level: RiskResult["level"] = score >= 60 ? "high" : score >= 30 ? "medium" : "healthy";
  return { flags, score, level, dataScore, csModifier: 0 };
}

// CS outcome / club-status modifiers. Negative = healthier.
export const CS_MODIFIER: Record<string, number> = {
  // relationship outcomes
  bad_relationship: 25,
  good_receptivity: -15,
  very_satisfied: -30,
  // club lifecycle status modifiers
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

// Aggregate CS modifier from recent statuses. Most-recent relationship outcome dominates;
// "very_satisfied" within last 4 weeks → suppress new task generation.
// Latest lifecycle status (status_*) adds its own modifier on top.
export function computeRiskWithCS(
  snapshots: Snapshot[],
  csStatuses: CSStatusEntry[],
): RiskResult & { suppressed: boolean } {
  const base = computeRisk(snapshots);

  // Sort statuses oldest → newest.
  const sorted = [...csStatuses].sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
  let modifier = 0;
  let suppressed = false;
  const fourWeeksAgo = Date.now() - 28 * 24 * 60 * 60 * 1000;

  // Latest relationship outcome (non-status_*) — represents current relationship.
  let latestOutcome: CSStatusEntry | undefined;
  let latestStatus: CSStatusEntry | undefined;
  for (const s of sorted) {
    if (s.relationship_status.startsWith("status_")) latestStatus = s;
    else latestOutcome = s;
  }
  if (latestOutcome && CS_MODIFIER[latestOutcome.relationship_status] !== undefined) {
    modifier += CS_MODIFIER[latestOutcome.relationship_status];
  }
  if (latestStatus && CS_MODIFIER[latestStatus.relationship_status] !== undefined) {
    modifier += CS_MODIFIER[latestStatus.relationship_status];
  }

  // Suppression: any "very_satisfied" within last 4 weeks
  for (const s of sorted) {
    if (s.relationship_status === "very_satisfied" && new Date(s.recorded_at).getTime() >= fourWeeksAgo) {
      suppressed = true;
      break;
    }
  }

  const dataScore = base.dataScore ?? base.score;
  const finalScore = Math.max(0, Math.min(100, dataScore + modifier));
  const level: RiskResult["level"] = finalScore >= 60 ? "high" : finalScore >= 30 ? "medium" : "healthy";

  return {
    flags: base.flags,
    score: finalScore,
    level,
    dataScore,
    csModifier: modifier,
    suppressed,
  };
}

// For "Risk history" — score every month using its rolling 3-month window.
export function riskHistory(snapshots: Snapshot[]): { period: string; result: RiskResult }[] {
  const sorted = [...snapshots].sort((a, b) => a.period.localeCompare(b.period));
  return sorted.map((_, i) => ({
    period: sorted[i].period,
    result: computeRisk(sorted.slice(0, i + 1)),
  }));
}
