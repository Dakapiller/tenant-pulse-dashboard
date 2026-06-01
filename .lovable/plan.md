## Fix: histórico vazio no arranque com default "hoje"

### Causa
`useState<Date | undefined>(today)` guarda `new Date()` com a hora atual. O filtro usa `dateFrom.getTime()` diretamente como limite inferior, pelo que entradas anteriores à hora atual de hoje são excluídas. Ao selecionar manualmente no calendário, o componente devolve a data às 00:00 e o problema desaparece.

### Alteração (apenas `src/routes/cs.history.tsx`)

Normalizar o default para o início do dia, igual ao que o `Calendar` produz:

```ts
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

const today = new Date();
const [dateFrom, setDateFrom] = useState<Date | undefined>(startOfDay(today));
const [dateTo, setDateTo] = useState<Date | undefined>(startOfDay(today));
```

`dateTo` já é passado por `endOfDay(...)` no filtro, por isso continua a apanhar o dia todo. Nenhuma outra lógica muda.
