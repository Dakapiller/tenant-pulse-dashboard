## 1. Novo estado "Anulada" para tarefas

Tornar `cancelled` um estado de primeira classe, ao lado de `pending` e `completed`.

**Backend / dados**
- A coluna `status` em `cs_tasks` já aceita texto livre — sem migração de schema. Reutilizamos o valor `cancelled` já presente para a regra "clube inativo".
- Novo outcome `cancelled_manual` para anulações feitas pelo CS (nota obrigatória).

**`src/lib/cs.ts`**
- Helpers novos: `cancelCSTask(id, note)`, `cancelCSTasksBatch(ids, note)`.
- **Validação backend** (sugestão #4): `cancelCSTasksBatch` valida `note.trim().length` entre 1 e 200 chars antes de executar o `UPDATE`; lança erro explícito se falhar — protege chamadas diretas que contornem o frontend.
- `outcomeLabel()` passa a mapear `cancelled_manual → "Anulada"` e `cancelled_cleanup → "Anulada (limpeza)"` (`cancelled_inactive` já mapeado).
- Novo `taskStatusLabel(t)` que devolve `"Pendente" | "Concluída" | "Anulada"` a partir de `t.status`.
- **Precedência documentada** (sugestão #2): adicionar JSDoc nas duas funções deixando claro que **`taskStatusLabel` é usado para o badge de estado** e **`outcomeLabel` apenas no tooltip / linha de detalhe**. Nunca misturar os dois no mesmo elemento visual.

**UI a propagar**
- `src/routes/cs.history.tsx`: incluir anuladas. Novo filtro de estado (Concluídas | Anuladas | Todas), badge cinza para anuladas, tooltip com `outcomeLabel`+nota. Substituir `fetchCompletedCSTasksPage` por `fetchTasksByStatusesPage(['completed','cancelled'], …)`.
- `src/routes/tenant.$name.tsx`: secção "Pendentes" só `status='pending'`; histórico inclui anuladas.
- `src/routes/calendar.tsx`: filtrar por `status='pending'` (tarefas anuladas não aparecem).
- `src/routes/index.tsx`, `src/routes/clubs.tsx`: confirmar que contagens de pendentes ignoram canceladas.

## 2. Limpeza de pendentes antigas (< 2026-05-06)

`UPDATE` one-shot via `supabase--insert`. **Sem preencher `completed_at`** (sugestão #1) — anulações por limpeza não devem distorcer métricas de histórico (ex.: "Total ações no período"):

```sql
UPDATE public.cs_tasks
   SET status = 'cancelled',
       outcome = 'cancelled_cleanup',
       note = 'Limpeza geral — tarefa antiga nunca executada'
 WHERE status = 'pending'
   AND created_at < '2026-05-06';
```

Implicações:
- `cs.history.tsx` ordena/agrupa por `completed_at`. Adaptar para anuladas: usar `coalesce(completed_at, created_at)` como timestamp de display.
- Sumário "Total ações" no histórico passa a contar apenas `status='completed'` por defeito; anuladas têm contador separado no card.

## 3. Limite semanal de 10 tarefas automáticas

Em `generateWeeklyTasks` (`src/routes/cs.tasks.tsx`):
- Cap global de **10 candidatos/semana** (vs cap atual só no bucket `stale`).
- **Deduplicação por `tenant_name` antes do slice** (sugestão #3) — o mesmo clube pode preencher `low_score` + `priority`; deve consumir **uma única vaga**, mantendo o bucket de maior prioridade.

```text
allCandidates = [...lowScore, ...priorityOnly, ...stale]
deduped       = uniqueByTenantName(allCandidates)   // mantém 1ª ocorrência (bucket mais alto)
sorted        = deduped.sort(by bucketOrder asc, then by score asc)
insert sorted.slice(0, 10)
```

- Ordem de bucket: `low_score (0)` → `priority (1)` → `stale_contact (2)`.
- Atualizar o comentário do header da função.

## 4. Otimizar gestão em bulk de pendentes

Em `src/routes/cs.tasks.tsx`, refactor da secção "Tarefas pendentes":

**Granularidade**
- Mudar seleção de **clube → tarefa individual**. `selectedKeys: Set<string>` passa a guardar `task.id`.
- Permite anular/concluir só algumas tarefas de um clube.

**UI**
- Aumentar `pageSize` 50 → 100 + "Selecionar tudo na página".
- Nova **`BulkActionBar`** fixa em baixo com 3 ações:
  - **Concluir** (existente)
  - **Anular** — input obrigatório (motivo, 1–200 chars). Chama `cancelCSTasksBatch`.
  - **Adiar** — bulk postpone.
- Contadores no topo: "X pendentes desta semana · Y atrasadas · Z clubes".
- Coluna "Idade" (dias desde `created_at`) com ordenação.
- Filtros chip: "Esta semana" / "Atrasadas" / "Manuais" / "Automáticas".

**Código**
- Extrair `PendingTasksSection` para sub-componente (ficheiro está grande).
- `BulkCompleteBar` → `BulkActionBar` com 3 modos (complete/cancel/postpone).

## Ficheiros a alterar

- `src/lib/cs.ts` — helpers de cancelamento (com validação backend), `taskStatusLabel`, JSDoc de precedência, `fetchTasksByStatusesPage`.
- `src/routes/cs.tasks.tsx` — gerador semanal (cap 10 + dedup), nova UX bulk, seleção por tarefa.
- `src/routes/cs.history.tsx` — incluir anuladas, filtro de estado, badge, ordenação por `coalesce(completed_at, created_at)`.
- `src/routes/tenant.$name.tsx` — histórico inclui anuladas.
- `src/routes/calendar.tsx` — garantir filtro `status='pending'`.

## Migração de dados

Único `UPDATE` em `cs_tasks` (ponto 2), sem `completed_at`. Sem alterações de schema, sem RLS novas.

## Fora de scope

- Sem mudanças à pontuação de saúde nem à geração automática para além do cap+dedup.
- Sem migração de schema.
