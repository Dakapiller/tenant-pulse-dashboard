## Objetivo

Ao clicar num clube a partir de qualquer página (Tarefas, Histórico, Em risco, Visão geral, Calendário, etc.), abrir um **modal/drawer overlay** com o resumo do clube **sem sair da página atual**. Fechar o modal deixa o utilizador exatamente onde estava, com filtros/scroll intactos.

## Como funciona hoje

- `ClubLink` navega para `/clubs?tenant=X`, o que força mudança de rota.
- `ClubDrawer` só existe dentro de `src/routes/clubs.tsx` e depende de um `ClubRow` calculado nessa página (linhas 892–1022).
- "Abrir página completa" no drawer já leva a `/tenant/$name`.

## Proposta

### 1. Extrair um componente auto-suficiente `ClubQuickView`

Novo ficheiro `src/components/ClubQuickView.tsx`:
- Recebe apenas `tenant: string` e `onClose: () => void`.
- Carrega internamente o essencial para o tenant: snapshots (`fetchAllSnapshots` filtrado por tenant), estados (`fetchCSStatusesForTenant`), tarefas (`fetchCSTasksForTenant`), score de saúde (`fetchHealthScores`), logs de estado (`fetchClubStatusLogsForTenant`).
- Renderiza o mesmo layout de painel lateral que existe hoje em `ClubDrawer` (linhas 913–1021): cabeçalho com nome + badge de estado + tarefas pendentes, secção Score, YoY, lista de pendentes com `TaskQuickActions`, e os três botões (`+ Tarefa`, `Score`, `Abrir página completa`).
- Reutiliza os diálogos já existentes (`NewTaskDialog`, `AdjustScoreDialog`).

O `ClubDrawer` interno de `/clubs` passa a ser um wrapper fino sobre `ClubQuickView` para não duplicar UI (ou é removido e a página passa a usar `ClubQuickView` diretamente).

### 2. Provider global `ClubQuickViewProvider`

Novo ficheiro `src/contexts/ClubQuickViewContext.tsx`:
- Contexto expõe `openClub(name: string)` e `close()`.
- Estado interno guarda `tenant | null`.
- Quando `tenant` está definido, renderiza `<ClubQuickView tenant={...} onClose={close} />` por cima da app.
- Montado em `src/routes/__root.tsx` a envolver o `<Outlet />`, para funcionar em qualquer rota.

### 3. `ClubLink` passa a abrir o modal

`src/components/ClubLink.tsx`:
- Deixa de ser um `<Link to="/clubs" search={{ tenant }}>`.
- Passa a ser um `<button>` que chama `openClub(name)` do contexto.
- Mantém a mesma assinatura pública (`name`, `children`, `className`, `onClick`), portanto **nenhum call site precisa de mudar** — todos os locais que já usam `ClubLink` (tarefas, histórico, em risco, dashboard, bugs, feedback, calendário, drawer, etc.) ganham o novo comportamento automaticamente.
- Exceção: quando o utilizador já está em `/tenant/$name` do mesmo clube, o botão fica inerte / fecha o modal (evita abrir modal sobre a própria página).

### 4. Compatibilidade com `/clubs?tenant=…`

- A página `/clubs` continua a suportar o search param `?tenant=X` (deep-link atual). Em vez de renderizar um `ClubDrawer` local, chama `openClub(search.tenant)` num `useEffect` e limpa o param ao fechar.
- Isto preserva:
  - Bookmarks / links partilhados que apontem para `/clubs?tenant=X`.
  - O botão "Abrir página completa" dentro do modal (navegação para `/tenant/$name` fecha o modal e muda de página, comportamento esperado).

### 5. Pormenores de UX

- Fecho por: botão ✕, clique no backdrop (já existe), tecla `Esc`.
- `body` scroll bloqueado enquanto o modal está aberto.
- Ao fechar, foco volta ao elemento que abriu (não bloqueia — se falhar, cai no `document.body`).
- Nenhuma mudança de URL ao abrir/fechar (fora do caso `/clubs?tenant=…` legado); assim os filtros e paginação da página base ficam intocados.

## Ficheiros afetados

- **Novo**: `src/components/ClubQuickView.tsx` (extraído de `ClubDrawer`).
- **Novo**: `src/contexts/ClubQuickViewContext.tsx` (provider + hook `useClubQuickView`).
- **Editado**: `src/routes/__root.tsx` — envolver `<Outlet />` com o provider.
- **Editado**: `src/components/ClubLink.tsx` — passar a chamar `openClub`.
- **Editado**: `src/routes/clubs.tsx` — remover `ClubDrawer` local, redirecionar `?tenant=X` para `openClub()`.

## Fora de âmbito

- Sem alterações a `/tenant/$name` (página completa continua exatamente como está).
- Sem alterações à lógica de score, tarefas, bugs, base de dados ou aos filtros das páginas base.
- Sem alterações a exports, bulk actions ou permissões.