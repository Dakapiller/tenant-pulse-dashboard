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

export function outcomeLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return OUTCOME_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

// ISO date (YYYY-MM-DD) for the Monday of the current week (UTC).
export function currentWeekStart(date: Date = new Date()): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const diff = (day === 0 ? -6 : 1 - day);
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
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

/** Tenants whose current status excludes them from aggregate metrics. */
export function excludedTenants(statuses: CSTenantStatus[]): Set<string> {
  const set = new Set<string>();
  const map = buildCurrentStatusMap(statuses);
  for (const [name, st] of map) {
    if (st === "churned" || st === "closed") set.add(name);
  }
  return set;
}

export function isExcludedStatus(status: ClubStatus): boolean {
  return status === "churned" || status === "closed";
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
