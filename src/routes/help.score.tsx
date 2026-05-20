import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/help/score")({
  head: () => ({
    meta: [
      { title: "Como funciona o Health Score — Tenant Pulse" },
      { name: "description", content: "Explicação detalhada das regras que governam o health score de cada clube." },
    ],
  }),
  component: ScoreArticle,
});

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold text-foreground">{title}</h2>
      <div className="text-sm leading-relaxed text-foreground/90 space-y-3">{children}</div>
    </section>
  );
}

function ScoreArticle() {
  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-2xl md:text-3xl font-bold text-foreground">Como funciona o Health Score</h1>
        <p className="mt-2 text-muted-foreground">
          O Health Score é um número de 0 a 100 que resume a saúde da relação com cada clube. Combina sinais
          automáticos vindos dos uploads mensais com o feedback registado pela equipa de Customer Success.
        </p>
      </header>

      <Section title="Os três níveis">
        <p>O score é traduzido visualmente em três níveis para leitura rápida:</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 not-prose">
          <Card>
            <CardContent className="p-4 space-y-2">
              <Badge variant="destructive">Em risco</Badge>
              <p className="text-sm text-muted-foreground">Score abaixo de 30. Requer ação imediata.</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 space-y-2">
              <Badge variant="secondary">A monitorizar</Badge>
              <p className="text-sm text-muted-foreground">Entre 30 e 59. Acompanhar com regularidade.</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 space-y-2">
              <Badge>Saudável</Badge>
              <p className="text-sm text-muted-foreground">60 ou mais. Relação estável.</p>
            </CardContent>
          </Card>
        </div>
      </Section>

      <Section title="Como o score muda">
        <p>
          Existem cinco formas (e <strong>apenas cinco</strong>) de o score se alterar. Todas as alterações
          ficam registadas no histórico do clube com o motivo correspondente.
        </p>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Regra 1 — Novo clube</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>
              A primeira vez que um clube aparece num upload, recebe automaticamente um score de
              <strong className="text-foreground"> 100</strong> como linha de partida.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Regra 2 — Variação mensal nos uploads</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>Após cada upload mensal, comparamos três métricas com o mês anterior:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>GMV total</li>
              <li>Jogos online</li>
              <li>Receita</li>
            </ul>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>
                Se <strong className="text-foreground">qualquer uma</strong> caiu mais de 10%: <strong className="text-destructive">−10 pontos</strong>{" "}
                e é gerada uma tarefa de CS para contactar o clube.
              </li>
              <li>
                Se <strong className="text-foreground">as três</strong> subiram mais de 10%: <strong className="text-foreground">+10 pontos</strong>{" "}
                e é gerada uma tarefa para reforçar a relação.
              </li>
              <li>Em qualquer outro cenário (misto, sem variações relevantes): o score mantém-se.</li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Regra 3 — Resultado de uma tarefa CS</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>Quando uma tarefa é concluída, o resultado registado afeta o score:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong className="text-destructive">Má relação</strong>: −25 pontos</li>
              <li><strong className="text-foreground">Boa recetividade</strong>: +10 pontos</li>
              <li><strong className="text-foreground">Cliente muito satisfeito</strong>: +25 pontos</li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Regra 4 — Ajuste manual</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>
              Qualquer membro da equipa pode ajustar manualmente o score na página do clube, através do
              botão <strong className="text-foreground">"Ajustar score"</strong>. É obrigatório deixar um
              comentário (mín. 5 caracteres) que fica registado no histórico. O ajuste manual{" "}
              <strong className="text-foreground">ignora o mínimo dinâmico</strong> descrito abaixo — é uma
              decisão deliberada da pessoa.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Regra 5 — Bug resolvido</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>
              Quando um bug reportado pela equipa de CS é marcado como{" "}
              <strong className="text-foreground">Resolvido</strong> na lista de Bug Reports, o clube afetado
              recebe automaticamente <strong className="text-foreground">+5 pontos</strong> de health score.
              O bónus aplica-se apenas na <strong>primeira</strong> transição para Resolvido — reabrir e voltar
              a resolver o mesmo bug não soma de novo. Os estados{" "}
              <strong className="text-foreground">Em curso</strong> e{" "}
              <strong className="text-foreground">Não será corrigido</strong> não têm impacto no score.
            </p>
            <p>
              Tal como nas restantes regras automáticas, o bónus respeita o teto de 100 e o mínimo dinâmico
              descrito abaixo.
            </p>
          </CardContent>
        </Card>
      </Section>

      <Section title="Mínimo dinâmico (floor)">
        <p>
          Para evitar que um clube com sinais positivos recentes desça demasiado por causa de oscilações nos
          uploads, aplicamos um <strong>mínimo dinâmico</strong> sempre que o score é recalculado pelas regras
          1, 2 ou 3:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong className="text-foreground">Cliente muito satisfeito</strong> registado nos últimos 3 meses
            → o score nunca desce abaixo de <strong>80</strong>.
          </li>
          <li>
            <strong className="text-foreground">Boa recetividade</strong> registada nos últimos 2 meses → o
            score nunca desce abaixo de <strong>60</strong>.
          </li>
          <li>
            <strong className="text-foreground">Má relação</strong> não impõe qualquer mínimo.
          </li>
        </ul>
        <p>
          Quando o mínimo é aplicado, fica registado no histórico como uma entrada separada, indicando o
          outcome e a data que justificou o piso.
        </p>
      </Section>

      <Section title="Flags informativas vs. score">
        <p>
          Na página de cada clube e na lista <em>Em risco</em> verás <strong>flags</strong> como "GMV em
          queda", "Tendência negativa: receita" ou "Sem receita". Estas flags são <strong>apenas
          descritivas</strong> — ajudam a contextualizar o estado do clube, mas{" "}
          <strong className="text-foreground">não afetam o health score</strong>. O score só muda pelas cinco
          regras acima.
        </p>
      </Section>

      <Section title="Onde ver o histórico">
        <p>
          Em cada página de clube, na secção de histórico, encontras todas as alterações de score com
          data, valor anterior, novo valor, delta e motivo. É a fonte única de verdade para auditar como
          o score chegou ao valor atual.
        </p>
      </Section>
    </div>
  );
}
