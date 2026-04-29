## O que vai mudar

Três alterações ligadas que mexem em `/at-risk`, `/clubs`, `/cs/tasks`, no drawer do clube e no schema do `health_score_log`. Tudo continua sincronizado: o que se cria/edita num sítio aparece imediatamente nos outros (mesma tabela `cs_tasks` e mesmo `health_score`).

---

### 1. Rever a página "Em risco" + limite de 20 cards

A página hoje:
- Mostra clubes com `health_score < 30`, ordenados por score ascendente.
- Sem limite — neste momento são 58 cards, o que torna a página pesada e dilui a prioridade.
- Filtra inactivos (churned/closed/changed_owner) — bem.
- Tem pesquisa por nome, sparkline de jogos online, flags informativas, tarefas pendentes, sugestões.

O que vou rever / corrigir:

- **Limite duro de 20 cards** ordenados pelos mais críticos (score ascendente, depois nº de flags descendente como desempate).
- **Header informativo**: "A mostrar os 20 clubes mais críticos de N em risco" quando há mais de 20. Quando ≤20, sem aviso.
- **Botão "Ver todos os N em risco"** (quando truncado) que abre `/clubs` já filtrado por `level=risk`. Isto requer que `/clubs` aceite o param `level` no URL e aplique o filtro de health automaticamente — adiciono.
- **Subtítulo clarificado**: explicar que estes são os 20 prioritários e que o resto fica visível em `/clubs`.
- **Pesquisa**: continua a funcionar dentro dos 20. Se houver 58 e o utilizador procurar um clube fora do top-20, o estado vazio sugere "Procurar em todos os clubes" → link para `/clubs?q=...`.
- **Mobile**: confirmar que os cards já empilham bem (grid `grid-cols-1 md:grid-cols-2 xl:grid-cols-3` está OK), só ajustar o header em duas linhas no mobile.

---

### 2. Criar tarefas manualmente (ligado em `/clubs`, `/cs/tasks` e `/at-risk`)

Hoje as tarefas só aparecem geradas automaticamente pelo upload (Rule 2) ou pelo cron semanal. Não há forma de adicionar uma tarefa ad-hoc.

O que vou adicionar:

- **Botão "Nova tarefa"** em três sítios, todos a abrir o **mesmo dialog** (componente `NewTaskDialog`):
  1. `/cs/tasks` — botão no header da página, sem clube pré-selecionado (utilizador escolhe).
  2. `/at-risk` — botão "+ Tarefa" em cada card, com clube pré-preenchido.
  3. `/clubs` — drawer do clube, secção "Tarefas", botão "+ Nova tarefa" com clube pré-preenchido.
- **Campos do dialog**:
  - Clube (Combobox pesquisável; pré-preenchido quando aplicável; só permite clubes activos).
  - Razão (textarea, obrigatório, max 500 chars).
  - CTA (texto curto, obrigatório, max 200 chars — ex.: "Ligar ao gestor", "Enviar email a confirmar...").
  - Prioridade (Select: Baixa=30 / Média=60 / Alta=90).
  - Semana (Select: "Esta semana" / "Próxima semana"; default = esta).
- **Persistência**: insere em `cs_tasks` com `status='pending'`, `flags=['manual']` para distinguir das geradas automaticamente.
- **Ligação visível em todo o lado**: como já partilham a mesma tabela, a tarefa nova aparece imediatamente em `/cs/tasks` (semana correspondente), no drawer do clube em `/clubs`, e no contador "X tarefas pendentes" do card em `/at-risk`. Sem código extra de sincronização — basta refrescar os queries existentes após criar.
- **Badge "Manual"** discreto na lista de tarefas para distinguir de tarefas geradas automaticamente.

---

### 3. Ajustar manualmente o health_score (com comentário obrigatório)

Hoje o score só muda por: Rule 1 (novo clube), Rule 2 (upload) ou Rule 3 (outcome de tarefa). Pediste uma quarta via — manual. Vou adicioná-la sem quebrar as restantes regras nem a auditoria.

#### Schema — pequena alteração no `health_score_log`

Adicionar dois valores novos ao campo de texto `source` (já é texto livre, sem enum, então não precisa de migração de tipo): `'manual'` e `'manual_bulk'`. Adicionar coluna nullable `changed_by text` para registar "cs" / "admin" (no futuro pode ser `auth.uid()`). **Migração mínima**: `ALTER TABLE health_score_log ADD COLUMN changed_by text;`.

#### Helper novo em `src/lib/health.ts`

```text
applyManualScoreChange(tenant, newScore, comment, source='manual')
  - lê score atual
  - clamp [0,100]
  - escreve health_score_log com reason="Ajuste manual: <comment>", source='manual'
  - atualiza cs_tenant_status.health_score
  - IMPORTANTE: ignora o floor dinâmico (manual override deliberado, mesmo se baixar
    abaixo do floor de outcome positivo recente)
```

#### UI — dois pontos de entrada

1. **Single, no drawer do clube em `/clubs`**:
   - Secção "Health score" passa a ter um botão "Ajustar manualmente".
   - Abre dialog com: input numérico 0–100, comentário (obrigatório, min 5 chars, max 300), preview do delta.
   - Após guardar, o histórico do clube (já existente) mostra a entrada nova com o comentário visível.

2. **Bulk, em `/clubs`**:
   - O bulk action bar (que já existe para mudar status) ganha uma nova ação: **"Ajustar score"**.
   - Abre dialog com: tipo de ajuste (Definir valor absoluto / Somar delta), valor, comentário obrigatório (aplicado a todos), preview "X clubes serão alterados".
   - Loop sequencial sobre os tenants selecionados (chama `applyManualScoreChange` com `source='manual_bulk'` e o mesmo comentário). Mostra progresso e resumo final ("12 ajustados, 0 erros").

#### Auditoria
- Toda alteração manual fica em `health_score_log` com `source` `'manual'`/`'manual_bulk'` → distinguível das automáticas no histórico do clube e do log global. O comentário do utilizador entra no campo `reason` (já visível no UI existente).

---

## Detalhes técnicos

**Ficheiros a editar:**
- `src/routes/at-risk.tsx` — slice top-20, banner "X de N", botão "ver todos", estado vazio refinado.
- `src/routes/clubs.tsx` — aceitar `?level=risk` e auto-aplicar filtro health<30; drawer ganha "Ajustar score" + "Nova tarefa"; bulk bar ganha "Ajustar score".
- `src/routes/cs.tasks.tsx` — botão "Nova tarefa" no header.
- `src/lib/health.ts` — nova função `applyManualScoreChange(tenant, newScore, comment, source)`.
- `src/lib/cs.ts` — nova função `insertManualCSTask({tenant, reason, cta, priority, weekStart})`.

**Ficheiros novos:**
- `src/components/NewTaskDialog.tsx` — dialog partilhado pelas 3 entradas.
- `src/components/AdjustScoreDialog.tsx` — dialog para single + bulk (modo controlado por prop).

**Migração SQL (apenas schema, dados ficam intactos):**
```sql
ALTER TABLE health_score_log ADD COLUMN IF NOT EXISTS changed_by text;
```
Sem alteração ao tipo da coluna `source` (é `text`, aceita `'manual'` e `'manual_bulk'` sem mais nada).

**Validação (Zod):**
- `NewTaskDialog`: `tenant` non-empty, `reason` 1–500, `cta` 1–200, `priority` ∈ {30,60,90}.
- `AdjustScoreDialog` single: `score` int 0–100, `comment` 5–300.
- `AdjustScoreDialog` bulk: mesmo, mais `mode` ∈ {`absolute`,`delta`} e `delta` int -100..100 quando `delta`.

**Mobile:**
- Ambos os dialogs usam o padrão "full-screen bottom sheet" no mobile (`fixed inset-x-0 bottom-0 rounded-t-2xl max-h-[90vh] overflow-y-auto`) consistente com o que já foi feito no drawer de `/clubs`.

**Não muda:**
- Lógica de Rule 1/2/3 (uploads e outcomes continuam a aplicar floor e a sobrepor-se a um manual antigo se um outcome novo entrar — comportamento desejado).
- Geração semanal de tarefas (cron continua igual; tarefas manuais coexistem).
- Definições de "ativo", health levels, RLS.
