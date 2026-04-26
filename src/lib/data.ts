import { supabase } from "@/integrations/supabase/client";

export interface Snapshot {
  id: string;
  tenant_name: string;
  period: string; // YYYY-MM-DD
  games_online: number;
  gmv_games: number;
  gmv_all: number;
  transacted_amount: number;
  b2c_commissions: number;
  b2b_commissions: number;
  saas: number;
  revenue: number;
  transacted_rate: number;
}

export async function fetchAllSnapshots(): Promise<Snapshot[]> {
  const { data, error } = await supabase
    .from("tenant_snapshots")
    .select("*")
    .order("period", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Snapshot[];
}

export async function fetchSnapshotsForTenant(tenant: string): Promise<Snapshot[]> {
  const { data, error } = await supabase
    .from("tenant_snapshots")
    .select("*")
    .eq("tenant_name", tenant)
    .order("period", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Snapshot[];
}

export async function fetchPeriods(): Promise<string[]> {
  const { data, error } = await supabase
    .from("tenant_snapshots")
    .select("period")
    .order("period", { ascending: false });
  if (error) throw error;
  const set = new Set<string>();
  (data ?? []).forEach((r: { period: string }) => set.add(r.period));
  return Array.from(set);
}

export async function fetchSnapshotsForPeriod(period: string): Promise<Snapshot[]> {
  const { data, error } = await supabase
    .from("tenant_snapshots")
    .select("*")
    .eq("period", period);
  if (error) throw error;
  return (data ?? []) as Snapshot[];
}
