## Problem with "324 Clubes ativos"

The KPI counts every tenant that exists in `tenant_snapshots` and is not explicitly marked `churned` or `closed`. Today:

- 324 distinct tenants in snapshots
- Only 146 have any row in `cs_tenant_status` (89 active, 11 possible_churn, 34 churned, 10 closed, 2 changed_owner)
- The other ~178 have **no status record** → `currentClubStatus()` defaults to `"active"` → inflated KPI

Last snapshot period (2026-03) only has **281 tenants reporting**, and **269 had real activity** (games / GMV / revenue > 0). So 324 is clearly wrong.

### Fix (Step 1 — before items 4 & 6)

Redefine "active club" for the KPI to mean: **tenant has a snapshot in the selected period AND is not marked churned / closed / changed_owner**.

Change in `src/routes/index.tsx` `kpis` memo:

```ts
const activeClubs = clubs.filter((c) => {
  if (c.status === "churned" || c.status === "closed" || c.status === "changed_owner") return false;
  // must have reported activity in the selected period
  return c.latest?.period === latestPeriod;
}).length;
```

Optionally tighten further to require `games_online > 0 || gmv_all > 0 || revenue > 0` in the latest snapshot — I'll include that as the active definition (consistent with how a club is operationally "live").

Add a small tooltip on the KPI: "Clubes com atividade reportada no período selecionado, excluindo churned / closed / changed owner."

Expected new value for March 2026: ~269.

I'll also audit the same logic in `clubs.tsx` and `at-risk.tsx` to keep counts consistent.

---

## Item 4 — Standardized tables

Create a single `<DataTable>` toolbar pattern reused everywhere:

- **Toolbar above the table** (outside the scroll area) with:
  - Search input + medium **"Procurar"** button (submits on click / Enter)
  - Filter chips / dropdowns specific to each table (status, level, owner…)
  - Right-aligned action buttons (export, etc.) when relevant
- **All columns sortable** by default (click header to toggle asc/desc/none, with an arrow indicator)
- Consistent pagination footer + row count

Refactor `src/components/DataTable.tsx` to accept:
- `searchableKeys: string[]`
- `filters: Array<{ key, label, options }>`
- `defaultSort` and `columns[].sortable` (default true)

Apply to all current tables:
- `/` Visão Geral — clubs table
- `/clubs` — main list
- `/cs` (and the new sub-pages) — tasks & history tables
- `/at-risk` — at-risk list

## Item 6 — Customer Success sub-menu

Convert `/cs` into a layout route with two tabs:

```
src/routes/cs.tsx              → layout with sub-nav (Tasks | History) + <Outlet/>
src/routes/cs.tasks.tsx        → existing tasks UI (default redirect target)
src/routes/cs.history.tsx      → activity history (currently buried), promoted as a first-class page with the standardized table + filters (tenant, outcome, date range)
```

Update top nav label "Customer Success" to keep pointing at `/cs/tasks`. The sub-nav uses the same pill style as existing tabs.

---

## Files to edit / create

- `src/routes/index.tsx` — fix `activeClubs` KPI + tooltip
- `src/routes/clubs.tsx`, `src/routes/at-risk.tsx` — align "active" definition where relevant
- `src/components/DataTable.tsx` — toolbar, search button, sortable columns
- `src/routes/cs.tsx` — convert to layout with sub-nav
- `src/routes/cs.tasks.tsx` (new) — move current tasks view
- `src/routes/cs.history.tsx` (new) — promoted history view

Item 5 (charts review) stays deferred unless you want it bundled in.
