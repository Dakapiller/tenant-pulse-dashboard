## Causa do "209 novos clubes"

Após verificar nomes do ficheiro vs BD (com `trim`), só **5 clubes** são realmente novos em Abril; 265 já existiam em Março. O número inflado da UI vem de dois bugs:

**Bug 1 — limite de 1000 linhas na deteção de churn.** `src/routes/upload.tsx` faz `supabase.from("tenant_snapshots").select("tenant_name, period").neq("period", periodIso)` sem paginar. ~290 clubes × 16 meses ≈ 4600 linhas, mas o Supabase devolve no máx. 1000, pelo que muitos meses ficam de fora e clubes existentes aparecem como "novos".

**Bug 2 (mais perigoso) — Rule 1 dispara para qualquer clube sem score logado.** `computeUploadDelta` em `src/lib/health.ts` considera "novo clube" sempre que `prevScore === null`. Como o scoring nunca foi invocado em uploads anteriores, praticamente nenhum clube tem entrada em `health_score_log` — pelo que ~265 clubes existentes seriam marcados como novos e receberiam score 100, apagando o `health_score` atual em `cs_tenant_status` e ignorando Rule 2.

## Passos

### 1. `src/lib/health.ts`
- Adicionar parâmetro `hasPrevSnapshot: boolean` a `computeUploadDelta`.
- "Novo clube" passa a ser `!hasPrevSnapshot` (e não `prevScore === null`).
- Quando `hasPrevSnapshot && prevScore === null`, usar baseline 100 silenciosamente e correr Rule 2 contra o snapshot anterior.
- `applyUploadScoreChanges` passa `prevSnap !== null` ao invocar.

### 2. `src/routes/upload.tsx`
- Substituir a query única de `priorRows` por `fetchAllPaged` (já importado no ficheiro), iterando todos os snapshots com `period != periodIso`.
- Selecionar só `tenant_name` (não precisamos de `period` para o cálculo de novos/missing).

### 3. Re-carregar Abril 2026
Esperado:
- 270 inserts
- 5 novos clubes → Rule 1 (score 100)
- 16 missing (281 − 265) → `possible_churn`
- 265 restantes → Rule 2 vs Março, com tarefas onde aplicável

## Notas
- Sem migrações; só código.
- Os 11 nomes com whitespace no ficheiro continuam normalizados pelo trim implícito do XLSX e pelo armazenamento atual; vou também garantir `String(...).trim()` no parse para evitar drift futuro.
- Não toco em registos manuais nem em snapshots históricos.
