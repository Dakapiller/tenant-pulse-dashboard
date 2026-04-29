## 1. Deep-link to the club profile from any club name

Today the club "profile" lives inside `/clubs` as a side drawer opened by local React state (`setDrawerTenant`). We'll make it deep-linkable so every club name across the app can route to it.

- `/clubs` will read a `?tenant=<name>` search param and, when present, auto-open the existing drawer for that tenant.
- Add a small helper component `<ClubLink name="…">` that renders a `<Link to="/clubs" search={{ tenant: name }}>`. Closing the drawer clears the search param.
- Replace every clickable club name across the app with `<ClubLink>`:
  - `src/routes/index.tsx` — Radar de Risco (will be removed in step 2, but Atividade CS recente keeps a club name → make it a link too).
  - `src/routes/cs.tsx` — Tasks list, History list, club selector references.
  - `src/routes/at-risk.tsx` — card title + "Ver detalhe" button now go to `/clubs?tenant=…` instead of `/tenant/$name`.
  - `src/routes/clubs.tsx` — keep the in-page click but also sync the URL.
- The standalone `/tenant/$name` route stays in place as a fallback (no broken links), but is no longer linked from the UI.

## 2. Remove "Radar de Risco" from Visão Geral

Delete the Row 4 "Radar de risco" section in `src/routes/index.tsx` (header + `DataTable` + the `radarColumns` definition + `topRisk` memo). The full at-risk view already lives at `/at-risk` and the full club table at `/clubs`.

## 3. Period selector on Visão Geral

Add a period dropdown in the dashboard header (defaults to the latest uploaded month, listing every period from `fetchPeriods()` in descending order).

All "current month" computations are reworked to use the **selected** period instead of `latestPeriod`:
- KPIs `monthGmv` / `monthRevenue` filter by selected period.
- "Em risco alto", "Clubes ativos" and the status donut compute risk using snapshots up to the selected period (slice `hist` by `period <= selected`, filter statuses by `recorded_at <= selected month-end`).
- "Evolução positiva este mês" compares selected period vs the period immediately before it.
- "Tendência mensal" and "Distribuição de saúde" charts truncate the X-axis at the selected period (everything ≤ selected) so the user sees the historical view ending at that month.
- Header subtitle updates to `periodLabel(selectedPeriod)`.

## 4. Standardize tables, filters, headers and buttons

Goal: every table behaves the same — search + filters live in a toolbar **above** the table, every column is sortable, and primary actions use one shared button style.

- Extend `src/components/DataTable.tsx`:
  - Move the search input and any active per-column filters into a sticky **toolbar above** the table (current implementation puts the search in a `toolbar` slot but per-column filter chips live in headers — we'll surface active filter chips in the toolbar with a "Limpar" affordance).
  - Add `size="md"` search input by default (h-10, rounded-md, leading magnifier icon, trailing clear button) and accept a `searchSize` prop.
  - Default `sortable` to `true` for **every** column unless explicitly `sortable: false`. When a column has no `sortValue`, fall back to the rendered text.
  - Keep the existing per-column filter dropdown but always render the funnel icon next to sortable arrows for visual consistency.
- Create `src/components/ui/page-header.tsx` with `<PageHeader title subtitle actions>` and use it on `/`, `/clubs`, `/cs`, `/at-risk`, `/upload` so headers look identical (font size, spacing, action alignment).
- Create `src/components/ui/primary-button.tsx` (and `secondary-button.tsx`) wrapping the existing button primitive with the standard sizes used today (`h-9 px-3 text-sm` primary, `h-8 px-2.5 text-xs` secondary). Replace ad-hoc `<button class="...">` instances on the four main pages.
- Apply the new `DataTable` toolbar + sortable defaults to:
  - `/clubs` Risk table
  - `/cs` Tasks + History tables
  - `/at-risk` cards stay as cards, but its standalone search input is replaced by the shared `<SearchInput>` for consistency.
  - Atividade CS recente on `/` is upgraded from a hand-rolled `<table>` to `DataTable` (so it gets the shared search + sort).

## 5. Review and amend dashboards & charts

- **Tendência mensal** (line chart on `/`): tighten the legend (drop the duplicated "ano anterior" lines if no prior year data exists), align Y-axis tick formatting, add a short caption noting the selected period range. Respect the new period selector.
- **Distribuição de saúde** (stacked bar on `/`): switch to absolute counts AND a small "% Alto" annotation per month so users see both volume and proportion. Cut the chart at the selected period.
- **Distribuição por estado** (donut on `/`): show centre total ("N clubes") and percentages in the tooltip; ensure colours match the legend chips already shown (Ativo / Em churn / Fechado / Possível churn).
- **Evolução positiva**: keep the four positive cards but add a tiny delta arrow next to each value vs the previous month for context.
- **Sparklines** on `/at-risk`: standardize colour to match the risk tone, add `aria-label` for accessibility, and align the "últimos 6 meses" caption styling.
- **Risk-score variation list** in the club drawer (already added in a previous step): no behaviour change, just the new shared `<ScoreDelta>` styling.
- Audit Recharts containers to use a consistent margin (`{ top: 6, right: 16, bottom: 0, left: 4 }`) and `CartesianGrid` colour token.

## 6. Customer Success → sub-menu with Tasks and History

The existing `/cs` route uses an in-page tab to switch between "Contactos" and "Histórico". We'll surface them as proper sub-pages:

- Convert `/cs` into a layout route: `src/routes/cs.tsx` becomes a thin wrapper with a header + a sub-nav (Tasks · História) + `<Outlet />`.
- Move the contacts/tasks view into `src/routes/cs.tasks.tsx` (path `/cs/tasks`) and the history view into `src/routes/cs.history.tsx` (path `/cs/history`).
- `/cs` redirects to `/cs/tasks` (default landing).
- Sidebar item "Customer Success" stays pointing to `/cs`; when on a CS sub-route it stays highlighted. The sub-nav lives inside the page (pill-style, same look as a small tabs row).
- The History page gets a more prominent header and the standardized DataTable toolbar (search + per-column filters + sortable everywhere), so it no longer feels hidden.

## Technical details

- New search-param schema on `/clubs`:
  ```ts
  validateSearch: (s) => ({ tenant: typeof s.tenant === "string" ? s.tenant : undefined })
  ```
  Drawer effect: `useEffect(() => { if (search.tenant) setDrawerTenant(search.tenant); }, [search.tenant])`. Closing the drawer calls `navigate({ to: "/clubs", search: {} })`.
- `<ClubLink>` lives in `src/components/ClubLink.tsx` and is the single source of truth for in-app navigation to a club profile.
- The CS route split requires:
  - keeping `src/routes/cs.tsx` as the layout (renders sub-nav + `<Outlet />`).
  - extracting the current tasks state/handlers into `cs.tasks.tsx` and history rendering into `cs.history.tsx`. Shared helpers (loaders, generators, type defs) move to `src/lib/cs-page.ts` so both children import from one place.
  - `Route.beforeLoad` on `/cs` redirects to `/cs/tasks` when no child path is matched.
- DataTable changes are backwards-compatible: existing call sites keep working; the toolbar prop is opt-in but defaulted on for the four main tables.
- Period selector state lives in `src/routes/index.tsx` local state (default = `periods[0]`); no URL persistence needed.

## Files to add
- `src/components/ClubLink.tsx`
- `src/components/ui/page-header.tsx`
- `src/lib/cs-page.ts` (shared helpers extracted from current `cs.tsx`)
- `src/routes/cs.tasks.tsx`
- `src/routes/cs.history.tsx`

## Files to edit
- `src/components/DataTable.tsx` (toolbar, sortable default)
- `src/routes/index.tsx` (period selector, remove Radar, club links, chart polish, Atividade CS as DataTable)
- `src/routes/clubs.tsx` (read `?tenant=`, sync drawer to URL)
- `src/routes/cs.tsx` (becomes layout + sub-nav, redirect to `/cs/tasks`)
- `src/routes/at-risk.tsx` (card link → `/clubs?tenant=`, shared search input)

## Out of scope
- No DB schema changes.
- The standalone `/tenant/$name` route stays as a fallback URL but is no longer linked from the UI.
