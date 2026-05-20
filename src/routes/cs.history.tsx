import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { pt } from "date-fns/locale";
import { Calendar as CalendarIcon, ChevronDown, Eye, EyeOff, Search, X } from "lucide-react";
import { ClubLink } from "@/components/ClubLink";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import {
  fetchAllCSStatuses,
  fetchTasksByStatusesPage,
  excludedTenants,
  outcomeLabel,
  taskStatusLabel,
  type CSTask,
  type CSTenantStatus,
} from "@/lib/cs";
import { FLAG_META, type RiskFlag } from "@/lib/risk";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/cs/history")({
  component: CSHistoryPage,
});

const PAGE = 50;

const OUTCOME_FILTER_OPTIONS = [
  { value: "all", label: "Todos" },
  { value: "bad_relationship", label: "Má relação" },
  { value: "good_receptivity", label: "Boa recetividade" },
  { value: "very_satisfied", label: "Cliente satisfeito" },
];

function outcomeBadgeClass(outcome: string | null | undefined): string {
  switch (outcome) {
    case "bad_relationship":
      return "bg-danger/10 text-danger border border-danger/20";
    case "good_receptivity":
      return "bg-primary/10 text-primary border border-primary/20";
    case "very_satisfied":
      return "bg-success/10 text-success border border-success/20";
    default:
      return "bg-muted text-muted-foreground border border-border";
  }
}

/** Badge for a task in history: uses status precedence (cancelled wins over outcome). */
function StatusBadge({ task, className }: { task: CSTask; className?: string }) {
  if (task.status === "cancelled") {
    const tip = task.outcome ? outcomeLabel(task.outcome) : undefined;
    return (
      <span
        title={tip}
        className={cn(
          "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground border border-border line-through decoration-muted-foreground/40",
          className,
        )}
      >
        {taskStatusLabel(task)}
      </span>
    );
  }
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", outcomeBadgeClass(task.outcome), className)}>
      {outcomeLabel(task.outcome)}
    </span>
  );
}

/** Effective timestamp for ordering/filtering: completed_at for completed tasks, created_at for cancelled (no completed_at). */
function effectiveTs(t: CSTask): string {
  return t.completed_at ?? t.created_at ?? "";
}

function formatFlagsLabel(flags: string[] | null | undefined): string {
  if (!flags || flags.length === 0) return "—";
  return flags.map((f) => FLAG_META[f as RiskFlag]?.label ?? f).join(" + ");
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

function CSHistoryPage() {
  const [tasks, setTasks] = useState<CSTask[]>([]);
  const [statuses, setStatuses] = useState<CSTenantStatus[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  const today = new Date();
  const [dateFrom, setDateFrom] = useState<Date | undefined>(startOfMonth(today));
  const [dateTo, setDateTo] = useState<Date | undefined>(today);
  const [search, setSearch] = useState("");
  const [outcome, setOutcome] = useState<string>("all");
  const [openClubs, setOpenClubs] = useState<Record<string, boolean>>({});

  const debouncedSearch = useDebouncedValue(search, 300);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [page, sts] = await Promise.all([
          fetchCompletedCSTasksPage(0, PAGE),
          fetchAllCSStatuses(),
        ]);
        if (cancelled) return;
        setTasks(page);
        setStatuses(sts);
        setHasMore(page.length === PAGE);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const excluded = useMemo(() => excludedTenants(statuses), [statuses]);

  const filtered = useMemo(() => {
    const fromTs = dateFrom ? dateFrom.getTime() : -Infinity;
    const toTs = dateTo ? endOfDay(dateTo).getTime() : Infinity;
    const q = debouncedSearch.trim().toLowerCase();
    return tasks.filter((t) => {
      if (!t.completed_at) return false;
      const ts = new Date(t.completed_at).getTime();
      if (ts < fromTs || ts > toTs) return false;
      if (!showInactive && excluded.has(t.tenant_name)) return false;
      if (outcome !== "all" && t.outcome !== outcome) return false;
      if (q && !t.tenant_name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [tasks, dateFrom, dateTo, debouncedSearch, showInactive, excluded, outcome]);

  const grouped = useMemo(() => {
    const map = new Map<string, CSTask[]>();
    for (const t of filtered) {
      if (!map.has(t.tenant_name)) map.set(t.tenant_name, []);
      map.get(t.tenant_name)!.push(t);
    }
    const arr = Array.from(map.entries()).map(([tenant, list]) => {
      const sorted = [...list].sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""));
      return { tenant, tasks: sorted, last: sorted[0] };
    });
    arr.sort((a, b) => (b.last.completed_at ?? "").localeCompare(a.last.completed_at ?? ""));
    return arr;
  }, [filtered]);

  const summary = useMemo(() => {
    const totalActions = filtered.length;
    const clubs = new Set(filtered.map((t) => t.tenant_name)).size;
    const counts: Record<string, number> = {};
    for (const t of filtered) {
      const key = t.outcome ?? "—";
      counts[key] = (counts[key] ?? 0) + 1;
    }
    let topOutcome: string | null = null;
    let topCount = 0;
    for (const [k, v] of Object.entries(counts)) {
      if (v > topCount) { topCount = v; topOutcome = k; }
    }
    return { totalActions, clubs, topOutcome, topCount };
  }, [filtered]);

  const inactiveCount = useMemo(() => {
    if (showInactive) return 0;
    return tasks.filter((t) => excluded.has(t.tenant_name)).length;
  }, [tasks, excluded, showInactive]);

  async function loadMore() {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const next = await fetchCompletedCSTasksPage(tasks.length, PAGE);
      setTasks((prev) => [...prev, ...next]);
      setHasMore(next.length === PAGE);
    } finally {
      setLoadingMore(false);
    }
  }

  function clearDateRange() {
    setDateFrom(undefined);
    setDateTo(undefined);
  }

  function setCurrentMonth() {
    setDateFrom(startOfMonth(new Date()));
    setDateTo(new Date());
  }

  const dateRangeLabel = dateFrom && dateTo
    ? `${format(dateFrom, "dd MMM", { locale: pt })} – ${format(dateTo, "dd MMM yyyy", { locale: pt })}`
    : dateFrom
      ? `Desde ${format(dateFrom, "dd MMM yyyy", { locale: pt })}`
      : dateTo
        ? `Até ${format(dateTo, "dd MMM yyyy", { locale: pt })}`
        : "Todo o período";

  if (loading) return <div className="p-10 text-muted-foreground">A carregar…</div>;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1400px] mx-auto space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Histórico CS</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Tarefas concluídas, agrupadas por clube. {tasks.length} carregada{tasks.length === 1 ? "" : "s"}{hasMore ? "" : " · fim"}.
        </p>
      </header>

      {/* Filters */}
      <section className="rounded-xl border border-border bg-surface p-4 flex flex-wrap items-center gap-3">
        <Popover>
          <PopoverTrigger asChild>
            <button className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm hover:bg-muted/50 min-h-[44px]">
              <CalendarIcon className="h-4 w-4 text-muted-foreground" />
              <span>{dateRangeLabel}</span>
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="range"
              selected={{ from: dateFrom, to: dateTo }}
              onSelect={(range) => {
                setDateFrom(range?.from);
                setDateTo(range?.to);
              }}
              numberOfMonths={2}
              locale={pt}
              className={cn("p-3 pointer-events-auto")}
            />
            <div className="flex items-center justify-between gap-2 border-t border-border p-2">
              <button onClick={setCurrentMonth} className="text-xs px-2 py-1 rounded hover:bg-muted">Mês atual</button>
              <button onClick={clearDateRange} className="text-xs px-2 py-1 rounded hover:bg-muted text-muted-foreground">Limpar</button>
            </div>
          </PopoverContent>
        </Popover>

        <div className="relative flex-1 min-w-[220px]">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Pesquisar clube…"
            className="w-full rounded-lg border border-border bg-surface pl-9 pr-9 py-2 text-sm min-h-[44px] focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-muted"
              aria-label="Limpar pesquisa"
            >
              <X className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          )}
        </div>

        <Select value={outcome} onValueChange={setOutcome}>
          <SelectTrigger className="w-[200px] min-h-[44px]">
            <SelectValue placeholder="Resultado" />
          </SelectTrigger>
          <SelectContent>
            {OUTCOME_FILTER_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {inactiveCount > 0 && (
          <button
            onClick={() => setShowInactive((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs hover:bg-muted/50 min-h-[44px]"
          >
            {showInactive ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            {showInactive ? "Ocultar inativos" : `Mostrar inativos (${inactiveCount})`}
          </button>
        )}
      </section>

      {/* Summary cards */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-xl border border-border bg-surface p-5">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Total ações</div>
          <div className="text-3xl font-semibold mt-2">{summary.totalActions}</div>
        </div>
        <div className="rounded-xl border border-border bg-surface p-5">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Clubes contactados</div>
          <div className="text-3xl font-semibold mt-2">{summary.clubs}</div>
        </div>
        <div className="rounded-xl border border-border bg-surface p-5">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Resultado mais comum</div>
          {summary.topOutcome ? (
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <span className={cn("inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium", outcomeBadgeClass(summary.topOutcome))}>
                {outcomeLabel(summary.topOutcome)}
              </span>
              <span className="text-sm text-muted-foreground">{summary.topCount} ações</span>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground mt-2">—</div>
          )}
        </div>
      </section>

      {/* Grouped results */}
      <section className="rounded-xl border border-border bg-surface overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-base font-semibold">Clubes ({grouped.length})</h2>
          <span className="text-xs text-muted-foreground">{summary.totalActions} ações no período</span>
        </div>

        {grouped.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-12">
            Sem ações concluídas nos filtros selecionados.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {grouped.map(({ tenant, tasks: list, last }) => {
              const open = !!openClubs[tenant];
              return (
                <li key={tenant}>
                  <Collapsible open={open} onOpenChange={(v) => setOpenClubs((p) => ({ ...p, [tenant]: v }))}>
                    <CollapsibleTrigger asChild>
                      <button className="w-full flex items-start md:items-center justify-between gap-3 px-4 sm:px-5 py-4 hover:bg-muted/40 transition-colors text-left">
                        <div className="flex items-start md:items-center gap-3 min-w-0 flex-1">
                          <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform shrink-0 mt-1 md:mt-0", open && "rotate-180")} />
                          <div className="min-w-0 flex-1 flex flex-col md:flex-row md:items-center md:gap-3">
                            <div className="flex items-center gap-2 min-w-0">
                              <ClubLink name={tenant} className="font-medium hover:underline truncate" />
                              <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground shrink-0">
                                {list.length} {list.length === 1 ? "ação" : "ações"}
                              </span>
                            </div>
                            <span className={cn("md:hidden mt-2 inline-flex w-fit items-center rounded-full px-2.5 py-0.5 text-xs font-medium", outcomeBadgeClass(last.outcome))}>
                              {outcomeLabel(last.outcome)}
                            </span>
                          </div>
                        </div>
                        <div className="hidden md:flex items-center gap-3 shrink-0">
                          <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", outcomeBadgeClass(last.outcome))}>
                            {outcomeLabel(last.outcome)}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {last.completed_at ? format(new Date(last.completed_at), "dd MMM yyyy", { locale: pt }) : ""}
                          </span>
                        </div>
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      {/* Mobile: stacked cards */}
                      <ul className="md:hidden px-4 pb-4 space-y-2">
                        {list.map((t) => (
                          <li key={t.id} className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs text-muted-foreground">
                                {t.completed_at ? format(new Date(t.completed_at), "dd MMM yyyy", { locale: pt }) : "—"}
                              </span>
                              <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium shrink-0", outcomeBadgeClass(t.outcome))}>
                                {outcomeLabel(t.outcome)}
                              </span>
                            </div>
                            {t.flags && t.flags.length > 0 && (
                              <div>
                                <span className="text-xs px-1.5 py-0.5 rounded bg-muted">{formatFlagsLabel(t.flags)}</span>
                              </div>
                            )}
                            {t.note && (
                              <p className="text-xs italic text-muted-foreground break-words">“{t.note}”</p>
                            )}
                          </li>
                        ))}
                      </ul>

                      {/* Desktop: table */}
                      <div className="hidden md:block px-5 pb-4 overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-xs uppercase tracking-wide text-muted-foreground border-b border-border">
                              <th className="text-left font-medium py-2 pr-3 whitespace-nowrap">Data</th>
                              <th className="text-left font-medium py-2 pr-3">Flag(s)</th>
                              <th className="text-left font-medium py-2 pr-3 whitespace-nowrap">Resultado</th>
                              <th className="text-left font-medium py-2">Comentário</th>
                            </tr>
                          </thead>
                          <tbody>
                            {list.map((t) => (
                              <tr key={t.id} className="border-b border-border/50 last:border-0 align-top">
                                <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground">
                                  {t.completed_at ? format(new Date(t.completed_at), "dd MMM yyyy", { locale: pt }) : "—"}
                                </td>
                                <td className="py-2 pr-3">
                                  <span className="text-xs px-1.5 py-0.5 rounded bg-muted">{formatFlagsLabel(t.flags)}</span>
                                </td>
                                <td className="py-2 pr-3 whitespace-nowrap">
                                  <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", outcomeBadgeClass(t.outcome))}>
                                    {outcomeLabel(t.outcome)}
                                  </span>
                                </td>
                                <td className="py-2 text-muted-foreground">
                                  {t.note ? <span className="italic">“{t.note}”</span> : <span className="text-muted-foreground/60">—</span>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                </li>
              );
            })}
          </ul>
        )}

        {hasMore && (
          <div className="border-t border-border p-4 flex flex-col items-center gap-2">
            {dateFrom && (
              <span className="text-xs text-muted-foreground">
                Pode haver registos anteriores ainda não carregados.
              </span>
            )}
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted/50 disabled:opacity-50 min-h-[44px]"
            >
              {loadingMore ? "A carregar…" : "Carregar mais 50"}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
