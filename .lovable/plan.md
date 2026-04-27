## Problem

The "Distribuição de saúde dos clubes" chart shows ~144 clubs for December 2025 instead of the real 290 that were uploaded. The same accuracy bug also affects every other dashboard metric, KPI and chart: any view that calls `fetchAllSnapshots()` is silently truncated.

## Root cause

Supabase enforces a hard default cap of **1000 rows per query**. The DB currently holds ~4 350 snapshots (≈290 clubs × 15 months). `fetchAllSnapshots()` in `src/lib/data.ts` calls `select("*").order("period", desc)` with no pagination, so PostgREST returns only the most recent 1 000 rows.

Verified against the database:

```text
2026-03 → 281 rows
2026-02 → 286 rows
2026-01 → 289 rows  →  cumulative 856 rows
2025-12 → 290 rows  →  only 144 fit in the remaining 1 000 budget
2025-11 and earlier → 0 rows returned
```

That perfectly matches the truncated bar (≈144) for 12/25 in the chart.

The same silent truncation is feeding the trend chart, YoY overlay, KPIs (GMV/Receita do mês), score deltas, the risk radar, the Clubs page and the At-Risk page — every screen that reads from `fetchAllSnapshots`. So even when other months "look right" they are actually missing the historical context needed for `computeRisk` to flag trends correctly.

## Fix

Make every "fetch all" call paginate until the server returns fewer rows than the requested page size. Pure data-layer change — no UI restructure required.

### 1. `src/lib/data.ts`
- Replace `fetchAllSnapshots` with a paginated implementation using `.range(from, to)` in 1 000-row pages until exhaustion.
- Replace `fetchPeriods` with the same pagination (defensive, even if today it fits).
- Keep `fetchSnapshotsForTenant` and `fetchSnapshotsForPeriod` as-is (already bounded by club/month).

### 2. `src/lib/cs.ts`
- Apply the same pagination helper to `fetchAllCSStatuses` and `fetchAllCSTasks` so they cannot silently truncate as the project grows.

### 3. Add a tiny shared helper
Inside `src/lib/data.ts`, add:

```ts
async function fetchAllPaged<T>(
  build: (from: number, to: number) => Promise<{ data: T[] | null; error: unknown }>,
  pageSize = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}
```

Use it from `data.ts` and re-export it for `cs.ts` (or duplicate locally — it is 10 lines).

### 4. Verification after fix
- Reload `/`. The "Distribuição de saúde dos clubes" bars should equal the real upload counts: 290 (12/25), 289 (01/26), 286 (02/26), 281 (03/26), and earlier months (06/25 … 11/25) should also appear.
- "Clubes ativos" KPI should match the count from the latest period's upload.
- Trend chart should show all 15 months instead of only the latest 4.

## Files to edit

- `src/lib/data.ts` — paginate `fetchAllSnapshots` and `fetchPeriods`, add helper.
- `src/lib/cs.ts` — paginate `fetchAllCSStatuses` and `fetchAllCSTasks`.

No UI files need changing; the chart logic in `src/routes/index.tsx` is already correct — it was just being fed truncated data.