import { supabase } from "@/integrations/supabase/client";

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
}

export interface CSTenantStatus {
  id: string;
  tenant_name: string;
  relationship_status: string;
  note: string | null;
  recorded_at: string;
  club_status?: string | null;
}

export type ClubStatus = "active" | "churn_candidate" | "churned";

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
  churn_candidate: "Candidato a churn",
  churned: "Em churn",
};

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
  const { data, error } = await supabase
    .from("cs_tenant_status")
    .select("*")
    .order("recorded_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as CSTenantStatus[];
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
  const { data, error } = await supabase
    .from("cs_tasks")
    .select("*")
    .order("created_at", { ascending: false });
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
    .update({ status: "completed", outcome, completed_at: new Date().toISOString() })
    .eq("id", taskId);
  if (e1) throw e1;
  const { error: e2 } = await supabase
    .from("cs_tenant_status")
    .insert({ tenant_name: tenant, relationship_status: outcome, note });
  if (e2) throw e2;
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
    if (s.club_status && s.club_status !== "active") return s.club_status as ClubStatus;
    if (s.club_status === "active") return "active";
  }
  return "active";
}

export async function setClubStatus(
  tenant: string,
  newStatus: ClubStatus,
  previousStatus: ClubStatus,
  note: string | null,
  changedBy: string = "cs",
): Promise<void> {
  const { error: e1 } = await supabase
    .from("cs_tenant_status")
    .insert({
      tenant_name: tenant,
      relationship_status: `status_${newStatus}`,
      club_status: newStatus,
      note,
    } as never);
  if (e1) throw e1;
  const { error: e2 } = await supabase
    .from("club_status_log" as never)
    .insert({
      tenant_name: tenant,
      previous_status: previousStatus,
      new_status: newStatus,
      note,
      changed_by: changedBy,
    } as never);
  if (e2) throw e2;
}

// Sum of CS modifiers across all relationship statuses ever recorded for a tenant.
export function sumCSImpact(statuses: CSTenantStatus[]): number {
  // mirror CS_MODIFIER from risk.ts (kept inline to avoid import cycle)
  const MODS: Record<string, number> = {
    bad_relationship: 25,
    good_receptivity: -15,
    very_satisfied: -30,
  };
  return statuses.reduce((acc, s) => acc + (MODS[s.relationship_status] ?? 0), 0);
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

