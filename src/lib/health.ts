// Health score system. The score lives on `cs_tenant_status.health_score`
// and EVERY change is logged in `health_score_log`. The score can ONLY change
// through these three rules (enforced in the apply* helpers below):
//
//   Rule 1 — New club → 100 (initial baseline)
//   Rule 2 — Upload delta:
//              any of {games_online, gmv_all, revenue} ↓ >10% vs prev → −10
//              all of {games_online, gmv_all, revenue} ↑ >10% vs prev → +10
//              mixed → no change, no task
//   Rule 3 — Task outcome:
//              bad_relationship   → −25
//              good_receptivity   → +10
//              very_satisfied     → +25
//
// Score is always clamped to [0, 100].

import { supabase } from "@/integrations/supabase/client";
import type { Snapshot } from "@/lib/data";

export type HealthLevel = "risk" | "monitor" | "healthy";
export type HealthSource = "upload" | "task";

export interface HealthScoreLog {
  id: string;
  tenant_name: string;
  changed_at: string;
  previous_score: number;
  new_score: number;
  delta: number;
  reason: string;
  source: HealthSource;
}

export const HEALTH_LEVEL_LABEL: Record<HealthLevel, string> = {
  risk: "Em risco",
  monitor: "A monitorizar",
  healthy: "Saudável",
};

export function healthLevel(score: number | null | undefined): HealthLevel {
  const s = Math.max(0, Math.min(100, Number(score ?? 0)));
  if (s < 30) return "risk";
  if (s < 60) return "monitor";
  return "healthy";
}

export function clampScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

// ---- Outcome → delta mapping (Rule 3) ----
export const OUTCOME_HEALTH_DELTA: Record<string, number> = {
  bad_relationship: -25,
  good_receptivity: 10,
  very_satisfied: 25,
};

export function outcomeReason(outcome: string): string {
  switch (outcome) {
    case "bad_relationship": return "Resultado de tarefa: Má relação";
    case "good_receptivity": return "Resultado de tarefa: Boa recetividade";
    case "very_satisfied":   return "Resultado de tarefa: Cliente ficou muito satisfeito";
    default: return `Resultado de tarefa: ${outcome}`;
  }
}

// ---- Reads ----

export async function fetchHealthScores(): Promise<Map<string, number>> {
  // Latest score per tenant (one row per tenant in cs_tenant_status holds the
  // current score, but multiple rows per tenant exist; take the most recent
  // non-null one).
  const { data, error } = await supabase
    .from("cs_tenant_status")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .select("tenant_name, health_score, recorded_at" as any)
    .not("health_score", "is", null)
    .order("recorded_at", { ascending: false });
  if (error) throw error;
  const map = new Map<string, number>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (data as any[] ?? []).forEach((r) => {
    if (!map.has(r.tenant_name) && r.health_score != null) {
      map.set(r.tenant_name, Number(r.health_score));
    }
  });
  return map;
}

export async function fetchHealthScoreForTenant(tenant: string): Promise<number | null> {
  const { data, error } = await supabase
    .from("cs_tenant_status")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .select("health_score, recorded_at" as any)
    .eq("tenant_name", tenant)
    .not("health_score", "is", null)
    .order("recorded_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = (data as any[] ?? [])[0];
  return row?.health_score != null ? Number(row.health_score) : null;
}

/**
 * Snapshot of every tenant's health score AS OF `beforeIso` (exclusive).
 * Reads `health_score_log` and returns the most recent `new_score` per tenant
 * with `changed_at < beforeIso`. Tenants with no entry before the cutoff are
 * absent from the map (caller should treat them as "unknown" or default 100).
 */
export async function fetchHealthScoresAt(beforeIso: string): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const pageSize = 1000;
  let from = 0;
  // Page through ALL log rows before cutoff, ordered desc; first hit per tenant wins.
  // Most projects have a few thousand rows total — well within a handful of pages.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await supabase
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("health_score_log" as any)
      .select("tenant_name, new_score, changed_at")
      .lt("changed_at", beforeIso)
      .order("changed_at", { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = (data ?? []) as unknown as { tenant_name: string; new_score: number; changed_at: string }[];
    for (const r of rows) {
      if (!map.has(r.tenant_name)) map.set(r.tenant_name, Number(r.new_score));
    }
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return map;
}

export async function fetchHealthLog(tenant?: string, limit = 200): Promise<HealthScoreLog[]> {
  let q = supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from("health_score_log" as any)
    .select("*")
    .order("changed_at", { ascending: false })
    .limit(limit);
  if (tenant) q = q.eq("tenant_name", tenant);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as HealthScoreLog[];
}

// ---- Writes ----

/**
 * Dynamic score floor based on recent CS outcomes:
 *   - very_satisfied  in last 3 months → floor 80
 *   - good_receptivity in last 2 months → floor 60
 *   - bad_relationship                  → no floor
 * Returns 0 if no outcome applies. Multiple → highest floor wins.
 */
export async function getScoreFloor(tenant: string): Promise<{ floor: number; outcome: string | null; recordedAt: string | null }> {
  const now = Date.now();
  const cutoff3m = new Date(now - 1000 * 60 * 60 * 24 * 92).toISOString();
  const { data, error } = await supabase
    .from("cs_tenant_status")
    .select("relationship_status, recorded_at")
    .eq("tenant_name", tenant)
    .in("relationship_status", ["very_satisfied", "good_receptivity"])
    .gte("recorded_at", cutoff3m)
    .order("recorded_at", { ascending: false });
  if (error) return { floor: 0, outcome: null, recordedAt: null };
  const cutoff2mTs = now - 1000 * 60 * 60 * 24 * 61;
  let best = { floor: 0, outcome: null as string | null, recordedAt: null as string | null };
  for (const row of (data ?? []) as { relationship_status: string; recorded_at: string }[]) {
    const ts = new Date(row.recorded_at).getTime();
    if (row.relationship_status === "very_satisfied" && ts >= now - 1000 * 60 * 60 * 24 * 92) {
      if (80 > best.floor) best = { floor: 80, outcome: "very_satisfied", recordedAt: row.recorded_at };
    } else if (row.relationship_status === "good_receptivity" && ts >= cutoff2mTs) {
      if (60 > best.floor) best = { floor: 60, outcome: "good_receptivity", recordedAt: row.recorded_at };
    }
  }
  return best;
}

function floorOutcomeLabel(outcome: string): string {
  if (outcome === "very_satisfied") return "Cliente muito satisfeito";
  if (outcome === "good_receptivity") return "Boa recetividade";
  return outcome;
}

/**
 * Persist a new score for a tenant: writes the log entry and updates the
 * latest cs_tenant_status row (or creates one if none exists). Returns the
 * new clamped score. Applies the dynamic floor before persisting.
 */
async function persistScoreChange(
  tenant: string,
  prev: number,
  next: number,
  reason: string,
  source: HealthSource,
  changedAt?: string,
): Promise<number> {
  let clamped = clampScore(next);

  // Apply dynamic floor (skip floor logic for the very initial Rule 1 baseline of new clubs to avoid noisy log).
  const floorInfo = await getScoreFloor(tenant);
  let floorApplied: { floor: number; outcome: string; recordedAt: string } | null = null;
  if (floorInfo.floor > 0 && clamped < floorInfo.floor) {
    floorApplied = { floor: floorInfo.floor, outcome: floorInfo.outcome!, recordedAt: floorInfo.recordedAt! };
    clamped = floorInfo.floor;
  }

  if (clamped !== prev) {
    await supabase
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("health_score_log" as any)
      .insert({
        tenant_name: tenant,
        previous_score: prev,
        new_score: floorApplied ? clampScore(next) : clamped, // log raw computed first
        delta: (floorApplied ? clampScore(next) : clamped) - prev,
        reason,
        source,
        ...(changedAt ? { changed_at: changedAt } : {}),
      } as never);
  }

  // If floor lifted us above the raw computed score, log the clamp as a separate entry.
  if (floorApplied) {
    const raw = clampScore(next);
    if (clamped !== raw) {
      const dateStr = new Date(floorApplied.recordedAt).toISOString().slice(0, 10);
      await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from("health_score_log" as any)
        .insert({
          tenant_name: tenant,
          previous_score: raw,
          new_score: clamped,
          delta: clamped - raw,
          reason: `Score mantido acima do mínimo — ${floorOutcomeLabel(floorApplied.outcome)} registado em ${dateStr}`,
          source: "task" as HealthSource,
        } as never);
    }
  }

  if (clamped === prev) return prev;

  // Update the most recent cs_tenant_status row for this tenant; fall back to insert.
  const { data: latest } = await supabase
    .from("cs_tenant_status")
    .select("id")
    .eq("tenant_name", tenant)
    .order("recorded_at", { ascending: false })
    .limit(1);
  const latestId = (latest as { id: string }[] | null)?.[0]?.id;
  if (latestId) {
    await supabase
      .from("cs_tenant_status")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({ health_score: clamped } as any)
      .eq("id", latestId);
  } else {
    await supabase
      .from("cs_tenant_status")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .insert({ tenant_name: tenant, relationship_status: "status_active", club_status: "active", health_score: clamped } as any);
  }
  return clamped;
}

/** Rule 3 — applies a task outcome on top of the current score. */
export async function applyTaskOutcome(tenant: string, outcome: string): Promise<void> {
  const delta = OUTCOME_HEALTH_DELTA[outcome] ?? 0;
  if (delta === 0) return;
  const cur = (await fetchHealthScoreForTenant(tenant)) ?? 100;
  await persistScoreChange(tenant, cur, cur + delta, outcomeReason(outcome), "task");
}

/**
 * Manual override of a tenant's health_score by a CS user. Bypasses the
 * dynamic floor (Rule 4) — manual is deliberate. Logs to health_score_log
 * with source 'manual' or 'manual_bulk' and writes the user's comment into
 * the reason field so it shows in the existing history UI.
 */
export async function applyManualScoreChange(
  tenant: string,
  newScore: number,
  comment: string,
  source: "manual" | "manual_bulk" = "manual",
  changedBy: string = "cs",
): Promise<number> {
  const clean = comment.trim();
  if (clean.length < 5) throw new Error("Comentário obrigatório (mín. 5 caracteres).");
  const clamped = clampScore(newScore);
  const prev = (await fetchHealthScoreForTenant(tenant)) ?? 100;
  if (clamped === prev) return prev;

  await supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from("health_score_log" as any)
    .insert({
      tenant_name: tenant,
      previous_score: prev,
      new_score: clamped,
      delta: clamped - prev,
      reason: `Ajuste manual: ${clean}`,
      source,
      changed_by: changedBy,
    } as never);

  // Update or insert latest cs_tenant_status row.
  const { data: latest } = await supabase
    .from("cs_tenant_status")
    .select("id")
    .eq("tenant_name", tenant)
    .order("recorded_at", { ascending: false })
    .limit(1);
  const latestId = (latest as { id: string }[] | null)?.[0]?.id;
  if (latestId) {
    await supabase
      .from("cs_tenant_status")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({ health_score: clamped } as any)
      .eq("id", latestId);
  } else {
    await supabase
      .from("cs_tenant_status")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .insert({ tenant_name: tenant, relationship_status: "status_active", club_status: "active", health_score: clamped } as any);
  }
  return clamped;
}

/**
 * Rule 1 + Rule 2 — given the previous and current snapshot for a tenant, apply
 * any score change. Returns metadata describing what (if anything) happened so
 * the caller can also create the matching CS task.
 */
export interface UploadDeltaResult {
  tenant: string;
  prevScore: number;
  newScore: number;
  delta: number;
  reason: string | null;
  taskCta: string | null;
  taskPriority: number | null;
  isNew: boolean;
}

export function computeUploadDelta(
  prev: { games_online: number; gmv_all: number; revenue: number } | null,
  cur:  { games_online: number; gmv_all: number; revenue: number },
  prevScore: number | null,
): { delta: number; reason: string | null; taskCta: string | null; taskPriority: number | null; isNew: boolean } {
  if (prevScore === null) {
    // Rule 1 — new club
    return { delta: 100, reason: "Novo clube — score inicial atribuído", taskCta: null, taskPriority: null, isNew: true };
  }
  if (!prev) return { delta: 0, reason: null, taskCta: null, taskPriority: null, isNew: false };

  const pct = (a: number, b: number): number | null => {
    if (!(b > 0)) return null;
    return ((a - b) / b) * 100;
  };
  const dGames = pct(cur.games_online, prev.games_online);
  const dGmv   = pct(cur.gmv_all, prev.gmv_all);
  const dRev   = pct(cur.revenue, prev.revenue);

  const metrics: { name: string; pct: number | null }[] = [
    { name: "GMV", pct: dGmv },
    { name: "Jogos Online", pct: dGames },
    { name: "Receita", pct: dRev },
  ];

  let drops = 0, ups = 0;
  let worst: { name: string; pct: number } | null = null;
  for (const m of metrics) {
    if (m.pct === null) continue;
    if (m.pct < -5) {
      drops++;
      if (!worst || m.pct < worst.pct) worst = { name: m.name, pct: m.pct };
    } else if (m.pct > 5) {
      ups++;
    }
  }

  if (drops >= 1 && worst) {
    return {
      delta: -10,
      reason: `Queda de performance: ${worst.name} desceu ${Math.abs(worst.pct).toFixed(1)}%`,
      taskCta: "Contactar para perceber a quebra",
      taskPriority: 80,
      isNew: false,
    };
  }
  if (ups === 3) {
    return {
      delta: 10,
      reason: "Subida de performance: todos os indicadores subiram",
      taskCta: "Contactar para reforçar a relação",
      taskPriority: 30,
      isNew: false,
    };
  }
  return { delta: 0, reason: null, taskCta: null, taskPriority: null, isNew: false };
}

/**
 * Apply Rules 1+2 to all tenants given the snapshots for the just-uploaded period
 * and the prior period (one row per tenant). Side effects: writes health_score_log,
 * updates cs_tenant_status.health_score, and inserts pending cs_tasks for any
 * triggered change. Returns a summary of changes.
 */
export async function applyUploadScoreChanges(
  uploadedPeriod: string,
  weekStart: string,
  current: Snapshot[],
  previousByTenant: Map<string, Snapshot>,
  currentScores: Map<string, number>,
): Promise<UploadDeltaResult[]> {
  const results: UploadDeltaResult[] = [];
  for (const cur of current) {
    const tenant = cur.tenant_name;
    const prevSnap = previousByTenant.get(tenant) ?? null;
    const prevScore = currentScores.get(tenant) ?? null;
    const d = computeUploadDelta(
      prevSnap ? { games_online: Number(prevSnap.games_online ?? 0), gmv_all: Number(prevSnap.gmv_all ?? 0), revenue: Number(prevSnap.revenue ?? 0) } : null,
      { games_online: Number(cur.games_online ?? 0), gmv_all: Number(cur.gmv_all ?? 0), revenue: Number(cur.revenue ?? 0) },
      prevScore,
    );
    if (d.delta === 0 || d.reason === null) continue;

    const baselinePrev = prevScore ?? 0;
    const newScore = await persistScoreChange(
      tenant,
      d.isNew ? 0 : baselinePrev,
      d.isNew ? 100 : baselinePrev + d.delta,
      d.isNew ? `Novo clube — primeira aparição em ${uploadedPeriod.slice(0, 7)}` : d.reason,
      "upload",
    );
    results.push({
      tenant,
      prevScore: d.isNew ? 0 : baselinePrev,
      newScore,
      delta: newScore - (d.isNew ? 0 : baselinePrev),
      reason: d.reason,
      taskCta: d.taskCta,
      taskPriority: d.taskPriority,
      isNew: d.isNew,
    });

    // Rule 2 → also auto-generate / merge a CS task (Rule 1 doesn't generate one).
    if (!d.isNew && d.taskCta && d.taskPriority !== null && d.reason) {
      // Look for ANY existing pending task for this club + week — we merge into
      // it rather than ever creating a duplicate.
      const { data: existing } = await supabase
        .from("cs_tasks")
        .select("id, reason, cta, flags, priority")
        .eq("tenant_name", tenant)
        .eq("week_start", weekStart)
        .eq("status", "pending")
        .order("created_at", { ascending: true })
        .limit(1);
      const existingRow = (existing as { id: string; reason: string; cta: string; flags: string[] | null; priority: number }[] | null)?.[0];
      if (existingRow) {
        const existingReasons = (existingRow.reason ?? "").split("\n").filter((s) => s.trim().length > 0);
        if (!existingReasons.includes(d.reason)) {
          const mergedReason = [...existingReasons, d.reason].join("\n");
          const existingCtas = (existingRow.cta ?? "").split("\n").filter((s) => s.trim().length > 0);
          const mergedCta = [...existingCtas, d.taskCta].join("\n");
          const mergedFlags = [...(existingRow.flags ?? []), `upload_delta:${d.reason}`];
          const mergedPriority = Math.max(existingRow.priority, d.taskPriority);
          await supabase
            .from("cs_tasks")
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .update({ reason: mergedReason, cta: mergedCta, flags: mergedFlags, priority: mergedPriority } as any)
            .eq("id", existingRow.id);
        }
      } else {
        await supabase.from("cs_tasks").insert({
          tenant_name: tenant,
          reason: d.reason,
          cta: d.taskCta,
          priority: d.taskPriority,
          flags: [] as string[],
          week_start: weekStart,
          status: "pending",
        } as never);
      }
    }
  }
  return results;
}
