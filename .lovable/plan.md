Criar uma nova entrada de changelog v1.1.0 no backend, com data de hoje, resumindo todas as melhorias recentes da aplicação.

### Entrada v1.1.0

**Título:** Melhorias de visualização, produtividade e organização

**Resumo:** Várias melhorias de UI e fluxos de trabalho para tornar a monitorização de tenants mais rápida e organizada.

**Itens:**

**Funcionalidades:**
- Sparkline no cartão do clube — mini gráfico de linha nos cartões de clube mostrando os últimos 8 valores do Health Score, com cor condicional (verde se subiu, vermelho se desceu)
- Edição inline de score — na lista de clubes, clicar no badge de saúde abre o diálogo de ajuste de score sem sair da página
- Resumo semanal no CS History — secção colapsível no topo da página de histórico com tarefas concluídas, clubes contactados, mudanças de score e top 3 maiores quedas da semana
- Link de download no menu Carregar — card para guardar e aceder a um link de download de fonte externa (ex: spreadsheet mensal)

**Melhorias:**
- Tempo relativo nas tarefas — datas absolutas substituídas por "há X dias" com código de cor (verde ≤7 dias, laranja 8–14, vermelho >14) em todas as listas de tarefas
- Reorganização cartão rápido vs página completa — o cartão rápido do clube agora mostra apenas o essencial (score, YoY, tarefas pendentes, ações); conteúdo analítico (comparação mensal, histórico de risco, histórico CS, estados do ciclo) movido para a página completa
- Exportar Excel simplificado no CS History — removido o export JPEG (que estava a falhar); mantido apenas o export Excel com um botão direto

**Correções:**
- Removida dependência html2canvas que causava falhas no export