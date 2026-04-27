## Goals

Make the daily CS workflow faster, link CS rows to club detail, fix the filter UX, and ship a usable mobile experience for iOS/Android.

## 1. DataTable — global search, outside-click filter close, mobile-friendly

Upgrade `src/components/DataTable.tsx` (single source of truth — the change benefits Clubes, CS, At-risk and Dashboard automatically):

- Add an integrated **search bar above the table**: input with magnifying-glass icon, clear (✕) button, real-time filtering across all columns whose `filterValue` is defined (opt-out via new `searchable: false` per column). Debounced naturally via React state.
- Show a **result counter** ("12 de 286 resultados") whenever search or filters are active, and a one-click "Limpar X filtros" pill.
- Close the per-column filter dropdown when the user clicks/taps **outside** it. Implemented via `mousedown` + `touchstart` listeners on `document` + ref map per column.
- Add `hideOnMobile` per-column flag so heavy tables can collapse non-essential columns (`<sm` breakpoint) — applied to secondary columns in Clubes (Taxa, CS Δ, Última atividade) so the table fits on a phone.
- Tighter horizontal padding on small screens (`px-3 sm:px-4`).
- Optional `toolbar` slot for page-specific actions (e.g. period selector) to sit beside the search box.

## 2. Mobile navigation + responsive shell

`src/components/Sidebar.tsx` + `src/routes/__root.tsx`:

- On `< md`, hide the fixed sidebar and show a sticky **top bar** with hamburger + brand. Tapping the hamburger opens an off-canvas drawer (slide-in from left, dim overlay). Closing on link click, overlay click, or Escape.
- On `≥ md`, keep the existing fixed left sidebar (no visual change).
- Use a small `useState` + `useLocation` (auto-close drawer on route change) — no extra deps.
- Add safe-area padding (`env(safe-area-inset-*)`) so iOS notch/home-bar don't clip content.

Per-page tweaks for mobile:

- Reduce page outer padding from `p-8` → `p-4 sm:p-6 lg:p-8`, applied in `index.tsx`, `clubs.tsx`, `cs.tsx`, `at-risk.tsx`, `upload.tsx`, `tenant.$name.tsx`.
- Dashboard KPI grid: `grid-cols-2 sm:grid-cols-2 lg:grid-cols-5` (was `1/2/5`) so mobile shows 2 KPIs per row instead of stacked single column.
- CS chart toolbar wraps cleanly on small screens (already `flex-wrap`, just verify gap).
- At-risk cards already responsive (`md:grid-cols-2 xl:grid-cols-3`) — confirmed OK.

## 3. CS → Clubes link (open full club history from CS)

In `src/routes/cs.tsx`:

- The club name in the contacts table currently renders as plain text. Convert it to a `<Link to="/tenant/$name" params={{ name: r.name }}>` styled as a hover-underline link, keeping `e.stopPropagation()` so the row's expand toggle still works only for the rest of the row.
- Inside the **expanded panel** (`ExpandedClubPanel`), add a header strip with two quick actions:
  - "Ver clube" → `/tenant/$name` (full history, snapshots, charts).
  - "Abrir no Clubes" → `/clubs` (so user can edit status/competitor inline).
- In the **History tab**, the tenant link is already wired — keep as is.

## 4. Apply the new DataTable features in pages

- **Clubes** (`src/routes/clubs.tsx`): drop the local "Use os ícones de filtro nas colunas para refinar" hint (now redundant with the search box). Mark `rate`, `csImpact`, `lastActivity` columns `hideOnMobile`. Move the "Exportar" button into the DataTable `toolbar` so it lives next to the search.
- **CS** (`src/routes/cs.tsx`): pass `searchPlaceholder="Pesquisar clube…"`. Move the "Esta semana / Este mês / Este ano" range tabs into the DataTable `toolbar`.
- **Dashboard radar** (`src/routes/index.tsx`): inherits search automatically. Mark `flags` column `hideOnMobile`.
- **At-risk** (`src/routes/at-risk.tsx`): currently a card grid (no table). Add a small search input above the grid that filters cards by name (local `useState`, simple substring match).

## 5. Misc polish

- Buttons sized ≥ 36 px on mobile (touch target). Tailwind `min-h-9` applied to interactive controls in toolbars.
- `select` elements get `text-base sm:text-xs` so iOS does not zoom on focus (Safari auto-zooms when input font is < 16 px).
- Search input uses `type="search"` (gives iOS the magnifying-glass keyboard + clear button).
- Add the `viewport-fit=cover` meta tag in `__root.tsx` head for proper iOS notch handling.

## Files to change

- `src/components/DataTable.tsx` — search, outside-click, mobile columns, toolbar slot.
- `src/components/Sidebar.tsx` — drawer + hamburger for mobile.
- `src/routes/__root.tsx` — viewport meta, top bar slot, safe-area padding.
- `src/routes/cs.tsx` — link to tenant detail, toolbar usage, "Ver clube" in expanded panel.
- `src/routes/clubs.tsx` — toolbar export button, `hideOnMobile` columns, drop redundant hint.
- `src/routes/index.tsx` — KPI grid breakpoints, hideOnMobile.
- `src/routes/at-risk.tsx` — local search above card grid.
- `src/routes/upload.tsx`, `src/routes/tenant.$name.tsx` — page padding only.

No new npm packages, no new database tables.