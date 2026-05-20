import { supabase } from "@/integrations/supabase/client";
import { computeRisk, type RiskFlag } from "@/lib/risk";
import { applyTaskOutcome } from "@/lib/health";
import { fetchAllPaged, type Snapshot } from "@/lib/data";

export interface CSTask {
  id: string;
  tenant_name: string;
  reason: string;
  cta: string;
  priority: number;
  status: string;
  outcome: string | null;
  flags: string[] | null;
  created_at: string;
  completed_at: string | null;
  week_start: string;
  note?: string | null;
}

export interface CSTenantStatus {
  id: string;
  tenant_name: string;
  relationship_status: string;
  note: string | null;
  recorded_at: string;
  club_status?: string | null;
  churn_competitor?: string | null;
  health_score?: number | null;
  is_priority?: boolean | null;
}

export type ClubStatus = "active" | "possible_churn" | "churned" | "closed" | "changed_owner";

export interface ClubStatusLog {
  id: string;
  tenant_name: string;
  previous_status: string;
  new_status: string;
  note: string | null;
  changed_by: string | null;
  changed_at: string;
}

export const CLUB_STATUS_LABEL: Record<ClubStatus, string> = {
  active: "Ativo",
  possible_churn: "Possível churn",
  churned: "Em churn",
  closed: "Fechado",
  changed_owner: "Mudança de dono",
};

export const CLUB_STATUS_OPTIONS: { value: ClubStatus; label: string }[] = [
  { value: "active", label: "Ativo" },
  { value: "possible_churn", label: "Possível churn" },
  { value: "churned", label: "Em churn" },
  { value: "closed", label: "Fechado" },
  { value: "changed_owner", label: "Mudança de dono" },
];

export const COMPETITOR_OPTIONS: { value: string; label: string }[] = [
  { value: "SmashPro", label: "SmashPro" },
  { value: "TiePlayer", label: "TiePlayer" },
  { value: "RacketID", label: "RacketID" },
  { value: "Outro", label: "Outro" },
];

export const OUTCOME_OPTIONS: { value: string; label: string }[] = [
  { value: "bad_relationship", label: "Má relação" },
  { value: "good_receptivity", label: "Boa recetividade" },
  { value: "very_satisfied", label: "Cliente ficou muito satisfeito, agradeceu contacto" },
];

/**
 * Label do **resultado** de uma tarefa (lê `outcome`).
 *
 * Precedência UI: usar **apenas** em tooltips ou na linha de detalhe para descrever
 * o que aconteceu. Para o badge de estado (Pendente/Concluída/Anulada) usar
 * `taskStatusLabel` que lê `status`. Nunca misturar os dois no mesmo elemento.
 */
export function outcomeLabel(value: string | null | undefined): string {
  if (!value) return "—";
  if (value === "cancelled_inactive") return "Anulada — não está ativo";
  if (value === "cancelled_manual") return "Anulada";
  if (value === "cancelled_cleanup") return "Anulada (limpeza)";
  return OUTCOME_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

/**
 * Label do **estado** de uma tarefa (lê `status`).
 * Ver `outcomeLabel` para a regra de precedência.
 */
export function taskStatusLabel(t: { status: string }): "Pendente" | "Concluída" | "Anulada" {
  if (t.status === "completed") return "Concluída";
  if (t.status === "cancelled") return "Anulada";
  return "Pendente";
}


// ISO date (YYYY-MM-DD) for the Monday of the current week (UTC).
export function currentWeekStart(date: Date = new Date()): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const diff = (day === 0 ? -6 : 1 - day);
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

/** Latest is_priority flag per tenant. */
export async function fetchPriorityMap(): Promise<Map<string, boolean>> {
  const { data, error } = await supabase
    .from("cs_tenant_status")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .select("tenant_name, is_priority, recorded_at" as any)
    .order("recorded_at", { ascending: false });
  if (error) throw error;
  const map = new Map<string, boolean>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (data as any[] ?? []).forEach((r) => {
    if (!map.has(r.tenant_name)) map.set(r.tenant_name, !!r.is_priority);
  });
  return map;
}

/** Toggle is_priority on the latest cs_tenant_status row for a tenant. Inserts a row if none exists. */
export async function setTenantPriority(tenant: string, isPriority: boolean): Promise<void> {
  const { data: latest } = await supabase
    .from("cs_tenant_status")
    .select("id")
    .eq("tenant_name", tenant)
    .order("recorded_at", { ascending: false })
    .limit(1);
  const latestId = (latest as { id: string }[] | null)?.[0]?.id;
  if (latestId) {
    const { error } = await supabase
      .from("cs_tenant_status")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({ is_priority: isPriority } as any)
      .eq("id", latestId);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from("cs_tenant_status")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .insert({ tenant_name: tenant, relationship_status: "status_active", club_status: "active", is_priority: isPriority } as any);
    if (error) throw error;
  }
}

export async function fetchAllCSStatuses(): Promise<CSTenantStatus[]> {
  return fetchAllPaged<CSTenantStatus>((from, to) =>
    supabase
      .from("cs_tenant_status")
      .select("*")
      .order("recorded_at", { ascending: false })
      .range(from, to),
  );
}

export async function fetchCSStatusesForTenant(tenant: string): Promise<CSTenantStatus[]> {
  const { data, error } = await supabase
    .from("cs_tenant_status")
    .select("*")
    .eq("tenant_name", tenant)
    .order("recorded_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as CSTenantStatus[];
}

export async function fetchCSTasksForWeek(weekStart: string): Promise<CSTask[]> {
  const { data, error } = await supabase
    .from("cs_tasks")
    .select("*")
    .eq("week_start", weekStart)
    .order("priority", { ascending: false });
  if (error) throw error;
  return (data ?? []) as CSTask[];
}

export async function fetchAllCSTasks(): Promise<CSTask[]> {
  return fetchAllPaged<CSTask>((from, to) =>
    supabase
      .from("cs_tasks")
      .select("*")
      .order("created_at", { ascending: false })
      .range(from, to),
  );
}

/** Pending tasks only — small set, paginated for safety. */
export async function fetchPendingCSTasks(): Promise<CSTask[]> {
  return fetchAllPaged<CSTask>((from, to) =>
    supabase
      .from("cs_tasks")
      .select("*")
      .eq("status", "pending")
      .order("priority", { ascending: false })
      .range(from, to),
  );
}

/** Server-paginated page of completed tasks ordered by completed_at desc. */
export async function fetchCompletedCSTasksPage(offset: number, limit: number): Promise<CSTask[]> {
  const { data, error } = await supabase
    .from("cs_tasks")
    .select("*")
    .eq("status", "completed")
    .not("completed_at", "is", null)
    .order("completed_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return (data ?? []) as CSTask[];
}

/**
 * Server-paginated page of tasks matching any of the given statuses.
 * Ordered by `coalesce(completed_at, created_at)` desc so that cancelled
 * tasks (which intentionally have no `completed_at`) are sortable alongside
 * completed ones using their creation timestamp.
 */
export async function fetchTasksByStatusesPage(
  statuses: string[],
  offset: number,
  limit: number,
): Promise<CSTask[]> {
  if (statuses.length === 0) return [];
  const { data, error } = await supabase
    .from("cs_tasks")
    .select("*")
    .in("status", statuses)
    // We can't order by coalesce on the server; fetch by completed_at desc and
    // sort by the effective timestamp client-side below.
    .order("completed_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return (data ?? []) as CSTask[];
}


export async function fetchCSTasksForTenant(tenant: string): Promise<CSTask[]> {
  const { data, error } = await supabase
    .from("cs_tasks")
    .select("*")
    .eq("tenant_name", tenant)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as CSTask[];
}

export async function insertCSTasks(tasks: Omit<CSTask, "id" | "created_at" | "completed_at" | "outcome" | "status"> [] ): Promise<void> {
  if (tasks.length === 0) return;
  const rows = tasks.map((t) => ({
    tenant_name: t.tenant_name,
    reason: t.reason,
    cta: t.cta,
    priority: t.priority,
    flags: t.flags ?? [],
    week_start: t.week_start,
    status: "pending",
  }));
  const { error } = await supabase.from("cs_tasks").insert(rows);
  if (error) throw error;
}

/** Insert a single manually-created CS task. Tagged with flag 'manual' to
 *  distinguish from auto-generated tasks. */
export async function insertManualCSTask(input: {
  tenant: string;
  reason: string;
  cta: string;
  priority: number;
  weekStart: string;
}): Promise<void> {
  const reason = input.reason.trim();
  const cta = input.cta.trim();
  if (!input.tenant) throw new Error("Clube obrigatório.");
  if (reason.length === 0 || reason.length > 500) throw new Error("Razão entre 1 e 500 caracteres.");
  if (cta.length === 0 || cta.length > 200) throw new Error("CTA entre 1 e 200 caracteres.");
  if (![30, 60, 90].includes(input.priority)) throw new Error("Prioridade inválida.");
  const { error } = await supabase.from("cs_tasks").insert({
    tenant_name: input.tenant,
    reason,
    cta,
    priority: input.priority,
    flags: ["manual"],
    week_start: input.weekStart,
    status: "pending",
  } as never);
  if (error) throw error;
}

/** Create a manual CS task already marked as completed. Used when CS logs
 *  an interaction that happened in the past, just for historical record. */
export async function insertManualCSTaskCompleted(input: {
  tenant: string;
  reason: string;
  cta: string;
  priority: number;
  weekStart: string;
  outcome: string;
  note?: string | null;
}): Promise<void> {
  const reason = input.reason.trim();
  const cta = input.cta.trim();
  if (!input.tenant) throw new Error("Clube obrigatório.");
  if (reason.length === 0 || reason.length > 500) throw new Error("Razão entre 1 e 500 caracteres.");
  if (cta.length === 0 || cta.length > 200) throw new Error("CTA entre 1 e 200 caracteres.");
  if (![30, 60, 90].includes(input.priority)) throw new Error("Prioridade inválida.");
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("cs_tasks")
    .insert({
      tenant_name: input.tenant,
      reason,
      cta,
      priority: input.priority,
      flags: ["manual"],
      week_start: input.weekStart,
      status: "completed",
      outcome: input.outcome,
      note: input.note?.trim() || null,
      completed_at: now,
    } as never)
    .select("id")
    .single();
  if (error) throw error;
  void data;
  const { error: e2 } = await supabase
    .from("cs_tenant_status")
    .insert({ tenant_name: input.tenant, relationship_status: input.outcome, note: input.note?.trim() || null });
  if (e2) throw e2;
  await applyTaskOutcome(input.tenant, input.outcome);
}

export async function completeCSTask(taskId: string, tenant: string, outcome: string, note: string | null): Promise<void> {
  const { error: e1 } = await supabase
    .from("cs_tasks")
    .update({ status: "completed", outcome, note, completed_at: new Date().toISOString() } as never)
    .eq("id", taskId);
  if (e1) throw e1;
  const { error: e2 } = await supabase
    .from("cs_tenant_status")
    .insert({ tenant_name: tenant, relationship_status: outcome, note });
  if (e2) throw e2;
  // Rule 3 — apply task outcome to the health score.
  await applyTaskOutcome(tenant, outcome);
}

/** Complete multiple tasks for a single tenant in one batch with shared outcome+note,
 * then write a single cs_tenant_status row for that tenant. */
export async function completeCSTasksBatch(
  tenant: string,
  taskIds: string[],
  outcome: string,
  note: string | null,
): Promise<void> {
  if (taskIds.length === 0) return;
  const completedAt = new Date().toISOString();
  const { error: e1 } = await supabase
    .from("cs_tasks")
    .update({ status: "completed", outcome, note, completed_at: completedAt } as never)
    .in("id", taskIds);
  if (e1) throw e1;
  const { error: e2 } = await supabase
    .from("cs_tenant_status")
    .insert({ tenant_name: tenant, relationship_status: outcome, note });
  if (e2) throw e2;
  // Rule 3 — apply once per batch (the outcome is the same for all tasks).
  await applyTaskOutcome(tenant, outcome);
}

/** Push a pending task to a future week. Snaps the given date to its Monday (UTC). */
export async function postponeCSTask(taskId: string, target: Date | string): Promise<void> {
  const d = typeof target === "string" ? new Date(target) : target;
  const newWeekStart = currentWeekStart(d);
  const { error } = await supabase
    .from("cs_tasks")
    .update({ week_start: newWeekStart } as never)
    .eq("id", taskId);
  if (error) throw error;
}

// --------- Club status helpers ---------

export async function fetchClubStatusLogs(): Promise<ClubStatusLog[]> {
  const { data, error } = await supabase
    .from("club_status_log" as never)
    .select("*")
    .order("changed_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as ClubStatusLog[];
}

export async function fetchClubStatusLogsForTenant(tenant: string): Promise<ClubStatusLog[]> {
  const { data, error } = await supabase
    .from("club_status_log" as never)
    .select("*")
    .eq("tenant_name", tenant)
    .order("changed_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as ClubStatusLog[];
}

// Latest non-null club_status entry per tenant.
export function currentClubStatus(statuses: CSTenantStatus[]): ClubStatus {
  const sorted = [...statuses].sort((a, b) => (b.recorded_at ?? "").localeCompare(a.recorded_at ?? ""));
  for (const s of sorted) {
    if (s.club_status) {
      const cs = s.club_status as ClubStatus;
      // accept legacy value "churn_candidate" → map to possible_churn for safety
      if ((cs as string) === "churn_candidate") return "possible_churn";
      return cs;
    }
  }
  return "active";
}

/** Build a map of tenant -> current ClubStatus from a flat statuses list. */
export function buildCurrentStatusMap(statuses: CSTenantStatus[]): Map<string, ClubStatus> {
  const byTenant = new Map<string, CSTenantStatus[]>();
  for (const s of statuses) {
    if (!byTenant.has(s.tenant_name)) byTenant.set(s.tenant_name, []);
    byTenant.get(s.tenant_name)!.push(s);
  }
  const out = new Map<string, ClubStatus>();
  for (const [name, list] of byTenant) out.set(name, currentClubStatus(list));
  return out;
}

/**
 * Single source of truth for "this tenant is active":
 *   active  ↔  current club_status NOT IN { churned, closed, changed_owner }
 * Whether or not the tenant uploaded a snapshot in the latest period is
 * intentionally NOT part of this rule (see /clubs vs Dashboard alignment).
 */
export function isActiveStatus(status: ClubStatus): boolean {
  return status !== "churned" && status !== "closed" && status !== "changed_owner";
}

export function isExcludedStatus(status: ClubStatus): boolean {
  return !isActiveStatus(status);
}

/** Tenants whose current status excludes them from aggregate metrics. */
export function excludedTenants(statuses: CSTenantStatus[]): Set<string> {
  const set = new Set<string>();
  const map = buildCurrentStatusMap(statuses);
  for (const [name, st] of map) {
    if (isExcludedStatus(st)) set.add(name);
  }
  return set;
}

// Latest competitor recorded for a churned tenant.
export function currentChurnCompetitor(statuses: CSTenantStatus[]): string | null {
  const sorted = [...statuses].sort((a, b) => (b.recorded_at ?? "").localeCompare(a.recorded_at ?? ""));
  for (const s of sorted) {
    if (s.churn_competitor) return s.churn_competitor;
  }
  return null;
}

export async function setClubStatus(
  tenant: string,
  newStatus: ClubStatus,
  previousStatus: ClubStatus,
  note: string | null,
  changedBy: string = "cs",
  competitor: string | null = null,
): Promise<void> {
  const { error: e1 } = await supabase
    .from("cs_tenant_status")
    .insert({
      tenant_name: tenant,
      relationship_status: `status_${newStatus}`,
      club_status: newStatus,
      note,
      churn_competitor: newStatus === "churned" ? competitor : null,
    } as never);
  if (e1) throw e1;
  const { error: e2 } = await supabase
    .from("club_status_log" as never)
    .insert({
      tenant_name: tenant,
      previous_status: previousStatus,
      new_status: newStatus,
      note: competitor && newStatus === "churned" ? `${note ?? ""}${note ? " · " : ""}Competidor: ${competitor}` : note,
      changed_by: changedBy,
    } as never);
  if (e2) throw e2;
  // If the new status makes the club inactive, cancel any pending tasks.
  if (!isActiveStatus(newStatus)) {
    await cancelPendingTasksForTenant(tenant);
  }
}

/**
 * Cancel all pending CS tasks for a tenant. Used when a club is moved to a
 * non-active status (churned/closed/changed_owner) — pending tasks should
 * not be actionable anymore but kept in history as "anuladas".
 */
export async function cancelPendingTasksForTenant(tenant: string): Promise<void> {
  const { error } = await supabase
    .from("cs_tasks")
    .update({
      status: "cancelled",
      outcome: "cancelled_inactive",
      note: "Não está ativo",
      completed_at: new Date().toISOString(),
    } as never)
    .eq("tenant_name", tenant)
    .eq("status", "pending");
  if (error) throw error;
}

export function lastCompletedActivityAt(tasks: CSTask[]): string | null {
  let best: string | null = null;
  for (const t of tasks) {
    if (t.status === "completed" && t.completed_at) {
      if (!best || t.completed_at > best) best = t.completed_at;
    }
  }
  return best;
}

/**
 * Compute current informational flags (NOT a score) plus which were added /
 * resolved vs the previous month. Flags are descriptive only — they do not
 * affect the health score (see src/lib/health.ts for scoring rules).
 */
export function flagsWithDelta(history: Snapshot[]): { current: RiskFlag[]; added: RiskFlag[]; resolved: RiskFlag[]; prev: RiskFlag[] } {
  const sorted = [...history].sort((a, b) => a.period.localeCompare(b.period));
  if (sorted.length === 0) return { current: [], added: [], resolved: [], prev: [] };
  const cur = computeRisk(sorted);
  if (sorted.length < 2) return { current: cur.flags, added: cur.flags, resolved: [], prev: [] };
  const prev = computeRisk(sorted.slice(0, -1));
  const prevSet = new Set(prev.flags);
  const curSet = new Set(cur.flags);
  return {
    current: cur.flags,
    added: cur.flags.filter((f) => !prevSet.has(f)),
    resolved: prev.flags.filter((f) => !curSet.has(f)),
    prev: prev.flags,
  };
}

/** Most-recent CS outcome (non-status_*). Used to display CS context. */
export function latestCSOutcome(statuses: CSTenantStatus[]): { outcome: string; recordedAt: string } | null {
  const sorted = [...statuses]
    .filter((s) => !s.relationship_status.startsWith("status_"))
    .sort((a, b) => (b.recorded_at ?? "").localeCompare(a.recorded_at ?? ""));
  const latest = sorted[0];
  if (!latest) return null;
  return { outcome: latest.relationship_status, recordedAt: latest.recorded_at };
}

// ---- Backward-compat shims ----
// The old score+flag bundle is now derived from health_score (passed in)
// and the informational flags. These keep existing UI call sites compiling
// while the screens are progressively migrated to read health_score directly.
export function riskWithDelta(
  history: Snapshot[],
  _statuses: CSTenantStatus[],
  currentScore: number | null = null,
  prevScore: number | null = null,
): {
  score: number;
  prevScore: number | null;
  delta: number | null;
  level: "high" | "medium" | "healthy";
  prevLevel: "high" | "medium" | "healthy" | null;
  flags: { current: RiskFlag[]; added: RiskFlag[]; resolved: RiskFlag[]; prev: RiskFlag[] };
} {
  const f = flagsWithDelta(history);
  const score = currentScore ?? 100;
  // Map health score → legacy "high/medium/healthy" levels (inverted: low health = high risk).
  const toLevel = (s: number): "high" | "medium" | "healthy" =>
    s < 30 ? "high" : s < 60 ? "medium" : "healthy";
  return {
    score,
    prevScore,
    delta: prevScore !== null ? score - prevScore : null,
    level: toLevel(score),
    prevLevel: prevScore !== null ? toLevel(prevScore) : null,
    flags: f,
  };
}

/** @deprecated kept for old callers — returns 0 (no longer used in scoring). */
export function sumCSImpact(_statuses: CSTenantStatus[]): number { return 0; }

/** @deprecated alias for riskWithDelta. */
export const scoreWithDelta = riskWithDelta;
