## Goal

Three surgical changes:
1. Bulk actions in `/clubs` and `/cs`.
2. Exclude churned + closed clubs from all metric calculations.
3. Make the "missing clubs" warning banner clickable and editable.

## 1. Helper layer (`src/lib/cs.ts`)

Add three small helpers that all pages can reuse:

```ts
buildCurrentStatusMap(statuses) -> Map<tenant, ClubStatus>
excludedTenants(statuses) -> Set<tenant>      // churned + closed
isExcludedStatus(status) -> boolean
```

These centralise the exclusion rule so every aggregate uses the same source of truth.

## 2. DataTable bulk-selection support (`src/components/DataTable.tsx`)

Extend `DataTable` with optional, fully opt-in bulk-selection:

```ts
selectable?: boolean
selectedKeys?: Set<string>
onSelectionChange?: (next: Set<string>) => void
isRowSelectable?: (row: T) => boolean   // optional gate
```

Behaviour:
- When `selectable` is true, render a checkbox cell as the first column (header + per-row).
- The header checkbox toggles ALL currently visible (filtered + searched) rows. Indeterminate state when partially selected.
- Selection state is controlled by the parent so the page can render its own floating action bar.
- Clicking a row checkbox calls `e.stopPropagation()` so it does not trigger `onRowClick` / row expansion.
- "Visible/filtered rows can be selected" requirement is satisfied because the header toggle uses the already-filtered list.

No other DataTable behaviour changes.

## 3. `/clubs` — bulk status change + missing-clubs modal

### 3a. Bulk-action floating bar

- Add `selectedKeys` state in `ClubsPage`. Pass `selectable` + state to `DataTable`.
- When `selectedKeys.size > 0`, render a fixed bottom bar (`fixed bottom-0 left-0 right-0`, glass-morphism background, safe-area aware) containing:
  - "X clubes selecionados"
  - Status `<select>` (5 options from `CLUB_STATUS_OPTIONS`)
  - Competitor `<select>` (only visible when status === churned)
  - "Aplicar" button → loops the selection, calls `setClubStatus(name, newStatus, currentStatus, null, "cs", competitor)` for each. After completion, clears selection and reloads.
  - "Cancelar" link → clears selection.
- The bar uses `desktop:left-60` so it sits beside the sidebar on desktop, and full-width on mobile.

### 3b. Missing-clubs modal

- Replace the current static `<div>` warning with a `<button>` (same styling, cursor-pointer, hover ring). Click opens `MissingClubsModal`.
- Modal shows only the rows where `r.missingFromLatest && !isExcludedStatus(r.status)`.
- Modal columns: Clube · Última vez visto (latest period in `r.history`) · Último GMV · Última saúde (badge with score) · Estado (inline `InlineStatusEditor` reused).
- Bulk select supported using the same `DataTable` `selectable` API; same floating bar logic but rendered inside the modal footer instead of the page.
- Tracking "actioned" clubs: each tenant whose status was changed during this modal session gets added to a local `Set<string>` (`actionedNames`). When the modal closes:
  - If every missing tenant is in `actionedNames` OR has an updated current status that is no longer "active"/"possible_churn" with `missingFromLatest`, the banner disappears (we re-derive `missingCount` from refreshed data after each action).
  - Else, the banner stays.
- Modal scroll: `max-h-[80vh]` with internal `overflow-auto`.

### 3c. Banner copy

Banner stays Portuguese: "X clubes em falta — clique para rever". Add chevron + clickable affordance.

## 4. `/cs` — bulk complete tasks

- Add `selectedKeys` state in `CSPage`. Pass `selectable` + state to the contacts `DataTable`.
- A row is selectable only if it has at least one pending task (`isRowSelectable: r => r.pending.length > 0`).
- Floating bar appears when `selectedKeys.size > 0` with one action: "Marcar todas como feitas". Clicking opens an inline form (outcome dropdown + optional note), then on confirm:
  - For each selected club, loop its `pending` tasks and call `completeCSTask(t.id, t.tenant_name, outcome, note)`.
  - Clear selection and reload.

No tab change needed for History view — selection only exists on the Contacts tab.

## 5. Exclude churned/closed from metrics (everywhere)

Build the exclusion set once per page using `excludedTenants(statuses)` and apply it:

### Dashboard (`src/routes/index.tsx`)

- Filter `clubs` array used for KPIs (`activeClubs`, `highRisk`), `positives`, `statusDistribution`, `topRisk`. Already excludes `churned`/`closed` from `highRisk` and `topRisk`; extend to all aggregates.
- KPIs `monthGmv`, `monthRevenue`: filter snapshots by `!excluded.has(s.tenant_name)`.
- `monthlySeries` (current + prior-year): filter snapshots before grouping.
- `healthByMonth`: filter `tenantsThatMonth` to drop excluded tenants.
- `recentActivity`: do NOT filter (it's individual task records, not aggregate).
- Add a small grey caption under the KPI section: `"Clubes em churn e fechados excluídos dos cálculos."`
- Keep `kpis.churnedThisYear` exactly as it is — the count of churned clubs is the metric itself.
- Keep `KpiCard "Clubes ativos"` definition: same as before (active + possible_churn), unaffected.

### CS page (`src/routes/cs.tsx`)

- `series` (timeline aggregate): filter snapshots by `!excluded.has(s.tenant_name)` before period grouping.
- Per-tenant chart mode: when the user explicitly picks a churned/closed tenant, still show their data (single-tenant exception — they're choosing it).
- Tasks list: keep all (CS workflow can still log on excluded clubs if they have pending tasks).

### At-risk (`src/routes/at-risk.tsx`)

- Already filters out churned/closed implicitly because `risk.flags.length === 0` for many. Add explicit `if (excluded.has(name)) continue;` early.

### Clubes (`src/routes/clubs.tsx`)

- Show all clubs (filterable). No metric exclusion needed — this is the catalogue view itself.

### Tenant detail

- Out of scope (single-tenant view, no aggregates).

## 6. Files touched

- `src/lib/cs.ts` — add 3 helpers.
- `src/components/DataTable.tsx` — add `selectable` + selection callbacks.
- `src/routes/clubs.tsx` — bulk bar, clickable banner, missing-clubs modal.
- `src/routes/cs.tsx` — bulk complete tasks.
- `src/routes/index.tsx` — apply exclusion to aggregates + caption.
- `src/routes/at-risk.tsx` — apply exclusion.

No DB migration. No new packages. All actions reuse existing `setClubStatus` / `completeCSTask` server functions.

## 7. UX notes

- Floating bar uses tokens (`bg-background`, `border-border`) so it works in dark mode if added later, and respects safe-area inset on iOS.
- Header checkbox is `indeterminate` when 0 < selected < visible.
- Closing the missing-clubs modal performs `await loadAll()` once so the banner state is fresh.
- Bulk apply is sequential (not parallel) to keep ordering deterministic in `club_status_log`.