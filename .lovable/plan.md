## Bug Reports — gestão dedicada de bugs no fluxo CS

### 1. Modelo de dados — nova tabela `bug_reports`

Migração que cria a tabela e RLS (mesmo padrão de `product_feedback`: leitura para qualquer autenticado, escrita para CS/superuser, delete só superuser).

Colunas:
- `id` uuid PK
- `tenant_name` text (clube afetado)
- `title` text (1-200 chars — resumo curto do bug)
- `link` text (URL para o ticket/issue; validado como `https?://…`)
- `severity` text — `blocker` | `major` | `minor`
- `status` text — `open` | `in_progress` | `solved` | `wont_fix` (default `open`)
- `note` text nullable (até 1000 chars)
- `reported_at` date (default hoje; editável)
- `solved_at` timestamptz nullable (preenchido automaticamente ao passar a `solved`; limpo se reabrir)
- `created_by` uuid nullable, `created_at` timestamptz default `now()`
- `updated_at` timestamptz default `now()` (trigger `touch_updated_at` no padrão de `changelog_entries`)

Validação de transição feita em código (`src/lib/bugs.ts`), não em check constraint. Índices em `(tenant_name)`, `(status)` e `(solved_at desc)`.

### 2. Lógica core — `src/lib/bugs.ts`

Novo módulo com:
- Tipos `BugStatus`, `BugSeverity`, `BugReport`, `InsertBugInput`.
- Constantes `BUG_STATUS_OPTIONS`, `BUG_SEVERITY_OPTIONS` (com label + tooltip + classes de cor, à imagem de `FEEDBACK_STATUS_OPTIONS`).
- `insertBugReport(input)` — valida link, título, severidade, status inicial; grava `created_by`.
- `fetchAllBugs()`, `fetchBugsForTenant(tenant)`, `fetchBugsByStatus(...)` (paginado via `fetchAllPaged`).
- `updateBugStatus(id, newStatus, comment?)` — atualiza status, define/limpa `solved_at`, e em `solved` dispara `applyBugSolvedBonus(tenant)`. Disparo idempotente: se o bug já estava `solved`, não aplica de novo.
- `updateBugFields(id, patch)` — para editar link/severidade/nota sem mexer no status.
- Helpers de export CSV/XLSX (mesmo padrão de `feedback.ts`).

### 3. Health Score — Rule 5 (nova regra, requer documentar)

A core memory diz "Health Score regido por 4 regras em `src/lib/health.ts` — não inventar lógica nova". Esta é uma 5ª regra explicitamente pedida pelo utilizador. Em `src/lib/health.ts`:
- Atualizar o comentário-cabeçalho para listar **Rule 5 — Bug resolvido → +5**.
- Adicionar `HealthSource` `"bug"`.
- Nova função `applyBugSolvedBonus(tenant, bugTitle)` que chama `persistScoreChange(tenant, cur, cur+5, "Bug resolvido: <título>", "bug")`. Usa o `persistScoreChange` existente — respeita o clamp [0,100] e o piso dinâmico já implementado.
- Atualizar a memória do projeto para refletir 5 regras.

### 4. Diálogo "+" — novo separador "Bug Report" em `NewTaskDialog.tsx`

Adicionar `"bug"` ao tipo `DialogTab`. Novo botão no header (após "Product Feedback") com ícone `Bug` (lucide). Campos:
- Clube (picker partilhado, já existe).
- Título (1-200 chars).
- Link (input URL, obrigatório, validado).
- Severidade (3 botões em pílula: Blocker / Major / Minor com tooltips).
- Estado inicial (default Aberto; permitir Em curso se já está a ser tratado).
- Data do report (default hoje, editável — input date).
- Nota (opcional, até 1000 chars).

Labels: `titleByTab.bug = "Novo bug report"`, `submitLabelByTab.bug = "Registar bug"`. Botão submit chama `insertBugReport`.

### 5. Sub-navegação CS — `src/components/CSSubNav.tsx`

Inserir item `Bugs` (ícone `Bug`) **entre Tarefas e Product Feedback**:

```
Tarefas · Bugs · Product Feedback · Histórico
```

### 6. Nova página `src/routes/cs.bugs.tsx`

Layout no estilo de `cs.feedback.tsx`:
- Header com contadores: Abertos · Em curso · Resolvidos (mês) · Não corrigidos.
- Barra de filtros: pesquisa por clube/título, filtro de severidade, filtro de estado, range de datas (reported_at), toggle "mostrar inativos" (reaproveita `excludedTenants`).
- Botão "Exportar Excel" (detalhado + agregado por clube).
- Lista agrupada **por clube** (igual ao Histórico) com colapsável; ou alternativa lista flat — vou implementar flat com colunas: Clube, Título (link clicável), Severidade (badge), Estado (select inline), Data, Resolvido em, Ações.
- Mudar estado é um `Select` inline que chama `updateBugStatus`. Ao escolher "Resolvido" pede um comentário curto (modal de confirmação) e dispara o +5 do health score; mostra toast "Health score +5".
- Reabrir um bug resolvido (voltar a Aberto/Em curso) limpa `solved_at` mas NÃO reverte o bónus de health (decisão consciente: o bónus já foi creditado pela resolução; reverter seria penalizar duplo).
- Linha clicável abre painel lateral com nota completa, histórico de alterações de estado (opcional — fora de escopo nesta entrega; só mostramos `created_at`, `solved_at`).

### 7. Histórico do CS — entrada "Bug resolvido"

Em `src/routes/cs.history.tsx`:
- Carregar bugs com `status = 'solved'` em paralelo (`fetchBugsByStatus(['solved'])`) e fundir com a lista de tarefas no `filtered`/`grouped`.
- Modelar como `HistoryEntry` discriminado (tipo `task` vs `bug`).
- Badge azul "Bug resolvido" com link 🔗 para o `bug.link`.
- Filtros existentes (data, clube, inativos) aplicam-se; o filtro de "Resultado" só atua em tarefas (bugs ignoram).
- Card "Total ações" passa a contar tarefas concluídas **+** bugs resolvidos.

### 8. Histórico por clube — `src/routes/tenant.$name.tsx`

Em `CSHistory`, juntar bugs resolvidos do clube (via `fetchBugsForTenant` filtrado por `status = solved`) como uma entrada extra:
- `date = solved_at`
- Badge "Bug resolvido" + link.
- Nota do bug, se existir.

Ordenação cronológica desc continua a funcionar.

### 9. Notas técnicas

- Validação de URL: regex `^https?:\/\/.+` no client + check no `insertBugReport`.
- Transições de estado validadas no `updateBugStatus`: `wont_fix` ↔ `open` e `solved` ↔ `open` permitidas; passar de `solved` para `wont_fix` (ou vice-versa) força ir primeiro a `open`. Mantém histórico mental claro.
- Idempotência do bónus: `applyBugSolvedBonus` recebe `previousStatus` e só aplica se `previousStatus !== 'solved'`.
- Permissões: `wont_fix` só pode ser definido por `superuser` (CS marca apenas Aberto/Em curso/Resolvido). Verificação no client (esconde opção) + RLS já cobre via update permitido a CS.

### 10. Ficheiros a tocar

```text
supabase migration              novo: cria tabela bug_reports + RLS
src/lib/bugs.ts                 novo: tipos, fetchers, mutations, exports
src/lib/health.ts               edit: Rule 5, HealthSource "bug", applyBugSolvedBonus
src/components/NewTaskDialog.tsx edit: separador "Bug Report" + campos
src/components/CSSubNav.tsx     edit: novo item "Bugs"
src/routes/cs.bugs.tsx          novo: página de gestão
src/routes/cs.history.tsx       edit: fundir bugs resolvidos
src/routes/tenant.$name.tsx     edit: entrada "Bug resolvido" no histórico
src/routeTree.gen.ts            auto-regen
mem://index.md                  edit: passar para 5 regras
```

### Fora de escopo (a confirmar)

- Notificações/email quando um bug muda de estado.
- Edição em massa de bugs.
- Histórico detalhado de transições de estado (audit log dedicado).
- Anexos/imagens no bug report (só link externo nesta entrega).