## Goal

Stop the Customer Success crash, finish the remaining performance gaps, and lock down risk accuracy.

---

## 1. CS crash — proper sub-route split (no shared mega-component)

Today `/cs/tasks` and `/cs/history` both mount the same `CSPage` component, which fetches **every** snapshot, status, and `cs_tasks` row (via `fetchAllCSTasks` paginated). The History view then renders the full completed list (sliced client-side). That single page is what kills the tab.

I'll revert to a small shared scaffold and give each tab its own data path:

**`src/routes/cs.tsx`** — becomes a thin layout only:
- Renders `<CSSubNav />` + `<Outlet />`. No data fetching, no charts, no rows.
- `/cs` still redirects to `/cs/tasks`.
- Move the heavy "Cronologia" timeline section out of this file. It only matters on Tarefas, so it lives in `cs.tasks.tsx` and is loaded lazily after the task list paints (Phase 2 of that page).

**`src/routes/cs.tasks.tsx`** — Tarefas (pending only):
- New helper `fetchPendingCSTasks()` in `src/lib/cs.ts`:
  ```ts
  supabase.from("cs_tasks")
    .select("*")
    .eq("status", "pending")
    .order("priority", { ascending: false })
  ```
  Paginated via `fetchAllPaged` (pending set is small — typically dozens, not thousands).
- Phase 0: snapshots + statuses + pending tasks → render the contacts table.
- Phase 1 (deferred via `setTimeout(0)`): generate weekly tasks if missing (existing `requestIdleCallback` guard kept).
- Phase 2 (deferred): Cronologia chart data.
- "Mostrar inativos" toggle stays.
- No completed-task data is ever fetched here.

**`src/routes/cs.history.tsx`** — Histórico (server-paginated):
- New helper `fetchCompletedCSTasksPage(offset, limit)`:
  ```ts
  supabase.from("cs_tasks")
    .select("*")
    .eq("status", "completed")
    .not("completed_at", "is", null)
    .order("completed_at", { ascending: false })
    .range(offset, offset + limit - 1)
  ```
- Initial load: 50 rows. Button "Carregar mais" fetches the next 50 and appends. Track `hasMore` from the returned page size.
- "Mostrar inativos" still works — it only filters the rows already loaded (excluded set comes from cached statuses, fetched once).
- No snapshot fetch, no risk computation on this page.

**Result**: Tarefas page no longer touches the completed-tasks table at all; Histórico no longer touches snapshots. Switching tabs only re-fetches what that tab needs.

---

## 2. Performance — finish the gaps

**a. Memoize remaining risk computations**
The dashboard, clubs list, at-risk and CS rows already wrap `computeRisk*` in `useMemo`. The one straggler is `scoreChangeEvents()` in `src/routes/clubs.tsx` (used by the per-row `ClubHistoryPanel`): it walks history and calls `computeRiskWithCS` once per snapshot, called at render, not memoized.

Fix:
- Wrap in `useMemo(() => scoreChangeEvents(row), [row.history, row.statuses])` inside `ClubHistoryPanel`.
- Only call when the row is actually expanded (already gated by `expandedTenant`, but the panel currently computes eagerly on mount; the memo + lazy mount keeps it cheap).

**b. Paginate clubs table 50/page** — already wired (`pageSize={50}` on the DataTable in `clubs.tsx`). Verify the footer renders for >50 rows; no code change expected.

**c. Dashboard load order KPIs → charts → radar/activity**
`src/routes/index.tsx` already uses three phases. I'll make the order explicit and prevent the heavy sections from rendering before their data exists:
- Phase 0: `fetchPeriods()` + `fetchAllCSStatuses()` → KPI shell + period selector.
- Phase 1 (after Phase 0): `fetchAllSnapshots()` → charts (Tendência mensal, Distribuição saúde) + KPI numbers that need GMV/revenue.
- Phase 2 (after Phase 1): `fetchAllCSTasks()` → "Evolução positiva", "Atividade CS recente".
- KPI cards that depend on snapshots (GMV mês, Receita mês, Em risco alto) show a small spinner/skeleton until Phase 1 finishes, instead of showing 0.

**d. Debounce search inputs 300ms**
- `at-risk.tsx` already debounced (`useDebouncedValue`).
- `DataTable.tsx` uses an explicit "Procurar" button (commit-on-Enter), so no live filter — no debounce needed.
- Add the same `useDebouncedValue` to the new Histórico's optional client-side filter (if added — currently planned to keep it simple, no live search box, just paginate).

**e. Audit useEffect dependency arrays**
- `src/routes/cs.tsx` (becoming layout): no effects.
- `src/routes/cs.tasks.tsx` and `cs.history.tsx`: written fresh, deps are explicit.
- `src/routes/index.tsx`: phase-1 effect depends on `loading`; phase-2 on `snapshotsLoaded`; period-default effect on `[periods, selectedPeriod]` ✅.
- `src/routes/clubs.tsx`: mount-only `loadAll()` is fine; the search-param sync depends on `[search.tenant]` ✅.
- `src/routes/at-risk.tsx`: mount-only ✅.

No infinite-loop suspects. Will keep the existing `// eslint-disable-next-line react-hooks/exhaustive-deps` only on the intentional mount-only effects.

---

## 3. Accuracy — never cap snapshot history

Confirmed by reading `src/lib/data.ts`: `fetchAllSnapshots` and `fetchSnapshotsForTenant` both use full pagination via `fetchAllPaged`, no `.limit()`. The risk engine (`computeRiskWithCS` and `riskWithDelta`) operates on the full passed-in history.

Guardrails I will add:
- Code comment at the top of `data.ts` and inside `riskWithDelta` saying "do NOT add `.limit()` on `tenant_snapshots` — risk depends on full history".
- The Cronologia chart's "last 24 months" cap stays — it's a display cap on the **already-computed** series, not on the data fetch.
- The Dashboard's `healthByMonth` 12-month cap also stays — same story, display only.

---

## Files I'll touch

- `src/lib/cs.ts` — add `fetchPendingCSTasks`, `fetchCompletedCSTasksPage`. Keep `fetchAllCSTasks` (still used by Dashboard for "Atividade CS recente" / "positives").
- `src/lib/data.ts` — add a comment guard, no behavior change.
- `src/routes/cs.tsx` — slim down to layout-only (`<CSSubNav /> + <Outlet />`), keep redirect.
- `src/routes/cs.tasks.tsx` — own page: pending tasks + cronologia + weekly-task generator.
- `src/routes/cs.history.tsx` — own page: server-paginated completed tasks with "Carregar mais".
- `src/routes/clubs.tsx` — memoize `scoreChangeEvents` inside `ClubHistoryPanel`.
- `src/routes/index.tsx` — make KPI cards skeleton until Phase 1 data lands; tighten phase comments.

No DB migrations. No schema changes.

---

## Out of scope

- Reworking the risk engine itself.
- Adding a cs_tasks index — Postgres already handles `status='pending'` and `completed_at desc` efficiently for the volumes here.
- Changing the Cronologia chart's data shape.
