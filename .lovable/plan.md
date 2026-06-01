Nenhuma alteração necessária — esta reorganização já foi aplicada numa iteração anterior.

O `ClubDrawer` em `src/routes/clubs.tsx` (linhas 810–940) já contém exclusivamente:

- Cabeçalho com nome, `ClubStatusBadge` e contador de tarefas pendentes
- Secção "Score de saúde" com score, `HealthBadge` e indicador de última actividade CS (tempo relativo)
- `<YoYSection history={row.history} />` (4 métricas YoY do mês actual)
- Secção "Tarefas pendentes" com `TaskQuickActions` por tarefa
- Rodapé com os três botões: **+ Tarefa**, **Score**, **Abrir página completa**

Não há tabela de comparação mensal, secção de histórico de risco, lista completa de histórico CS, nem histórico de estados do ciclo dentro do `ClubDrawer` — esses componentes vivem apenas em `src/routes/tenant.$name.tsx` (página completa), que permanece intacta.

### Acção
Confirmar com o utilizador que está a ver o cartão actualizado (pode precisar de hard refresh) e, se ainda vir conteúdo a mais, indicar exactamente qual a secção, porque o ficheiro actual já reflete o estado pedido.