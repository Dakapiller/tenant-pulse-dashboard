## Objetivo

Mostrar **a razão** ao lado de cada variação de score no histórico de cada clube, e tornar o motor de scoring mais conservador para que o score só varie quando existir um motivo real:

1. Alguma métrica-chave piorou ou melhorou **mais de 5%** vs o último mês analisado, **ou**
2. Existe uma **tendência negativa há 4+ meses consecutivos** numa métrica-chave.

Caso contrário, o score mantém-se estável de mês para mês.

---

## Mudanças de scoring (`src/lib/risk.ts`)

Atualmente as flags disparam com regras heterogéneas (ex.: `gmv_stagnant` quando varia <5%, `rate_declining` >10pp, `games_dropping` em 2 meses). Vou alinhá-las com a regra única do utilizador.

**Métricas-chave consideradas:** `games_online`, `gmv_all`, `revenue`, `transacted_rate`.

**Novas flags:**

| Flag | Quando dispara | Pontos |
|---|---|---|
| `games_drop_5` | jogos caíram >5% vs mês anterior | 25 |
| `gmv_drop_5` | GMV caiu >5% vs mês anterior | 20 |
| `revenue_drop_5` | receita caiu >5% vs mês anterior | 25 |
| `rate_drop_5` | taxa transacionada caiu >5pp vs mês anterior | 20 |
| `games_trend_4m` | jogos a cair 4 meses seguidos | 30 |
| `gmv_trend_4m` | GMV a cair 4 meses seguidos | 25 |
| `revenue_trend_4m` | receita a cair 4 meses seguidos | 30 |
| `no_revenue` *(mantida)* | GMV>0 e receita=0 | 25 |

Flags antigas `games_dropping`, `gmv_stagnant`, `rate_declining`, `spike_then_crash`, `saas_only` são **removidas** (cobertas pelas novas regras ou ruído).

Cada flag passa a ter um **`reason`** legível (ex.: "Receita caiu 12,4% (€340 → €298)") guardado no resultado, para que o histórico possa explicá-la.

A função `computeRisk` passa a devolver, além de `flags`, um array `flagDetails: { flag, label, points, reason }[]` com a razão calculada a partir dos snapshots.

## Mudanças no histórico (`src/routes/clubs.tsx`)

`scoreChangeEvents` passa a também devolver, para cada variação, o **conjunto de razões**: comparando os `flagDetails` do mês com os do mês anterior, identificamos:

- **Flags adicionadas** → "Receita caiu 12% vs mês anterior"
- **Flags resolvidas** → "Recuperação: jogos voltaram a subir"
- **Variação CS** (se o `csModifier` mudou) → "Outcome CS: má relação (+25)"

`ClubHistoryPanel` (a lista de eventos no dropdown da `/clubs`) e `ScoreVariationSection` (no drawer) renderizam essas razões por baixo da linha "▲ X pts · old → new", em bullets pequenos cinza.

```text
SCORE   Variação em março de 2026               01/04/2026
▲ 10 pts · 20 → 30
  • Receita caiu 14% (€325 → €279)
  • GMV caiu 6% vs fevereiro
```

Quando não há variação (todas as métricas dentro de ±5% e sem tendências), **não é gerado evento** — o histórico fica mais limpo, alinhado com a regra do utilizador.

## Impacto noutros locais

- `/cs` (geração de tarefas semanais): continua a usar `computeRiskWithCS` mas a lista de flags muda. Os labels apresentados (`FLAG_META[f].label`) e textos de CTA (`FLAG_CTA[f]`) são atualizados para as novas flags. Tarefas pendentes geradas com flags antigas continuam válidas (o campo `flags` é `text[]` na BD); apenas deixarão de ser regeradas com nomes antigos.
- `/at-risk`, `/index` (Dashboard): consomem `computeRiskWithCS` — funcionam sem alterações, scores ficam mais estáveis.
- `tenant.$name`: idem.

## Ficheiros a editar

- `src/lib/risk.ts` — novas flags com regra de 5% / 4-meses, função produz `flagDetails` com `reason` calculada.
- `src/routes/clubs.tsx` — `scoreChangeEvents` devolve `reasons[]`; `ClubHistoryPanel` e `ScoreVariationSection` mostram-nas.
- `src/routes/cs.tsx` — atualizar `FLAG_CTA` map para as novas flags (reason + cta em PT).

## Notas

- Não há migração de BD: as flags são calculadas em runtime a partir de `tenant_snapshots`.
- Histórico anterior ao deploy é recalculado retroativamente com as novas regras (o histórico exibido é derivado, não armazenado).
