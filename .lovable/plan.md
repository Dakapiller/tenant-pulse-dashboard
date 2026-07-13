## O que se passou (diagnóstico com dados reais)

Fui à tabela `cs_tenant_status` do JustPadel Barcelos. Todos os registos até hoje tinham `club_status = 'active'`. A palavra "churn" aparece **só em texto livre**, no campo `note`, com `relationship_status = 'bad_relationship'`:

- 29/04/2026 · active · "Vai ser churn - Smash Pro. Ainda nao temos data prevista…"
- 30/04/2026 · active · "Churn em breve - Smashpro - sem data prevista…"
- 22/05, 01/06, 11/06 · active · "Churn - Smash Pro" / "Churn SmashPro"
- **13/07/2026 13:05** · possible_churn ← primeira vez que o estado do clube passou de active
- 13/07/2026 14:18 · active · "Churn para SmashPRO" (nota escrita depois, mas com club_status active)

Ou seja: o gerador de tarefas fez o que devia — só exclui `churned/closed/changed_owner`, e o clube só passou a `possible_churn` (que ainda é ativo para efeitos de tarefas) hoje à tarde. A informação de churn existia há 2 meses mas só como **texto livre numa nota**, nunca como estado.

Causa raiz: as opções de `outcome` de uma tarefa não incluem nada tipo "clube em churn". As três opções são `bad_relationship`, `good_receptivity`, `very_satisfied`. Quem faz CS acabou por descrever churn na caixa de nota, e o resto do sistema não tem como saber.

## Proposta

Não tocar em dados antigos. Fechar o buraco para o futuro em dois passos pequenos, ambos em `src/lib/cs.ts` + os sítios que consomem `OUTCOME_OPTIONS`:

1. **Adicionar outcomes explícitos de churn** ao `OUTCOME_OPTIONS`:
   - `churned` — "Confirmado churn"
   - `possible_churn` — "Possível churn"
   Labels correspondentes em `outcomeLabel`.

2. **Propagar o outcome para `club_status`** dentro de `completeCSTask` e `completeCSTasksBatch`. Depois de gravar a tarefa, se `outcome ∈ { churned, possible_churn }`, chamar `setClubStatus(tenant, mapped, currentStatus, note, "cs", competitor?)`. Isto reaproveita a lógica já existente, que:
   - grava em `cs_tenant_status` + `club_status_log`
   - cancela automaticamente as restantes tarefas pendentes desse clube (`cancelPendingTasksForTenant`).

   No caso do `churned` a UI de completar tarefa (`TaskQuickActions`) passa a pedir também o competidor (dropdown com `COMPETITOR_OPTIONS`), à semelhança do `InlineStatusEditor` e do side panel que já foi acrescentado.

3. **Micro-aviso preventivo** no `NewTaskDialog` / `TaskQuickActions` quando a nota contém a palavra "churn" mas o outcome escolhido não é um dos dois novos — um hint discreto do estilo "Queres marcar este clube como churn?" com um botão que já muda o outcome. Sem bloquear.

## Fora do âmbito

- Sem migração de dados históricos (nem retroagir status dos registos antigos do JustPadel Barcelos — o utilizador já o marcou hoje).
- Sem alteração ao gerador de tarefas nem à regra de exclusão — já estão corretos.
- Sem alteração à base de dados / policies / tipos.

## Verificação

`bunx tsgo --noEmit`. Testar manualmente: completar tarefa com outcome "Confirmado churn" → clube deve aparecer como "Em churn" na lista de clubes e as pendentes desse clube devem ficar "Anuladas — não está ativo".
