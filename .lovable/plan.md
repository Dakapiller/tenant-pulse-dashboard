## 3 melhorias visuais no painel CS

Apenas mudanças de UI. Sem alterações a lógica de scores, regras ou queries fora do que é descrito.

### 1. Tempo relativo nas tarefas

Criar helper em `src/lib/relativeTime.ts`:
- `relativeLabelPT(date)` → "hoje", "há 1 dia", "há 3 dias", "há 1 semana", "há 2 semanas", etc. (usa `formatDistanceToNow` de `date-fns` com locale `pt`).
- `relativeColorClass(date)` → devolve classe Tailwind semântica:
  - ≤7 dias → `text-success`
  - 8–14 dias → `text-warning`
  - >14 dias → `text-danger`

Aplicação (substituir apenas a apresentação da data da tarefa, manter ordenação por `week_start`):

- **`src/routes/cs.tasks.tsx`** — coluna "Semana" (linhas ~1203-1210): trocar `r.week_start` por `<span title={r.week_start} className={relativeColorClass(r.week_start)}>{relativeLabelPT(r.week_start)}</span>`. Manter o sufixo " · atrasada".
- **`src/routes/tenant.$name.tsx`** — secção "Tarefas pendentes" (linha 234): trocar `Semana de {t.week_start}` por label relativa com cor + `title` com data absoluta.
- **`src/routes/clubs.tsx`** — quick card / club card: encontrar e substituir qualquer renderização de `week_start` em listas de tarefas pendentes pelo mesmo padrão (label relativa + cor + tooltip).

### 2. Indicador "última actividade CS"

Componente inline pequeno `LastCSActivity` (definido em `clubs.tsx` ou inline):
- Calcula `maxCompletedAt` = max `completed_at` de `tenantTasks` onde `status === "completed"`.
- Render:
  - sem registo → `<span className="text-danger">sem actividade registada</span>`
  - com registo → `última actividade {relativeLabelPT(maxCompletedAt)}` com cor:
    - ≤7d verde, 8–30d laranja, >30d vermelho.

Inserção:
- **`src/routes/clubs.tsx`** quick card: no bloco do header ao lado do `ClubStatusBadge` (linha 841), dentro do mesmo `flex flex-wrap`.
- **`src/routes/tenant.$name.tsx`** header da página: ao lado do badge de estado do clube. Usa `csTasks` já carregado.

### 3. Sparkline da variação do score

No quick card de `clubs.tsx`, dentro de `ScoreVariationSection` (linha 1561), acima do bloco "Última alteração":

- Adicionar componente `ScoreSparkline({ tenant })`:
  - `useEffect` carrega últimos 8 valores via `fetchHealthLog(tenant, 8)` (helper já existente em `src/lib/health.ts`, linha 142).
  - Ordenar `asc` por `changed_at`, mapear para `[{ v: new_score }]`.
  - Render: `<ResponsiveContainer width="100%" height={48}><LineChart data={...}><Line dataKey="v" dot={false} strokeWidth={2} stroke={color} isAnimationActive={false} /></LineChart></ResponsiveContainer>`.
  - Cor: `text-success` se último > primeiro, `text-danger` se <, `text-muted-foreground` se igual. (Usar `hsl(var(--success))` etc. ou cores resolvidas via CSS var — `recharts` precisa de string de cor; usar `var(--success)` no atributo `stroke` envolvido numa div com `style={{ color: ... }}` não funciona — usar valores `hsl` directos referenciando tokens existentes do projecto, lendo `src/styles.css` para confirmar os nomes).
  - Sem eixos, sem grid, sem tooltip, sem legend (não os renderizar).
  - Se <2 pontos: não renderizar nada.

`ScoreVariationSection` passa a receber `tenant` como prop (já tem `row` mas precisa do nome; passar `tenant={tenant}` do componente pai onde a secção é instanciada).

### Notas técnicas

- `date-fns@4` e `recharts@3.8` já estão no `package.json`. Sem instalações.
- Não tocar em queries existentes; o sparkline faz uma query nova mínima e isolada apenas para os últimos 8 pontos.
- Manter tokens semânticos do design system (`text-success`, `text-warning`, `text-danger`, `text-muted-foreground`); ler `src/styles.css` antes de implementar para confirmar nomes exactos das CSS vars usadas em `stroke`.
