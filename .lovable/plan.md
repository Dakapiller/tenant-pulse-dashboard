## Objetivo

Adicionar uma secção de **Ajuda / Knowledge Base** acessível via item no sidebar, com dois artigos:
1. **Como funciona o Health Score** — conteúdo estático detalhado, baseado nas regras já implementadas em `src/lib/health.ts`.
2. **Novidades por versão** — changelog dinâmico alimentado por uma tabela na BD, gerida por superusers.

---

## 1. Base de dados

Nova tabela `changelog_entries`:

| coluna | tipo | notas |
|---|---|---|
| `id` | uuid PK | default `gen_random_uuid()` |
| `version` | text | ex.: "1.4.0" ou "2026-04-30" — único |
| `released_at` | date | data do deploy |
| `title` | text | título curto da versão |
| `summary` | text nullable | parágrafo introdutório opcional |
| `entries` | jsonb | array de `{ type: "feature"\|"improvement"\|"fix", text: string }` |
| `created_at` / `updated_at` | timestamptz | |
| `created_by` | uuid nullable | referência informativa a `auth.users` |

**RLS:**
- SELECT: qualquer utilizador autenticado (incluindo `pending`/`denied`? Não — só roles ≥ user, mas como a tabela não é sensível, basta `auth.uid() IS NOT NULL`).
- INSERT/UPDATE/DELETE: apenas `has_role(auth.uid(), 'superuser')`.

**Seed inicial:** uma entrada "v1.0 — Lançamento inicial" com as funcionalidades atuais resumidas (dashboard, clubes, em risco, CS tasks, admin de utilizadores, autenticação com aprovação, score automático, etc.).

---

## 2. Sidebar — novo item "Ajuda"

Editar `src/components/Sidebar.tsx`:
- Adicionar item `{ to: "/help", label: "Ajuda", icon: HelpCircle }` (lucide).
- Posição: antes de "Admin" no desktop; também aparece no bottom nav móvel (substituir lógica de profile lá se necessário, ou adicionar).
- Visível para **todos os utilizadores autenticados** (não é superuserOnly).

---

## 3. Rotas

Estrutura layout + filhos:

```text
src/routes/help.tsx              -> /help (layout com sidebar dos artigos + Outlet, redireciona index para score)
src/routes/help.index.tsx        -> /help (lista os artigos disponíveis)
src/routes/help.score.tsx        -> /help/score (artigo do health score)
src/routes/help.changelog.tsx    -> /help/changelog (lista de versões)
```

### `/help` (layout)
- Header com título "Centro de ajuda".
- Navegação lateral simples (em mobile vira lista no topo) com os artigos:
  - Como funciona o Health Score
  - Novidades por versão
- `<Outlet />` para o conteúdo do artigo.

### `/help/score` (estático)
Conteúdo em português, estruturado em secções, baseado fielmente em `src/lib/health.ts`:

- **O que é o Health Score** — número 0–100 por clube, indicador de saúde da relação.
- **Níveis** — Em risco (<30), A monitorizar (30–59), Saudável (≥60). Tabela com badges visuais.
- **Como o score muda** (4 regras):
  1. Novo clube → 100.
  2. Upload mensal: queda >5% em GMV/Jogos/Receita → −10 (gera tarefa CS); subida >5% nos três → +10 (gera tarefa de reforço); misto → sem alteração.
  3. Resultado de tarefa CS: má relação −25, boa recetividade +10, muito satisfeito +25.
  4. Ajuste manual via botão "Ajustar score" (com comentário obrigatório, ignora floor).
- **Mínimo dinâmico (floor)** — very_satisfied nos últimos 3 meses → mínimo 80; good_receptivity nos últimos 2 meses → mínimo 60. Bad_relationship não impõe floor.
- **Onde ver o histórico** — link para a aba de histórico do tenant.
- **Flags informativas** — explicar que as flags de risco (queda 5%, tendência 4m, sem receita) são apenas descritivas e NÃO afetam o score.

### `/help/changelog` (dinâmico)
- Server function `getChangelog` (ou query direta à tabela via cliente browser, já que SELECT é livre para autenticados — opto por isto: simples e usa RLS).
- Lista entradas ordenadas por `released_at` desc.
- Cada entrada = card com: versão, data formatada PT, título, summary opcional, e lista agrupada por tipo (Funcionalidades / Melhorias / Correções) com ícones e cores.
- **Se o utilizador for superuser:** botões "Nova entrada", "Editar", "Eliminar" inline.

### Diálogo de criação/edição (superuser)
Componente `ChangelogEntryDialog`:
- Campos: versão, data, título, summary, e editor de itens (lista dinâmica com tipo + texto, botão "+ adicionar item").
- Validações com Zod no cliente; insert/update via `supabase` (RLS garante).

---

## 4. Memória de produto

Quando o user me pedir "atualiza o changelog com X" no futuro, eu próprio insiro nova entrada na BD (via insert tool) — dispensa o user de o fazer manualmente, embora ele também possa.
Vou guardar este protocolo em `mem://features/changelog`.

---

## Detalhes técnicos

- **Acesso à tabela:** uso o `supabase` browser client (RLS protege escrita). Não preciso de server function porque não há lógica sensível — apenas leitura/escrita governada por policies.
- **Tipos:** após a migration, `src/integrations/supabase/types.ts` é regenerado automaticamente; os componentes usam os tipos gerados.
- **i18n:** todo o texto em pt-PT, alinhado com o resto da app.
- **Estilo:** reutilizo `Card`, `Badge`, `Button`, `Dialog`, `Textarea`, `Input` já existentes em `src/components/ui/*`. Sem novas dependências.
- **Mobile:** o item "Ajuda" entra no bottom nav (já há 6 itens potencialmente — vou validar e, se necessário, mover "Ajuda" para dentro do menu de perfil em mobile para não saturar).

---

## Ficheiros a criar / editar

**Criar:**
- `supabase/migrations/<timestamp>_changelog.sql` — tabela + RLS + seed inicial
- `src/lib/changelog.ts` — fetch + mutate helpers + tipos
- `src/routes/help.tsx` — layout
- `src/routes/help.index.tsx` — landing
- `src/routes/help.score.tsx` — artigo do score
- `src/routes/help.changelog.tsx` — changelog dinâmico
- `src/components/ChangelogEntryDialog.tsx` — diálogo create/edit

**Editar:**
- `src/components/Sidebar.tsx` — item "Ajuda"

---

## Fora de âmbito (confirma se queres)

- Pesquisa dentro da KB.
- Mais artigos (ex.: "Como funcionam as flags de risco", "Como gerir tarefas CS"). Posso criar a estrutura para ser fácil adicionar mais — mas começo com 2.
- Notificação "tens novidades" (badge no item Ajuda quando há entrada nova desde o último login). Pode ser uma 2ª iteração.
