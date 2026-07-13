## Contexto

Duas coisas na mesma queixa:

1. **"Não devem ser geradas tarefas para clubes churned"** — já está implementado: `generateWeeklyTasks` chama `excludedTenants(statuses)` e salta churned/closed/changed_owner. Além disso, `setClubStatus` já chama `cancelPendingTasksForTenant` sempre que passa a inativo. Ou seja, a lógica está correcta; o que falhou no caso do JustPadel Barcelos foi **não estar marcado como churned** — só agora o utilizador o marcou. Não é preciso mexer nesta parte.

2. **Marcar como churn a partir do side panel (ClubQuickView)** — falta. Hoje o painel só permite criar tarefa, ajustar score ou abrir a página completa. É isto que vou adicionar.

## O que vou mudar

Ficheiro único: `src/components/ClubQuickView.tsx`.

- Tornar o `StatusPill` no topo clicável, abrindo um editor inline idêntico ao usado em `/clubs` (dropdown de estado + dropdown de competidor quando estado = `churned`, botão de confirmar).
- Ao confirmar chama `setClubStatus(tenant, next, current, null, "cs", competitor)` (já existente em `src/lib/cs.ts`). Isto:
  - grava o novo estado e o log,
  - **cancela automaticamente as tarefas pendentes** desse clube quando passa a inativo (via `cancelPendingTasksForTenant`, já existente).
- Depois do save, faz `loadAll()` para o painel refletir o novo estado + tarefas canceladas, e chama `onChanged?.()` para a página por trás (lista de tarefas, /clubs, etc.) refrescar.

Reutilizo as constantes já exportadas em `src/lib/cs.ts` (`CLUB_STATUS_OPTIONS`, `COMPETITOR_OPTIONS`) — sem duplicar componente; faço uma versão pequena inline no ficheiro para não tocar em `clubs.tsx`.

## Fora do âmbito

- Sem alterações à geração de tarefas (já respeita `excluded`).
- Sem alterações a `/clubs`, `/cs/*`, `tenant.$name`, base de dados ou tipos.
- Sem mexer em créditos/lógica de negócio.

## Verificação

`bunx tsgo --noEmit` no fim.
