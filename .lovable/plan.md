## Diagnóstico

Investiguei o que aconteceu com o upload de Abril e encontrei **dois problemas independentes**:

### 1. As regras de scoring NUNCA foram aplicadas em nenhum upload

O ficheiro `src/lib/health.ts` define `applyUploadScoreChanges()` (Regra 1: novo clube → 100; Regra 2: queda/subida >10% em GMV/Jogos/Receita → ±10), mas **`src/routes/upload.tsx` nunca chama esta função**. O upload faz apenas:

- Upsert em `tenant_snapshots`
- Deteção de "novos clubes" e "clubes em falta" (churn)

Resultado: **nenhum upload (de Janeiro 2025 até Março 2026) atualizou o `health_score`** segundo as regras. As regras existem na codebase mas nunca foram invocadas.

### 2. O upload de Abril 2026 NÃO chegou à base de dados

A BD tem snapshots até **2026-03-01 (281 clubes)**. Não existe nenhuma linha para `period = 2026-04-01`. O ficheiro que carregaste agora tem 270 linhas e os cabeçalhos batem certo com o `COLUMN_MAP` (a coluna nova "B2C Refunds Commissions" é simplesmente ignorada, sem causar erro). Os últimos uploads bem-sucedidos foram em **2026-04-26/27**, todos para meses anteriores.

A causa mais provável dos erros que viste: o upload é feito com a sessão do browser e a política RLS exige `superuser`. Se a sessão expirou ou o token não foi anexado, o upsert dá `new row violates row-level security policy` para cada chunk, **e a UI mostra "0 tenants registados" + lista de erros**, sem persistir nada. Sem o detalhe exato dos erros não consigo confirmar a 100%, mas o sintoma (zero linhas em Abril, erros em série) encaixa.

---

## Plano de correção (uma só vez)

### A. Ligar as regras de scoring ao upload (`src/routes/upload.tsx`)

Depois do upsert dos snapshots e antes do return, chamar `applyUploadScoreChanges()` com:

- `uploadedPeriod` = período carregado
- `weekStart` = segunda-feira da semana atual (já calculada noutro lado; reutilizar `cs.ts`)
- `current` = snapshots recém-inseridos (`records`)
- `previousByTenant` = um snapshot por clube do período imediatamente anterior (uma query a `tenant_snapshots` com `period < uploadedPeriod` ordenado desc, primeira ocorrência por tenant)
- `currentScores` = resultado de `fetchHealthScores()`

Mostrar no resumo do upload (já há um bloco com novos/missing) três contadores extra:

- N novos clubes → score 100 atribuído
- N clubes com queda >10% → −10 + tarefa criada
- N clubes com subida >10% → +10 + tarefa criada

**Garantias:**
- Não apaga nenhum snapshot anterior (continuamos a usar `upsert` por `(tenant_name, period)`).
- Não apaga registos manuais em `cs_tenant_status` (o `persistScoreChange` faz `update` da linha mais recente ou cria nova; o histórico fica intacto).
- Re-uploads do mesmo mês são idempotentes para os snapshots, mas vão re-disparar a avaliação. Para evitar duplicar o efeito de scoring quando se re-carrega o mesmo mês, comparar primeiro se já existem entradas em `health_score_log` com `source='upload'` e `changed_at` no mês alvo — se sim, saltar Regra 2 para esse tenant (Regra 1 continua a aplicar-se a clubes verdadeiramente novos).

### B. Re-executar Abril 2026

Depois de A estar feito:

1. Carregar de novo o `Tenant_Drilldown_4.xlsx` selecionando **Abril / 2026**.
2. Se voltar a falhar com erros de RLS, abrir consola do browser e copiar o erro exato — pode ser preciso refresh ao login para renovar o token. Como salvaguarda adicional, posso melhorar o tratamento de erro no upload para mostrar uma mensagem clara ("Sessão expirada, voltar a entrar") quando o erro for `42501` / `permission denied`.
3. O upload vai:
   - Inserir os 270 clubes de Abril sem mexer no histórico
   - Marcar como "novos" os que não existiam antes (Regra 1)
   - Marcar como `possible_churn` os que existiam em Março mas faltam em Abril (lógica de churn já existente, preservada)
   - Aplicar Regra 2 aos restantes e criar tarefas pendentes para a semana corrente

### C. Backfill opcional do scoring para o histórico

As Regras 1 e 2 nunca correram desde o início. Se quiseres "alinhar" o `health_score` com o histórico real, posso correr uma única migração/script que:

- Itera por ordem cronológica todos os períodos já existentes
- Aplica `applyUploadScoreChanges` período a período
- Escreve as entradas em `health_score_log` com `changed_at` igual ao período do snapshot (não `now()`), para o histórico ficar legível
- Não cria tarefas retroativas (apenas atualiza scores)

Esta etapa é **opcional** — se preferires que o scoring comece "limpo" a partir de Abril 2026, saltamos C.

## Notas técnicas

- `applyUploadScoreChanges` já está implementado e respeita o "floor" dinâmico (`getScoreFloor`) baseado em outcomes recentes — não há risco de uma queda anular um `very_satisfied` recente.
- O upload continua client-side com a `supabase` do browser; não muda nada na arquitetura nem nas RLS.
- Os 11 clubes já marcados como `possible_churn` em 27/04 ficam intactos.