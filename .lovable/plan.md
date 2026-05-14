## Causa dos erros

Os 270 erros `permission denied for function has_role` não vêm de sessão expirada nem de RLS mal escrita — vêm da própria função `public.has_role`. Foi criada como `SECURITY DEFINER` mas o ACL atual (verificado na BD) só permite execução a `postgres`, `service_role` e `sandbox_exec`. O role `authenticated` (com que a app fala) não pode executá-la, pelo que qualquer política RLS que a invoque rejeita a operação antes de a avaliar. Isto bloqueia todos os inserts em `tenant_snapshots` e operações similares feitas pela UI.

## Passos

### 1. Migração — GRANT EXECUTE
```sql
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, text)            TO authenticated, anon;
```
Reversível, não toca em dados nem em políticas.

### 2. Re-carregar `Tenant_Drilldown.xlsx` para Abril/2026
Esperado depois da migração:
- 270 snapshots inseridos em `tenant_snapshots` (período `2026-04-01`)
- ~209 clubes novos → Regra 1 aplica score 100 e regista em `health_score_log`
- ~15 clubes em falta → marcados como `possible_churn` (lógica de churn existente, preservada)
- Restantes → Regra 2 vs snapshot de Março: variações >10% em GMV/Jogos/Receita disparam ±10 e criam tarefa pendente para a semana corrente (ou fazem merge se já houver tarefa para o clube nessa semana)

Histórico anterior intacto: continua tudo via `upsert` por `(tenant_name, period)` em snapshots e `update` na linha mais recente de `cs_tenant_status`. Registos manuais e os 11 `possible_churn` de 27/04 ficam como estão.

### 3. Backfill opcional
Pergunta para confirmares com **sim** ou **não** ao aprovar:
- **Sim** → corro um script único que aplica Regras 1 e 2 a todos os períodos existentes (Jan 2025 → Mar 2026) por ordem cronológica, escrevendo entradas em `health_score_log` com `changed_at` igual ao período (não `now()`), sem criar tarefas retroativas.
- **Não** → scoring começa "limpo" a partir de Abril 2026; histórico fica como está.

## Notas técnicas
- A lógica de scoring no upload já está implementada em `src/routes/upload.tsx` desde a iteração anterior — não é preciso mexer.
- O tratamento de erro `42501` adicionado fica como salvaguarda mas deixa de ser acionado no fluxo normal.
- Confirmação do problema: `SELECT proacl FROM pg_proc WHERE proname='has_role'` devolveu apenas `postgres`, `service_role`, `sandbox_exec` — sem `authenticated`.
