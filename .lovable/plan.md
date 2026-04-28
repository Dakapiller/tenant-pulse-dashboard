## Objetivo

Hoje o sistema cria **uma linha em `cs_tasks` por flag** (ex. Sportgreen tem 2 flags = 2 tasks). Vais ver:
- 2 bullets na expansão do clube
- 2 selects de "Resultado"
- 2 botões "Marcar feita"

Tu queres **1 task por clube** com vários bullets dentro, **1 resultado**, **1 comentário**, **1 botão**. Na realidade é um único contacto.

## Mudanças

### 1. Schema (`cs_tasks`)
Já existe a coluna `flags text[]`. Vamos passar a guardar **todos os flags do clube no mesmo row**, em vez de um row por flag.

- Migration: nada a alterar na estrutura — só remover o índice único antigo `cs_tasks_pending_unique` (que assumia 1 flag por row) e criar `cs_tasks_pending_unique_tenant_week` em `(tenant_name, week_start) WHERE status = 'pending'`. Garante 1 task pendente por clube por semana.
- Data migration: para a semana atual, fundir os rows pendentes do mesmo clube num só (agregar `flags`, concatenar `reason` e `cta` por linha), apagar os duplicados.

### 2. Geração semanal (`generateWeeklyTasks` em `src/routes/cs.tsx`)
- Em vez de fazer um push por cada flag, criar **um único objeto por clube** com:
  - `flags`: array com todos os flags
  - `reason`: linhas concatenadas (uma por flag)
  - `cta`: linhas concatenadas (uma por flag)
  - `priority`: o score
- Usar upsert por `(tenant_name, week_start)` para evitar duplicar se rodar duas vezes.

### 3. UI da expansão (`ExpandedClubPanel` em `src/routes/cs.tsx`)
A linha do clube continua igual. Dentro do painel expandido:

```text
[Clube: Sportgreen Gulpilhares]                     [▼]
└─ • Sem receita — GMV is present but revenue is zero
   • Jogos a cair — Games online dropped 2+ months
   
   Resultado: [Boa recetividade ▼]
   Comentário: [_______________________________]
   
                                  [Marcar como feita]
```

- Remover os checkboxes por bullet, o select por bullet, o botão por bullet, o "Selecionar todas".
- Os bullets passam a ser **só leitura** (lista visual dos flags ativos).
- Um único `<select>` de Resultado, um único `<textarea>` de Comentário, um único botão "Marcar como feita".
- Ao clicar, faz `completeCSTask(taskId, tenant, outcome, note)` para o ÚNICO row do clube.

### 4. Bulk completion (vários clubes selecionados)
Mantém-se: a bottom bar continua a aplicar o mesmo outcome+nota a todos os clubes selecionados, mas agora marca **1 task por clube** em vez de N.

### 5. Histórico
- A vista de histórico (`tab === "history"`) e o `ClubHistoryPanel` em `clubs.tsx` já funcionam com a estrutura `flags: string[]`. Só preciso garantir que a label mostra **todos** os flags da task (não só `flags[0]`), por exemplo "Sem receita + Jogos a cair".
- O comentário já é guardado em `note` e renderizado em ambas as views.

## Detalhe técnico

**Ficheiros tocados:**
- Migration nova: drop `cs_tasks_pending_unique`, create `cs_tasks_pending_unique_tenant_week`.
- Data fix (insert tool): merge dos rows pendentes existentes da semana 2026-04-27 num único row por clube.
- `src/routes/cs.tsx`:
  - `generateWeeklyTasks`: 1 task por clube com `flags = risk.flags` e `reason`/`cta` multilinha.
  - `ExpandedClubPanel`: simplificar — bullets read-only, 1 outcome, 1 nota, 1 botão.
  - Remover `completeCSTasksBatch` daqui (deixa de ser preciso por clube — só 1 task).
  - Histórico: helper `formatFlagsLabel(flags)` para mostrar todos.
- `src/routes/clubs.tsx` (`ClubHistoryPanel`): mesmo helper para mostrar todos os flags.
- `src/lib/cs.ts`: nada a mudar nas signatures (`completeCSTask` continua igual).

**Comportamento após o fix para Sportgreen Gulpilhares:**
- 1 linha na lista
- Expandido: 2 bullets (Sem receita, Jogos a cair) + 1 resultado + 1 nota + 1 botão
- Marcar feita → 1 entrada no histórico com `flags: ['no_revenue','games_dropping']` e a tua nota
