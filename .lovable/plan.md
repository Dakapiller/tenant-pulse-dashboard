Em `src/routes/cs.history.tsx`:

1. Remover a função `exportJpeg` e o estado/import relacionados (`html2canvas`, `exportRef` se já não for usado por mais nada).
2. Substituir o `DropdownMenu` "Exportar" por um botão simples "Exportar Excel" que chama directamente `exportExcel()`.
3. Remover o `ref={exportRef}` do wrapper se já não houver outro consumidor.
4. Remover `html2canvas` das dependências (`package.json`) já que deixa de ser usado.

Nada mais é tocado.