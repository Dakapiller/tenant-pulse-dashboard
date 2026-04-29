## Goal

Stop the main thread from freezing. Three concrete causes:

1. `clubs.tsx` builds rows for ~293 tenants and runs **two** `computeRiskWithCS` calls per tenant (`scoreWithDelta` + `flagsWithDelta`) → ~600 risk passes on every render where any of `snapshots/statuses/tasks/statusLogs` change.
2. `DataTable` renders **every** row in the DOM (no pagination) — 293 rows × ~12 columns of badges/links is the biggest paint cost.
3. Dashboard `index.tsx` builds KPIs, charts, YoY, status donut and the activity table all in one synchronous pass before first paint.

Memos are mostly already in place — the wins come from **doing less work** and **rendering fewer DOM nodes**, plus splitting the dashboard into tiers so the first paint is fast.

## Changes

### 1. Single risk pass per tenant (clubs + at-risk)

In `src/routes/clubs.tsx` and `src/routes/at-risk.tsx`, replace the two-call pattern (`scoreWithDelta` + `flagsWithDelta`) with **one** helper `riskWithDelta(history, statuses)` in `src/lib/cs.ts` that returns `{ score, prevScore, delta, level, prevLevel, flags: { current, added, resolved } }` from a single current + single previous `computeRiskWithCS`. Halves the work for the heaviest table.

Keep memo dep arrays minimal and stable (already `[snapshots, statuses, tasks, statusLogs, weekStart, latestPeriod]`).

### 2. Paginate the clubs table (50 / page)

Add lightweight pagination to `src/components/DataTable.tsx`:

- New optional prop `pageSize?: number` (default `undefined` = no pagination, current behavior).
- Internal `page` state, reset to 0 whenever the post-filter/sort `filtered` length or search/filters change.
- Slice `filtered` to `pageRows = filtered.slice(page*pageSize, (page+1)*pageSize)`; render only `pageRows` in `<tbody>`.
- Footer with `« Anterior`, page X/N, `Próximo »`, total count.
- Scroll table container to top on page change.

Apply `pageSize={50}` to the main table in `clubs.tsx` (line 267 `rows={visibleRows}`) and the duplicate clubs/missing tables (lines 395/402). Smaller tables (CS tasks, history, recent activity) stay unpaginated.

Note on requirement #2 ("only compute risk for the visible page"): we keep risk computation at the rows level because sort/filter/search must operate on full data — the row objects must already carry score/level. After change #1 the cost is ~293 single risk passes on data load only, which is fast; the real saving is rendering 50 rows instead of 293.

### 3. Tier the dashboard load

Split `DashboardPage` into 3 phases driven by separate state:

```text
phase 0  fetch periods + statuses        → render KPI cards + period selector
phase 1  fetch all snapshots             → render trend & status charts
phase 2  fetch tasks + compute clubs[]   → render positives + recent activity
```

Implementation:

- Replace the single `Promise.all` with three sequential `useEffect`s, each gated on the previous phase's data being present.
- Each chart/section guards with `{snapshotsLoaded ? <Chart/> : <Skeleton/>}` so React paints KPIs immediately.
- `clubs[]`, `positives`, `recentActivity` only build once tasks arrive (phase 2).
- `healthByMonth` is already capped at 12 months from the previous fix — keep it.

### 4. Debounce search

In `DataTable.tsx` the search is already commit-on-Enter/click (no live filtering), so no debounce needed there. Audit other live-filter inputs in `cs.tsx` history view, `clubs.tsx` toolbar inputs, and the `at-risk.tsx` filter — wrap any `onChange` that triggers heavy filtering with a 300 ms `useDebouncedValue` hook (`src/hooks/use-debounced-value.ts`, new file).

### 5. useEffect audit

Walk every `useEffect` in `index.tsx`, `clubs.tsx`, `cs.tsx`:

- Confirm dependency arrays are correct and minimal.
- Watch for the known TanStack pattern `useEffect(() => { … setDrawerTenant(search.tenant) }, [search.tenant])` — fine.
- The CS page has `useEffect(() => { setStatuses(...) }, [tenantNames])` (line 108) — verify it doesn't loop by checking `tenantNames` is properly memoized.
- Add no new effects; only fix any found loops.

## Files

- `src/lib/cs.ts` — add `riskWithDelta` helper combining score + flags in one pass.
- `src/components/DataTable.tsx` — `pageSize` prop, page state, footer pager.
- `src/routes/clubs.tsx` — use `riskWithDelta`; pass `pageSize={50}` to main table.
- `src/routes/at-risk.tsx` — use `riskWithDelta`.
- `src/routes/index.tsx` — split fetch into 3 phases with skeleton fallbacks.
- `src/hooks/use-debounced-value.ts` — new tiny hook.
- `src/routes/cs.tsx` — debounce history search input if present; verify effects.

## Out of scope

Row virtualization (react-window) — pagination is enough at 293 rows. Web Workers for risk — not needed once duplicate passes are removed.
