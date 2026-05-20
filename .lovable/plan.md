# Plano

## 1. Export Excel — Product Feedback

Adicionar opção "Excel (.xlsx)" no dropdown de export, em paralelo com os dois CSV existentes (detalhado e agregado).

- Instalar `xlsx` (SheetJS) via `bun add xlsx`.
- Em `src/lib/feedback.ts`, criar `exportFeedbackDetailedXLSX(items)` e `exportFeedbackAggregatedXLSX(groups)` — gera um workbook com 1 sheet ("Detalhado" ou "Agregado") usando as mesmas colunas dos CSV.
- Em `src/routes/cs.feedback.tsx`, expandir o menu "Exportar" para 4 entradas: CSV detalhado, CSV agregado, Excel detalhado, Excel agregado.

## 2. Novo menu "Calendário"

Página unificada que mostra todas as tarefas planeadas (`cs_tasks` pendentes — incluindo as "futuras") com vistas dia / semana / mês, e permite acionar cada tarefa reutilizando os fluxos atuais.

**Sidebar**
- Em `src/components/Sidebar.tsx`, adicionar item no topo (1ª posição) `{ to: "/calendar", label: "Calendário", icon: CalendarDays }`, visível a todos os utilizadores autenticados (CS, superuser e viewer — sem flag `superuserOnly`).

**Rota nova `src/routes/calendar.tsx`**
- Fonte de dados: `cs_tasks` com `status = 'pending'`, agrupadas pelo campo existente `week_start` (já é usado como data planeada das tarefas, incluindo as criadas via "Tarefa futura").
- Vistas:
  - **Mês** (default): grelha 7 colunas × ~6 linhas estilo Google Calendar; cada célula lista até N tarefas + "mais X" se overflow.
  - **Semana**: 7 colunas, lista de tarefas por dia, agrupadas por clube.
  - **Dia**: lista vertical ordenada por prioridade.
- Header com: botões de vista (Dia/Semana/Mês), navegação ‹ Hoje ›, e filtros leves (clube, prioridade).
- Cada item mostra: clube (ClubLink), motivo curto, badge de prioridade, indicador de overdue (se `week_start < hoje`).
- **Ações** ao clicar numa tarefa: abrir um popover/sheet que reusa `TaskQuickActions` (mesmos outcomes — Resolvido / Insatisfeito / Reagendar / Anular / Nota) para manter consistência com `/cs/tasks`. Sem novos endpoints — usa as funções já existentes em `src/lib/cs.ts`.
- Suporte a navegação por teclado (← →) e link rápido para `/cs/tasks` e perfil do clube.

## 3. "Mudança de dono" tratado como inativo arquivado

Hoje o código já considera `changed_owner` como não-ativo para efeitos de `isActiveStatus` (cancela tarefas pendentes, conta como inativo no score). Falta:

a) **Excluir do modal "Clubes não encontrados no último carregamento"** em `src/routes/clubs.tsx`:
   - Linhas 187 e 477 filtram por `status !== "churned" && status !== "closed"`. Adicionar `&& status !== "changed_owner"` em ambas.

b) **Arquivar visualmente na lista principal de Clubes**:
   - Por defeito, ocultar clubes com `status === "changed_owner"` da listagem (tal como já acontece com churned/closed se for esse o caso — confirmar comportamento atual na vista). Adicionar toggle "Mostrar arquivados" no header da tabela para os reexibir quando necessário.
   - Manter o badge "Mudança de dono" com estilo de arquivado (cinza/muted) quando visíveis.

c) **Visão geral (`src/routes/index.tsx`)**:
   - Confirmar que `changed_owner` NÃO conta como churn no card "Churned este ano" (já é o caso pela lógica `isActiveStatus` que separa churn de arquivado). Garantir tooltip do card de clubes ativos menciona que arquivados (incluindo mudança de dono) não entram no total.

Nenhuma alteração de schema é necessária — `changed_owner` já existe como valor de `club_status`.

## Ficheiros tocados
- `src/lib/feedback.ts` (+ XLSX helpers)
- `src/routes/cs.feedback.tsx` (menu export alargado)
- `src/components/Sidebar.tsx` (item Calendário)
- `src/routes/calendar.tsx` (novo)
- `src/routes/clubs.tsx` (filtros `changed_owner` + toggle arquivados)
- `src/routes/index.tsx` (tooltip)
- `package.json` (dep `xlsx`)

## Fora de scope
- Sem novas tabelas, migrações ou RLS.
- Calendário só mostra tarefas internas (cs_tasks); não integra Google Calendar externo.
