import { useMemo } from "react";
import { ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { availableYears, type PeriodMode, type PeriodSelection, type ResolvedPeriod } from "@/lib/period";
import { periodLabel } from "@/lib/format";

const MODE_OPTIONS: { value: PeriodMode; label: string }[] = [
  { value: "month", label: "Mês único" },
  { value: "range", label: "Intervalo de meses" },
  { value: "ytd", label: "Ano até hoje (YTD)" },
  { value: "year", label: "Ano completo" },
  { value: "all", label: "Todo o período" },
];

interface Props {
  selection: PeriodSelection;
  resolved: ResolvedPeriod;
  available: string[]; // descending
  onChange: (sel: PeriodSelection) => void;
}

export function PeriodSelector({ selection, resolved, available, onChange }: Props) {
  const years = useMemo(() => availableYears(available), [available]);
  const asc = useMemo(() => [...available].sort(), [available]);

  function setMode(mode: PeriodMode) {
    if (mode === "month") {
      onChange({ mode, month: selection.month ?? available[0] });
    } else if (mode === "range") {
      onChange({
        mode,
        from: selection.from ?? asc[0],
        to: selection.to ?? available[0],
      });
    } else if (mode === "year") {
      onChange({ mode, year: selection.year ?? years[0] });
    } else {
      onChange({ mode });
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 h-11 sm:h-9 text-sm hover:bg-muted/40 min-w-[200px]">
          <span className="text-xs text-muted-foreground">Período:</span>
          <span className="font-medium flex-1 text-left truncate">{resolved.label}</span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[320px] p-3 space-y-3">
        <div>
          <label className="text-xs uppercase tracking-wide text-muted-foreground mb-1 block">Tipo</label>
          <Select value={selection.mode} onValueChange={(v) => setMode(v as PeriodMode)}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MODE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {selection.mode === "month" && (
          <div>
            <label className="text-xs uppercase tracking-wide text-muted-foreground mb-1 block">Mês</label>
            <Select
              value={selection.month ?? available[0]}
              onValueChange={(v) => onChange({ mode: "month", month: v })}
            >
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {available.map((p) => (
                  <SelectItem key={p} value={p}>{periodLabel(p)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {selection.mode === "range" && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs uppercase tracking-wide text-muted-foreground mb-1 block">De</label>
              <Select
                value={selection.from ?? asc[0]}
                onValueChange={(v) => onChange({ ...selection, mode: "range", from: v })}
              >
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {available.map((p) => (
                    <SelectItem key={p} value={p}>{periodLabel(p)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs uppercase tracking-wide text-muted-foreground mb-1 block">Até</label>
              <Select
                value={selection.to ?? available[0]}
                onValueChange={(v) => onChange({ ...selection, mode: "range", to: v })}
              >
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {available.map((p) => (
                    <SelectItem key={p} value={p}>{periodLabel(p)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {selection.mode === "year" && (
          <div>
            <label className="text-xs uppercase tracking-wide text-muted-foreground mb-1 block">Ano</label>
            <Select
              value={String(selection.year ?? years[0])}
              onValueChange={(v) => onChange({ mode: "year", year: Number(v) })}
            >
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {years.map((y) => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <p className="text-[11px] text-muted-foreground pt-1 border-t border-border">
          {resolved.periods.length} {resolved.periods.length === 1 ? "mês" : "meses"} no período.
        </p>
      </PopoverContent>
    </Popover>
  );
}
