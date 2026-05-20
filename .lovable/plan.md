## Objetivo

1. Expandir o botão "Adicionar tarefa" no club card para suportar **3 tipos**: Tarefa (atual), Tarefa Futura (com agendamento), Product Feedback.
2. Criar nova secção **Product Feedback** dentro de `/cs` (entre Tarefas e Histórico) com vista agrupada por funcionalidade e exportação CSV e Excel.

---

## 1. Tipos de tarefa no club card

O `NewTaskDialog` passa a ter um seletor inicial de tipo:

- **Tarefa (atual)** — fluxo já existente, semana = atual. Pode ser marcada como concluída imediatamente (criada só para registo histórico) através de um checkbox "Marcar como já concluída" que pede `outcome` + nota.
- **Tarefa futura** — em vez do select de semana (atual/próxima), oferece:
  - "Daqui a 1 semana", "Daqui a 1 mês", ou "Data específica" (date picker → snap para Monday via `currentWeekStart`).
- **Product Feedback** — substitui completamente o formulário pelo formulário de feedback (ver secção 2). Submete para `product_feedback` em vez de `cs_tasks`.

Layout: tabs no topo do dialog (`Tarefa | Tarefa futura | Product Feedback`), com o resto do formulário a adaptar-se.

---

## 2. Product Feedback — modelo de dados

Nova tabela `product_feedback`:


| Coluna         | Tipo                                                          | Notas                                 |
| -------------- | ------------------------------------------------------------- | ------------------------------------- |
| `id`           | uuid PK                                                       | &nbsp;                                |
| `tenant_name`  | text NOT NULL                                                 | clube que reportou                    |
| `reported_at`  | date NOT NULL DEFAULT current_date                            | data do report                        |
| `category`     | text NOT NULL                                                 | uma das categorias fixas (ver lista)  |
| `feature_name` | text NOT NULL                                                 | livre, mas dropdown sugere existentes |
| `status_tag`   | text NOT NULL CHECK IN ('good_to_have','must_have','blocker') | &nbsp;                                |
| `note`         | text NULL                                                     | comentário opcional                   |
| `created_by`   | uuid NULL                                                     | `auth.uid()`                          |
| `created_at`   | timestamptz DEFAULT now()                                     | &nbsp;                                |


**RLS**: leitura para autenticados; insert para `cs`/`superuser`; update/delete só para `superuser` (mesmo padrão de `cs_tenant_status`).

**Categorias fixas** (do screenshot enviado):
Calendário, Clientes, Recompensas e Ofertas, Pagamentos, Marcações, Jogos, Academia, Torneios, Ligas, Loja, Faturação, Relatórios.

(Confirmar comigo se queres adicionar/remover alguma antes de gerar a migration.)

**Status tags + tooltips**:

- *Good to have* — Melhoria desejável; não bloqueia operação nem decisão de churn.
- *Must have* — Funcionalidade necessária; ausência afeta operação ou satisfação significativamente.
- *Blocker* — Está a impedir o uso da plataforma ou é a razão direta apontada para churn/possível churn.

---

## 3. Formulário Product Feedback (dentro do dialog do club card)

Campos:

1. **Clube** — pré-preenchido (`tenant`), não editável.
2. **Data do report** — date input, default = hoje.
3. **Categoria** — select com as 12 categorias acima.
4. **Funcionalidade** — combobox: ao escolher categoria, faz fetch de `DISTINCT feature_name` dessa categoria ordenadas alfabeticamente; permite escrever uma nova (texto livre). Avisa "Já existe '..' — selecionar?" se houver match case-insensitive.
5. **Status** — 3 botões/radios (good_to_have / must_have / blocker), cada um com ícone `Info` + tooltip explicativa.
6. **Nota** (opcional, 0–500 chars).

Submete via novo helper `insertProductFeedback(...)` em `src/lib/feedback.ts`.

---

## 4. Nova aba `/cs/feedback`

**Sub-nav** (`CSSubNav.tsx`): adicionar item `Product Feedback` entre `Tarefas` e `Histórico` com ícone `Lightbulb` (ou `MessageSquare`).

**Página** (`src/routes/cs.feedback.tsx`):

- **Filtros no topo**: categoria (multi), status (multi), pesquisa por funcionalidade/clube, intervalo de datas.
- **Vista principal — agrupada por funcionalidade**:
  - Lista de cards, cada card = 1 funcionalidade dentro de uma categoria.
  - Cabeçalho do card: `Categoria · Nome da funcionalidade` + contador de clubes + breakdown dos status (ex.: `3 blocker · 5 must · 2 good`).
  - Corpo: tabela compacta com cada report — clube (com `ClubLink`), data, status (badge colorido), nota.
  - Ordenação default: por nº de clubes desc, depois por nº de blockers desc.
- **Export CSV** (botão no topo direito):
  - Modo 1 — *Detalhado*: uma linha por report (tenant, data, categoria, funcionalidade, status, nota).
  - Modo 2 — *Agregado por funcionalidade*: categoria, funcionalidade, nº clubes, nº blocker/must/good, lista de clubes.

---

## 5. Integração no club card existente

O botão "Adicionar tarefa" no card de cada clube passa a abrir o dialog expandido com tabs. A entrada por defeito é "Tarefa". Não é criado um botão separado — mantém-se um único CTA conforme pediste.

Após criação de Product Feedback, mostrar toast "Feedback registado" e (se estivermos no perfil do clube) eventualmente refrescar uma futura secção de feedbacks do clube. **Não** vamos adicionar essa secção ao perfil do clube neste plano — confirma se queres incluir.

---

## Detalhes técnicos

- **Ficheiros novos**:
  - `supabase/migrations/<ts>_product_feedback.sql` — tabela + RLS.
  - `src/lib/feedback.ts` — types, `insertProductFeedback`, `fetchAllFeedback`, `fetchFeatureNamesByCategory`, `exportFeedbackCSV` (detalhado + agregado).
  - `src/routes/cs.feedback.tsx` — nova página.
- **Ficheiros editados**:
  - `src/components/NewTaskDialog.tsx` — tabs de tipo + ramo "Tarefa futura" (3 opções de prazo + date picker) + ramo "Product Feedback" + checkbox "marcar como já concluída" no ramo Tarefa.
  - `src/lib/cs.ts` — pequena extensão a `insertManualCSTask` para aceitar `weekStart` arbitrário (já aceita), e helper `completeManualTaskNow` que cria + completa numa transação (insert pending → update completed com outcome).
  - `src/components/CSSubNav.tsx` — adicionar item Product Feedback entre Tarefas e Histórico.
  - `src/routeTree.gen.ts` — auto-regenerado pelo plugin.
- **Categorias** ficam como `const` em `src/lib/feedback.ts` (não em DB) para mantermos a lista controlada pelo código.

---

## Perguntas antes de implementar

1. As 12 categorias do screenshot são exaustivas, ou queres que adicione p.ex. "Comunicações" / "App de jogador" / "Outro"?
2. No fluxo "marcar como já concluída" da Tarefa atual, queres que o `outcome` seja obrigatório (igual ao fluxo normal) ou aceitamos `outcome = "very_satisfied"` por defeito sem perguntar?
3. Queres também listar os feedbacks dentro do **perfil de cada clube** (`/tenant/$name`), ou por agora basta a vista agregada em `/cs/feedback`?