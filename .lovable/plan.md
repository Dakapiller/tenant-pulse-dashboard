## Objetivo

1. Corrigir o KPI **Clubes ativos** (e por arrasto **Churned este ano**) para refletir o que aparece no último upload mensal, contando como churn os clubes que deixaram de aparecer.
2. Adicionar tooltips informativas no ícone (canto superior direito) de cada um dos 5 KPIs.

---

## 1. Lógica de "ativo" / "churn implícito"

### Regra atual (errada)
`activeClubs` em `src/routes/index.tsx` percorre todos os tenants alguma vez vistos e conta como ativo se `currentStatusByTenant` ≠ churned/closed/changed_owner. Não exige presença no último upload — clubes que pararam de submeter dados continuam a contar como ativos.

### Nova regra
Um clube conta como **ativo** se cumpre AMBOS:
- Apareceu no snapshot do **último período carregado** (`latestPeriod` da BD, não o `selectedPeriod`).
- O `currentStatusByTenant` não é `churned`, `closed`, nem `changed_owner`.

Um clube conta como **churn** (para o KPI "Churned este ano") se:
- Tem status atual `churned` **OU `closed`** registado em `cs_tenant_status` no ano corrente, **OU**
- Não aparece no último período carregado mas apareceu em algum período anterior — churn implícito, com data = **primeiro mês em que deixou de aparecer** (primeira ausência consecutiva até hoje). Se essa data cair no ano corrente, conta.

`changed_owner` não conta como churn (continua excluído de ativos mas não é churn).

### Implementação
Em `src/routes/index.tsx`, dentro do `useMemo` dos `kpis`:

- Construir `latestUploadPeriod = periods[0]` (o período mais recente da BD, independente do filtro).
- Construir `tenantsInLatestUpload: Set<string>` a partir de `snapshots.filter(s => s.period === latestUploadPeriod)`.
- `activeClubs` = nº de tenants em `tenantsInLatestUpload` cujo status atual passa em `isActiveStatus(...)`.
- `churnedThisYear`:
  - Tenants com status `churned` ou `closed` cuja `recorded_at` está no ano atual (já existe, alargar para incluir `closed`).
  - **Mais** os tenants ausentes do último upload, cuja primeira ausência (ver helper abaixo) caia no ano atual e que não estejam já contados acima.
- Helper `firstMissingPeriod(tenant, periods, tenantHistory)`: percorre `periods` (descendentes) e devolve o período mais antigo em que o tenant esteve ausente de forma contínua até `latestUploadPeriod`. Equivalente: a partir do último período presente do tenant (`lastPresent`), o "primeiro mês em falta" é o período imediatamente seguinte a `lastPresent` em `periods`. Se `lastPresent === latestUploadPeriod`, não há ausência.

Esta nota informativa já presente abaixo dos KPIs (`Clubes ativos = clubes cujo estado atual…`) deve ser reescrita para refletir a nova regra.

### Notas
- Não mexer no resto da página (gráficos, distribuição por estado, evolução positiva continuam a usar `clubs` filtrado por `selectedPeriod`).
- Não criar migrações — é tudo derivação no cliente.

---

## 2. Tooltips nos KPIs

Adicionar `Tooltip` (já existe em `src/components/ui/tooltip.tsx`, baseado em Radix) ao ícone do canto superior direito de cada `KpiCard`.

### Mudanças
- Estender `KpiCard` em `src/routes/index.tsx` com prop `tooltip?: string`.
- Quando presente, embrulhar o `<span>` do ícone num `Tooltip` + `TooltipTrigger asChild` + `TooltipContent` com o texto. Garantir `TooltipProvider` no root (verificar se já está em `__root.tsx`; se não, adicionar à página).
- Cursor `help` no ícone.

### Conteúdos (pt-PT, curtos, 1–2 linhas)
- **Clubes ativos** — "Clubes presentes no último upload mensal cujo estado atual não é churn, fechado nem mudança de dono."
- **Churned este ano** — "Clubes marcados como churn ou fechados este ano, mais clubes que deixaram de aparecer no upload (churn implícito a partir do primeiro mês ausente)."
- **Em risco alto** — "Clubes com health score abaixo de 30 no período selecionado."
- **GMV mês** — "Soma do GMV de todos os clubes ativos no período selecionado."
- **Receita mês** — "Soma da receita de todos os clubes ativos no período selecionado."

---

## Detalhes técnicos

- Ficheiros tocados: `src/routes/index.tsx` apenas (mais possível adição de `TooltipProvider` em `src/routes/__root.tsx` se ainda não estiver montado globalmente — confirmar antes).
- Sem alterações de schema, sem migrações, sem mudanças em `src/lib/health.ts` ou `src/lib/cs.ts`.
- A nota textual abaixo dos KPIs (linha 464–466) deve ser atualizada ou removida, já que os tooltips passam a transportar essa informação.
