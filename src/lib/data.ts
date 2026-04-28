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

const PAGE_SIZE = 1000;

/**
 * Paginate a Supabase query past the default 1000-row PostgREST limit.
 * Calls `build(from, to)` repeatedly until a page returns fewer rows than the page size.
 */
export async function fetchAllPaged<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  build: (from: number, to: number) => any,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return out;
}

export async function fetchAllSnapshots(): Promise<Snapshot[]> {
  return fetchAllPaged<Snapshot>((from, to) =>
    supabase
      .from("tenant_snapshots")
      .select("*")
      .order("period", { ascending: false })
      .range(from, to),
  );
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
  // Distinct periods are a tiny set (≤ a few dozen). Stream pages and stop
  // as soon as we've seen no new period in a full page — avoids paginating
  // the entire snapshots table (thousands of rows) every dashboard load.
  const set = new Set<string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("tenant_snapshots")
      .select("period")
      .order("period", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as { period: string }[];
    const before = set.size;
    rows.forEach((r) => set.add(r.period));
    if (rows.length < PAGE) break;
    if (set.size === before) break; // no new periods in this page → done
  }
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
