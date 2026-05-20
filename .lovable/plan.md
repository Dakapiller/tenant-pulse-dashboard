## Diagnóstico

Hoje é 2026-05-20. A semana corrente arranca a 2026-05-18.

Estado atual em `cs_tasks` (status `pending`):

| Semana | Pendentes | Clubes distintos |
|---|---|---|
| 2026-05-11 (semana passada) | **182** | 182 |
| 2026-05-18 (semana corrente) | 82 | 82 |

Cada clube tem no máximo uma tarefa por semana. O que se passou: o gerador semanal cria uma nova tarefa "Acompanhamento semanal automático" todas as semanas, mas **não cancela** as tarefas pendentes da semana anterior. Resultado: as 182 da semana 05-11 ficaram "atrasadas" no calendário, e 72 desses clubes têm também a tarefa nova de 05-18 a coexistir.

Não há tarefas órfãs/duplicadas dentro da mesma semana — a regra "1 tarefa por clube" mantém-se *por semana*; o problema é acumulação entre semanas.

## Plano

**1. Limpar as pendentes atrasadas (única ação pedida)**

Marcar como `cancelled` todas as `cs_tasks` com:
- `status = 'pending'`
- `week_start = '2026-05-11'`

Total: 182 linhas. Não toco nas 82 da semana corrente (05-18) nem nas `completed`/`cancelled` existentes. Sem impacto no health score (cancelamento não pontua).

Execução via `supabase--insert` (UPDATE).

**2. Validação**

Após o update, confirmar via `read_query` que a semana 05-11 já não tem `pending` e que o calendário deixa de mostrar os 182 atrasados.

## Fora deste plano (a confirmar contigo)

A causa-raiz é o gerador semanal não fechar as pendentes anteriores. Se quiseres, num passo seguinte posso:
- Ajustar a lógica de geração semanal para que, ao criar a tarefa da nova semana, marque automaticamente como `cancelled` qualquer `pending` anterior do mesmo clube (com nota "anulada por nova semana"), evitando que isto se repita.

Diz-me se queres incluir já esse fix ou se preferes só a limpeza agora.