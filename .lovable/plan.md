## Goal
Stop the `/cs` (Customer Success) page from freezing the browser. Click currently triggers heavy, repeated computation and a potentially huge write on the main thread.

## Root causes found in `src/routes/cs.tsx`

1. **Weekly task auto-generation runs synchronously on every visit** (lines 67-82). `generateWeeklyTasks` loops every tenant (~324), runs `computeRiskWithCS` for each, then writes all tasks to the database, then calls `loadAll()` again — a second full fetch. If the insert ever fails or the week's tasks exist with `status !== "pending"`, this can also re-trigger.
2. **`rows` memo is O(tenants × tasks)** (lines 194-225). Inside `ensure()`, `lastCompletedActivityAt(allTasks.filter(t => t.tenant_name === name))` re-scans the full task list per tenant.
3. **`scoreWithDelta` runs per row** and internally calls `computeRiskWithCS` twice with a fresh sort each time. Combined with #2, building `rows` is the hot path that locks the tab.
4. **`historyTasks` renders unbounded** (lines 453-471) — every completed task ever, no pagination.
5. **`tenantHistory` / `tenantStatuses` not pre-sorted** so each `computeRiskWithCS` re-sorts.
6. **Cronologia chart series** recomputes on every unrelated state change because `snapshots` is in deps and the filter walks all rows.

## Fix plan (in order)

### 1. Pre-index tasks once
Build `tasksByTenant: Map<string, CSTask[]>` in a `useMemo([allTasks])`. Replace the per-row `allTasks.filter(...)` with a map lookup. Removes the O(N×M) cost.

### 2. Pre-sort tenant history / statuses once
In the existing `tenantHistory` and `tenantStatuses` memos, sort each tenant's array by `period` / `recorded_at` ascending before storing. Then change `riskWithDelta` callers to skip the redundant `[...history].sort(...)` (or just accept already-sorted input — riskWithDelta still sorts defensively, which is cheap on already-sorted arrays).

### 3. Make weekly task generation safe and one-shot
- Guard with a ref so it can only run once per mount.
- Check if **any** task exists with `week_start === weekStart` (pending OR completed) before generating, so we never regenerate after the user completes them.
- Run generation in an idle callback (`requestIdleCallback` w/ setTimeout fallback) so it never blocks the first paint.
- After insert, do a partial reload of just `allTasks` instead of a full `loadAll()`.

### 4. Paginate history list
Reuse the existing `DataTable` pagination pattern, or add a simple "Mostrar mais" button capping the list at 50 items initially. This keeps the DOM small.

### 5. Stabilize the Cronologia chart
- Move the `excluded`-set filter into a precomputed `Map<period, agg>` keyed by `chartMode + selectedTenant` only.
- Cap the chart to the last 24 months so x-axis labels and SVG paths don't explode.

### 6. Audit effects
- The `useEffect` at line 67-82 has empty deps + eslint-disable; convert to a `didRunRef` guard so React 18 strict-mode double-mount doesn't double-fire generation.
- Effect at 108-112 is fine but add `tenantNames[0]` as a stable dep is OK.

## Files to edit
- `src/routes/cs.tsx` — items 1, 2, 3, 4, 5, 6
- `src/lib/cs.ts` — small helper `lastCompletedActivityAtFromMap` (optional) or just reuse `lastCompletedActivityAt` with the indexed list

## Out of scope
No DB schema changes. No new dependencies. Visual layout unchanged.

## Expected outcome
Clicking "Customer Success" paints the shell immediately, runs computation against pre-indexed data (single pass), and never blocks the main thread on weekly task generation.