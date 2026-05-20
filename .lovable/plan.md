## Plano: integrar bugs resolvidos no histórico + atualizar página de ajuda

### 1. `src/routes/cs.history.tsx` — incluir bugs resolvidos no feed global

- Importar `fetchBugsByStatuses`, `BUG_SEVERITY_LABEL`, tipo `BugReport` de `@/lib/bugs`.
- No `useEffect` inicial, fazer `Promise.all` com `fetchBugsByStatuses(["solved"])` em paralelo a `fetchTasksByStatusesPage` e `fetchAllCSStatuses`. Guardar em `bugs` state.
- Criar tipo discriminado `HistoryEntry = { kind: "task"; task: CSTask } | { kind: "bug"; bug: BugReport }` e construir `entries` unificadas a partir de `tasks` e `bugs.filter(b => b.solved_at)`.
- Adaptar `effectiveTs`, `filtered`, `grouped` para lidar com ambos os tipos (timestamp do bug = `solved_at`).
- Filtro de outcome: bugs só aparecem quando `outcome === "all"` (não têm outcome).
- Filtro de data e pesquisa por clube: aplicam-se igualmente aos bugs.
- Sumário `Total ações`: incluir bugs resolvidos na contagem; `Clubes contactados` une os dois conjuntos.
- Render: novo `StatusBadge` para bugs (badge azul "Bug resolvido" + severidade pequena), com link clicável (ícone external-link) para `bug.link`, abrindo em nova tab. Reutilizar mesma estrutura grouped/collapsible das tarefas.
- Paginação: por simplicidade, carregar todos os bugs resolvidos no primeiro fetch (volume reduzido). O "Carregar mais 50" continua a aplicar-se só às tarefas.

### 2. `src/routes/tenant.$name.tsx` — entrada "Bug resolvido" na timeline do clube

- Importar `fetchBugsForTenant` e tipo `BugReport` de `@/lib/bugs`.
- Acrescentar `bugs` ao state e ao `Promise.all` do `useEffect`.
- Passar `bugs` para `CSHistory` como nova prop.
- Em `CSHistory`, alargar o tipo `Entry` com campo opcional `kind: "task" | "bug"` e `link?: string`, `severity?: BugSeverity`.
- Para cada bug com `solved_at`, criar entrada com:
  - `date = solved_at`
  - badge azul "Bug resolvido" (em vez do badge de outcome)
  - texto principal: título do bug + chip de severidade
  - link clicável para `bug.link` (external icon)
  - nota = `bug.note`
- Ordenação por data desc continua igual.
- Texto do estado vazio mantém-se ("Sem interações de CS registadas").

### 3. `src/routes/help.score.tsx` — refletir Regra 5

Trata-se de presentation: a página de ajuda atualmente lista 4 regras e diz "apenas quatro formas". Atualizar para 5:

- Substituir parágrafo introdutório "quatro formas (e **apenas quatro**)" por "cinco formas (e **apenas cinco**)".
- Adicionar novo `<Card>` **Regra 5 — Bug resolvido** depois da Regra 4:
  - Texto: "Quando um bug reportado pela equipa de CS é marcado como **Resolvido** na lista de Bug Reports, o clube afetado recebe automaticamente **+5 pontos** de health score. O bónus aplica-se apenas na primeira transição para Resolvido — reabrir e voltar a resolver o mesmo bug não soma de novo. Estados `Não será corrigido` e `Em curso` não têm impacto no score."
- Atualizar secção "Mínimo dinâmico (floor)" mantendo lista actual mas mencionar que o bónus de bug **respeita o mínimo dinâmico e o teto de 100** (igual às outras regras automáticas).
- Atualizar a frase final "as quatro regras acima" na secção "Flags informativas vs. score" → "as cinco regras acima".

### 4. Memória do projeto

A Core memory já inclui "Health Score (0-100) regido por 5 regras". Confirmar — sem alterações.

### Ficheiros a editar
- `src/routes/cs.history.tsx`
- `src/routes/tenant.$name.tsx`
- `src/routes/help.score.tsx`

### Fora de scope
- Página de ajuda separada para Bug Reports (pode ser adicionada depois se o user pedir).
- Notificações ou recálculos retroativos de bugs resolvidos pré-existentes.
