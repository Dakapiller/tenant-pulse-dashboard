## O que está a acontecer

Na página `/clubs` existem hoje **dois controlos separados** relacionados com pendências que podem estar ligados ao mesmo tempo:

1. **"Ver tarefas pendentes"** (`pendingPanelOpen`) — abre um painel em cima da tabela com **uma linha por tarefa pendente** (para ações em massa: concluir, anular, adiar).
2. **"Apenas com pendentes"** (`filterPendingOnly`) — filtra a **tabela de clubes** para mostrar só clubes com tarefas pendentes.

Como na tua situação cada clube tem exatamente 1 tarefa pendente, os dois painéis mostram-te 10 linhas cada — mas são vistas diferentes do mesmo conjunto (uma por tarefa, outra por clube). Daí a sensação de duplicação. Não há dados a mais, é UI a mostrar a mesma informação em dois formatos ao mesmo tempo.

## Proposta (mudança mínima, sem alterar lógica de dados)

Tornar os dois controlos **mutuamente exclusivos** e clarificar o texto — sem tocar em nenhum cálculo de pendentes, tarefas ou saúde.

### Alterações em `src/routes/clubs.tsx`

1. **Botão "Ver tarefas pendentes"** (linha 319)
   - Ao ligar, também faz `setFilterPendingOnly(false)`.
   - Enquanto o painel está aberto, esconder o botão "Apenas com pendentes" (fica redundante, já que o painel de cima já é a vista de pendentes).

2. **Botão "Apenas com pendentes"** (linha 328)
   - Ao ligar, também faz `setPendingPanelOpen(false)` e limpa `selectedTaskIds`.

3. **Cabeçalho do painel superior** (linha 285)
   - Acrescentar um `<p>` de ajuda: *"Vista por tarefa. Fecha este painel para voltar à lista por clube."* — para deixar claro que é uma vista alternativa, não uma duplicação.

### Fora de âmbito

- Sem alterações em `PendingTasksFlatView`, `pendingCount`, `rows`, filtros de churn/novos, ou qualquer outra métrica.
- Sem alterações a `/cs/*`, `/tenant/*`, dashboard, ou base de dados.
- Sem novos componentes; só três pequenos ajustes no ficheiro `src/routes/clubs.tsx`.

## Verificação

`bunx tsgo --noEmit` no fim.