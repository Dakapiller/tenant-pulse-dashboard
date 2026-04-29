## O problema

Criaste uma tarefa manual no clube **2HaveFun – Colégio Ale…** mas:
- A coluna "Pendentes" na lista de clubes só conta tarefas com `week_start === semana atual`. Tarefas criadas para outra semana ou já atrasadas não aparecem.
- O cartão expandido (intermédio) na lista de clubes não mostra tarefas pendentes — só a Cronologia/score/histórico CS de tarefas **completadas**.
- O drawer só mostra "Histórico CS — Tarefas" filtrado por `status === "completed"`. Pendentes ficam invisíveis.
- A página completa do tenant (`/tenant/$name`) também só mostra completadas.

## "Histórico de estado" — o que faz

Mostra alterações ao **estado de ciclo de vida** do clube (Ativo → Possível churn → Em churn → Fechado, etc.), feitas manualmente na lista de clubes através do editor inline. Útil para auditoria ("quando passou a churn?", "quem reativou?"), mas o título atual é ambíguo. Vou mantê-lo e melhorar a etiqueta + texto vazio.

## Mudanças

### 1. Contagem de pending corrigida (`src/routes/clubs.tsx`)
- `ClubRow`: dividir em `pendingThisWeek`, `overdue`, `pendingTotal`.
- Coluna "Pendentes" mostra o total (badge laranja) + sub-badge vermelho com `overdue` quando >0.
- Tooltip no badge: "X desta semana, Y atrasadas".

### 2. Cartão expandido intermédio (`ClubHistoryPanel`, ~linha 670 de `clubs.tsx`)
Adicionar uma secção **no topo** do painel "Tarefas pendentes" com lista compacta (data prevista, razão, CTA, prioridade) — só renderiza se `pending > 0`.

### 3. Drawer (`ClubDrawer`, ~linha 735 de `clubs.tsx`)
- Adicionar badge "X pendentes" no cabeçalho ao lado do `ClubStatusBadge`.
- Inserir uma nova secção "Tarefas pendentes" **acima** de "Histórico CS — Tarefas". Se >0, listar com data da semana, razão, CTA e prioridade. Se 0, esconder a secção.

### 4. Página completa do tenant (`src/routes/tenant.$name.tsx`)
- Adicionar bloco "Tarefas pendentes" antes do "Histórico CS" existente.
- Mostra badge no cabeçalho com count.

### 5. "Histórico de estado" — clarificar
- Renomear secção para **"Histórico de mudanças de estado (ciclo de vida)"**.
- Texto vazio: _"Sem alterações registadas. Esta secção mostra quando o clube mudou entre Ativo, Possível churn, Em churn, etc."_

### 6. Bottom nav (`/at-risk`)
A coluna at-risk e o `/cs/tasks` já contam pending corretamente — confirmar que o filtro por week_start não esconde manuais (já vi: `cs.tasks.tsx` usa `t.week_start === weekStart`, igual ao bug em clubs.tsx). Mudar para mostrar **todas** as pending, com separação visual entre "esta semana" e "atrasadas" (já existe a tabela "Atrasadas" em cima — verificar).

## Detalhes técnicos

```text
ClubRow {
  pendingThisWeek: number   // t.status==="pending" && t.week_start===weekStart
  overdue: number           // t.status==="pending" && t.week_start < weekStart
  pendingTotal: number      // soma das duas
}
```

Render da coluna:
```tsx
r.pendingTotal > 0 ? (
  <span title={`${r.pendingThisWeek} desta semana, ${r.overdue} atrasadas`}
        className="rounded-full bg-warning/15 text-warning px-2 py-0.5 text-xs">
    {r.pendingTotal}{r.overdue > 0 && <span className="ml-1 text-danger">!</span>}
  </span>
) : <span className="text-success">✓</span>
```

Ficheiros tocados: `src/routes/clubs.tsx`, `src/routes/tenant.$name.tsx`. Sem mudanças de schema, sem migrações.
