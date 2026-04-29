## Redesign /cs/history

Rebuild the page to match the original spec while keeping safe server-paginated loading (50/page, completed_at desc, never fetch all at once).

### Layout (top → bottom)

1. **Header** — title "Histórico CS" + subtítulo.
2. **Filters bar** (sticky-ish card):
   - Date range picker (default: 1º dia do mês atual → hoje). Uses shadcn `Calendar` in `Popover`, range mode, PT-PT locale.
   - Search input — pesquisar clube (debounced 300ms via `useDebouncedValue`).
   - Outcome `<Select>` — Todos / Má relação / Boa recetividade / Cliente satisfeito.
   - Toggle "Mostrar inativos" (mantém comportamento atual).
3. **Summary cards** (3 cards, grid `md:grid-cols-3`) calculados sobre as tarefas visíveis no período selecionado:
   - **Total ações** — contagem de tarefas concluídas.
   - **Clubes contactados** — clubes únicos.
   - **Resultado mais comum** — outcome com maior contagem (label PT + nº).
4. **Resultados agrupados por clube**:
   - Lista de clubes ordenados pela atividade mais recente (último `completed_at` desc).
   - Cada clube = linha colapsável (`Collapsible` shadcn) mostrando:
     - Nome do clube (`ClubLink`)
     - Total de ações no período (`badge`)
     - Último resultado (badge color-coded: vermelho=Má relação, azul=Boa recetividade, verde=Cliente satisfeito)
     - Chevron rotativo
   - Expandido: tabela com colunas **Data · Flag(s) · Resultado · Comentário** (cronológica desc).
5. **Carregar mais** — botão no fim, só aparece se `hasMore` E não há filtro de data restritivo a período já totalmente carregado. Mensagem informativa quando o range selecionado pode incluir registos ainda não carregados ("Carregar mais para ver registos anteriores a {data}").

### Data flow

- Mantém `fetchCompletedCSTasksPage(offset, 50)` — server-side pagination intacto, sem `limit()` em `tenant_snapshots`.
- Estado: `tasks`, `hasMore`, `loadingMore`, `dateRange`, `search`, `outcome`, `showInactive`.
- `useMemo` para:
  - `filtered` (date + search + outcome + inactive)
  - `groupedByClub` (Map<tenant, tasks[]> ordenado por última atividade)
  - `summary` (counts derivados de `filtered`)
- `useDebouncedValue(search, 300)`.

### Color-coded outcome badges

- `bad_relationship` → `bg-danger/10 text-danger` "Má relação"
- `good_receptivity` → `bg-primary/10 text-primary` "Boa recetividade"
- `very_satisfied` → `bg-success/10 text-success` "Cliente satisfeito"

### Files to edit

- `src/routes/cs.history.tsx` — rebuild completo conforme acima.
- (Opcional) pequeno helper em `src/lib/cs.ts` para mapping de cor por outcome — fica inline no ficheiro da rota para evitar churn.

### Não muda

- Lógica de queries / risk / `tenant_snapshots`.
- Pagination contract (50/page server-side).
- Resto da app.