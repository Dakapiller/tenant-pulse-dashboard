# Plano — 4 alterações ao app

## 1. PeriodSelector unificado na index

**Novo componente** `src/components/PeriodSelector.tsx`:
- Tipo `PeriodSelection`: `{ mode: "month" | "range" | "ytd" | "year" | "all"; month?: string; from?: string; to?: string; year?: number }`.
- Helper `resolvePeriod(sel, allPeriods)` que devolve `{ start: string; end: string; periods: string[]; label: string }` (períodos em formato `YYYY-MM-01`, intersectados com os disponíveis).
- UI: dropdown com 5 opções; consoante o modo aparece sub-controlo (select de mês+ano, dois selects para range, select de ano para "ano completo"; YTD e "todos" sem extras).

**Persistência**: search param `period` na rota `/` via `validateSearch` (zod) com `fallback`. Default = `{ mode: "month", month: periods[0] }`. Garante shareable URL + reactividade entre cards.

**Refactor de `src/routes/index.tsx`**:
- Substituir `selectedPeriod: string` por `periodSel` lido de `Route.useSearch()` + `useNavigate` para update.
- Calcular `{ start, end, periods: selectedPeriods }` (array de strings YYYY-MM-01 incluídas).
- Onde havia `s.period === latestPeriod` para GMV/Receita, passa a `selectedPeriods.includes(s.period)` (somatório sobre os meses do período).
- Para "Clubes Ativos no Período" e "Churned no Período": calcular sobre snapshots/statuses dentro do intervalo (clubes ativos = presentes em qualquer snapshot do período E não-churned no fim do período; churned = transições churned/closed registadas dentro do período).
- "Em Risco Alto" mantém-se (estado atual, sem mudanças).
- Labels dos KPI cards passam a "Clubes Ativos no Período", "Churned no Período", "Em Risco Alto", "GMV no Período", "Receita no Período".
- Charts (`monthlySeries`, `healthByMonth`) truncados pelo `end` do período em vez de `latestPeriod`.
- `clubs` aggregate usa `end` como cutoff.

## 2. Remover "Atividade CS recente"

- Apagar a secção `Atividade CS recente` em `src/routes/index.tsx` (tabela + memo `recentActivity` se só for usado aí). Remover imports órfãos (`DataTable`, etc., se não usados noutro sítio do ficheiro).

## 3. CS sidebar dropdown

**`src/components/Sidebar.tsx`**:
- Remover entry `{ to: "/cs/tasks", label: "CS", ... matchPrefix: "/cs" }`.
- Renderizar item "CS" como botão colapsável usando `Collapsible` do shadcn (já existe):
  - Trigger: ícone `Users` + label "CS" + `ChevronDown` (rotaciona quando aberto).
  - `defaultOpen = loc.pathname.startsWith("/cs")`; estado controlado com `useState` que abre automaticamente sempre que entra em `/cs/*`.
  - Children indentados: Tarefas → `/cs/tasks`, Bugs → `/cs/bugs`, Product Feedback → `/cs/feedback`, Histórico → `/cs/history`. Cada child aplica estilo ativo quando `loc.pathname.startsWith(child.to)`.
- Mesma estrutura replicada no drawer mobile.

**`src/routes/cs.tsx`**: remover `<CSSubNav />`, deixar só `<Outlet />`.

**`src/components/CSSubNav.tsx`**: apagar ficheiro (não usado noutro lado — confirmo antes via rg).

## 4. CS History — hoje por defeito + export

**`src/routes/cs.history.tsx`**:
- `dateFrom` e `dateTo` ambos inicializam a `today` (mesmo dia). Atualizar `setCurrentMonth` label/comportamento mantém-se.
- Adicionar botão "Hoje" no popover do calendário (`setDateFrom(today); setDateTo(today)`).

**Botão Export** ao lado dos filtros, com `DropdownMenu`:
- **Exportar Excel** (usa `xlsx` já instalado): gera workbook com 2 sheets:
  - `Tarefas`: tenant_name, week_start, reason, outcome, note, completed_at, priority — filtrado pelos tasks já no estado `filtered` (apenas kind=task). Carrega todas as páginas restantes antes do export se `hasMore` (loop `fetchTasksByStatusesPage` até esgotar) para garantir período completo.
  - `Histórico de Score`: nova função `fetchHealthScoreLog(from, to)` em `src/lib/health.ts` que faz select a `health_score_log` filtrado por `created_at` no intervalo. Colunas: tenant_name, previous_score, new_score, delta, reason, source, changed_by, created_at.
  - Filename: `historico-cs_YYYY-MM-DD_YYYY-MM-DD.xlsx`.
- **Exportar JPEG**: usa `html-to-image` (já instalado — equivalente ao html2canvas pedido, mais leve e compatível com Workers/SSR). `toJpeg(ref.current, { quality: 0.92, backgroundColor: "#fff" })` → download via link blob. Ref aplicada ao container principal da página.

## Detalhes técnicos

- **Search param schema** (rota `/`):
  ```ts
  const periodSchema = z.object({
    mode: fallback(z.enum(["month","range","ytd","year","all"]), "month").default("month"),
    month: z.string().optional(), from: z.string().optional(),
    to: z.string().optional(), year: z.number().optional(),
  });
  ```
- **`resolvePeriod`**: para `month` → start=end=esse mês; `range` → from..to; `ytd` → `${currentYear}-01-01` até último período disponível desse ano; `year` → todos os 12 meses do ano; `all` → primeiro..último período disponível.
- **xlsx**: `XLSX.utils.book_new()` + `XLSX.utils.json_to_sheet(rows)` + `XLSX.utils.book_append_sheet` + `XLSX.writeFile(wb, filename)`.
- **html-to-image** em vez de html2canvas: já está em `package.json`, não precisa de instalação nem de Node-only deps; produz a mesma JPEG.
- Tradução de campos para cabeçalhos PT nas folhas Excel (ex.: `outcome → "Resultado"`, mapeando via `outcomeLabel`).
- Nada toca em RLS, migrações, ou lógica de Health Score.

## Ficheiros tocados

- `src/components/PeriodSelector.tsx` (novo)
- `src/lib/period.ts` (novo — tipos + `resolvePeriod`)
- `src/routes/index.tsx` (search params, KPIs, labels, remove atividade CS)
- `src/components/Sidebar.tsx` (CS dropdown)
- `src/routes/cs.tsx` (remove CSSubNav)
- `src/components/CSSubNav.tsx` (apagar)
- `src/lib/health.ts` (adicionar `fetchHealthScoreLog`)
- `src/routes/cs.history.tsx` (default today + export Excel/JPEG)
