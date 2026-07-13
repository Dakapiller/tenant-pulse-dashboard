import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { pt } from "date-fns/locale";
import { Calendar as CalendarIcon, ChevronDown, Download, ExternalLink, Eye, EyeOff, Search, X } from "lucide-react";
import * as XLSX from "xlsx";
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
import { fetchAllPaged } from "@/lib/data";
import { fetchBugsByStatuses, BUG_SEVERITY_LABEL, type BugReport } from "@/lib/bugs";
import { fetchHealthScoreLogRange } from "@/lib/health";
import { FLAG_META, type RiskFlag } from "@/lib/risk";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

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

/**
 * Unified history entry: a completed/cancelled CS task OR a resolved bug.
 * Discriminated by `kind` so badges, filters and grouping can branch on type.
 */
type HistoryEntry =
  | { kind: "task"; id: string; tenant: string; ts: string; task: CSTask }
  | { kind: "bug"; id: string; tenant: string; ts: string; bug: BugReport };

function entryTs(e: HistoryEntry): string {
  return e.ts;
}

/** Badge for a unified history entry. */
function EntryBadge({ entry, className }: { entry: HistoryEntry; className?: string }) {
  if (entry.kind === "bug") {
    return (
      <span
        title={`Severidade: ${BUG_SEVERITY_LABEL[entry.bug.severity]}`}
        className={cn(
          "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-primary/10 text-primary border border-primary/20",
          className,
        )}
      >
        Bug resolvido
      </span>
    );
  }
  const task = entry.task;
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

/** Effective timestamp for ordering/filtering tasks: completed_at, else created_at. */
function taskTs(t: CSTask): string {
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

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function startOfCurrentWeekMonday(): Date {
  const now = new Date();
  const day = now.getDay(); // 0 Sun .. 6 Sat
  const diff = day === 0 ? -6 : 1 - day;
  const m = new Date(now);
  m.setDate(now.getDate() + diff);
  m.setHours(0, 0, 0, 0);
  return m;
}

interface WeeklyDigest {
  totalCompleted: number;
  clubsContacted: number;
  scoreChanges: number;
  topDrops: { tenant: string; drop: number }[];
}

function CSHistoryPage() {
  const [tasks, setTasks] = useState<CSTask[]>([]);
  // Todas as tarefas concluídas/anuladas cujo completed_at cai no intervalo
  // selecionado — usadas para os cards de sumário, para que os totais reflitam
  // o intervalo inteiro e não apenas a página carregada.
  const [rangeTasks, setRangeTasks] = useState<CSTask[]>([]);
  const [statuses, setStatuses] = useState<CSTenantStatus[]>([]);
  const [bugs, setBugs] = useState<BugReport[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  const today = new Date();
  const [dateFrom, setDateFrom] = useState<Date | undefined>(startOfDay(today));
  const [dateTo, setDateTo] = useState<Date | undefined>(startOfDay(today));
  
  const [exporting, setExporting] = useState(false);
  const [search, setSearch] = useState("");
  const [outcome, setOutcome] = useState<string>("all");
  const [openClubs, setOpenClubs] = useState<Record<string, boolean>>({});
  const [digest, setDigest] = useState<WeeklyDigest | null>(null);
  const [digestOpen, setDigestOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const monday = startOfCurrentWeekMonday();
        const now = new Date();
        const fromIso = monday.toISOString();
        const toIso = now.toISOString();
        const [tasksRes, log] = await Promise.all([
          supabase
            .from("cs_tasks")
            .select("tenant_name, completed_at")
            .eq("status", "completed")
            .gte("completed_at", fromIso)
            .lte("completed_at", toIso),
          fetchHealthScoreLogRange(fromIso, toIso),
        ]);
        if (cancelled) return;
        const tRows = (tasksRes.data ?? []) as { tenant_name: string }[];
        const totalCompleted = tRows.length;
        const clubsContacted = new Set(tRows.map((r) => r.tenant_name)).size;
        const scoreChanges = log.length;
        const dropsByTenant = new Map<string, number>();
        for (const r of log) {
          const delta = Number(r.new_score) - Number(r.previous_score);
          dropsByTenant.set(r.tenant_name, (dropsByTenant.get(r.tenant_name) ?? 0) + delta);
        }
        const topDrops = Array.from(dropsByTenant.entries())
          .filter(([, v]) => v < 0)
          .sort((a, b) => a[1] - b[1])
          .slice(0, 3)
          .map(([tenant, drop]) => ({ tenant, drop }));
        setDigest({ totalCompleted, clubsContacted, scoreChanges, topDrops });
      } catch (err) {
        console.error("digest", err);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const debouncedSearch = useDebouncedValue(search, 300);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [page, sts, bgs] = await Promise.all([
          fetchTasksByStatusesPage(["completed", "cancelled"], 0, PAGE),
          fetchAllCSStatuses(),
          fetchBugsByStatuses(["solved"]),
        ]);
        if (cancelled) return;
        setTasks(page);
        setStatuses(sts);
        setBugs(bgs);
        setHasMore(page.length === PAGE);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Fetch ALL tasks whose completed_at falls in the selected date range so the
  // summary cards reflect the whole range (not just the paginated page below).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const fromIso = dateFrom ? startOfDay(dateFrom).toISOString() : null;
      const toIso = dateTo ? endOfDay(dateTo).toISOString() : null;
      try {
        const rows = await fetchAllPaged<CSTask>((from, to) => {
          let q = supabase
            .from("cs_tasks")
            .select("*")
            .in("status", ["completed", "cancelled"])
            .not("completed_at", "is", null);
          if (fromIso) q = q.gte("completed_at", fromIso);
          if (toIso) q = q.lte("completed_at", toIso);
          return q.order("completed_at", { ascending: false }).range(from, to);
        });
        if (!cancelled) setRangeTasks(rows);
      } catch (err) {
        console.error("rangeTasks", err);
      }
    })();
    return () => { cancelled = true; };
  }, [dateFrom, dateTo]);

  const excluded = useMemo(() => excludedTenants(statuses), [statuses]);

  // Build unified entries (tasks + resolved bugs) and apply filters.
  const filtered = useMemo<HistoryEntry[]>(() => {
    const fromTs = dateFrom ? dateFrom.getTime() : -Infinity;
    const toTs = dateTo ? endOfDay(dateTo).getTime() : Infinity;
    const q = debouncedSearch.trim().toLowerCase();

    const taskEntries: HistoryEntry[] = tasks
      .map<HistoryEntry | null>((t) => {
        const ts = taskTs(t);
        if (!ts) return null;
        return { kind: "task", id: `t-${t.id}`, tenant: t.tenant_name, ts, task: t };
      })
      .filter((e): e is HistoryEntry => e !== null);

    const bugEntries: HistoryEntry[] = bugs
      .filter((b) => !!b.solved_at)
      .map<HistoryEntry>((b) => ({ kind: "bug", id: `b-${b.id}`, tenant: b.tenant_name, ts: b.solved_at!, bug: b }));

    return [...taskEntries, ...bugEntries].filter((e) => {
      const ts = new Date(e.ts).getTime();
      if (ts < fromTs || ts > toTs) return false;
      if (!showInactive && excluded.has(e.tenant)) return false;
      // Outcome filter only applies to completed tasks; bugs and cancelled tasks are excluded when a specific outcome is chosen.
      if (outcome !== "all") {
        if (e.kind !== "task") return false;
        if (e.task.status !== "completed") return false;
        if (e.task.outcome !== outcome) return false;
      }
      if (q && !e.tenant.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [tasks, bugs, dateFrom, dateTo, debouncedSearch, showInactive, excluded, outcome]);

  const grouped = useMemo(() => {
    const map = new Map<string, HistoryEntry[]>();
    for (const e of filtered) {
      if (!map.has(e.tenant)) map.set(e.tenant, []);
      map.get(e.tenant)!.push(e);
    }
    const arr = Array.from(map.entries()).map(([tenant, list]) => {
      const sorted = [...list].sort((a, b) => entryTs(b).localeCompare(entryTs(a)));
      return { tenant, entries: sorted, last: sorted[0] };
    });
    arr.sort((a, b) => entryTs(b.last).localeCompare(entryTs(a.last)));
    return arr;
  }, [filtered]);

  const summary = useMemo(() => {
    // Conta todas as entradas visíveis (concluídas + anuladas + bugs resolvidos)
    // para que os cards reflitam exatamente o que está listado abaixo.
    const totalActions = filtered.length;
    const clubs = new Set(filtered.map((e) => e.tenant)).size;
    const counts: Record<string, number> = {};
    for (const e of filtered) {
      let key: string;
      if (e.kind === "bug") key = "bug_solved";
      else if (e.task.status === "cancelled") key = "cancelled";
      else key = e.task.outcome ?? "—";
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
    const taskCount = tasks.filter((t) => excluded.has(t.tenant_name)).length;
    const bugCount = bugs.filter((b) => b.solved_at && excluded.has(b.tenant_name)).length;
    return taskCount + bugCount;
  }, [tasks, bugs, excluded, showInactive]);

  async function loadMore() {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const next = await fetchTasksByStatusesPage(["completed", "cancelled"], tasks.length, PAGE);
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

  async function exportExcel() {
    setExporting(true);
    try {
      const fromIso = (dateFrom ?? new Date(0)).toISOString();
      const toIso = (dateTo ? endOfDay(dateTo) : new Date()).toISOString();

      const taskRows = filtered
        .filter((e): e is Extract<HistoryEntry, { kind: "task" }> => e.kind === "task")
        .map((e) => ({
          tenant: e.tenant,
          week: e.task.week_start,
          reason: e.task.reason,
          outcome: e.task.outcome ? outcomeLabel(e.task.outcome) : "",
          note: e.task.note ?? "",
          completed_at: e.task.completed_at ?? "",
          priority: e.task.priority,
        }));

      const log = await fetchHealthScoreLogRange(fromIso, toIso);
      const scoreRows = log.map((r) => ({
        tenant: r.tenant_name,
        previous_score: r.previous_score,
        new_score: r.new_score,
        delta: r.delta,
        reason: r.reason,
        source: r.source,
        changed_by: r.changed_by ?? "",
        created_at: r.changed_at,
      }));

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(taskRows), "Tarefas");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(scoreRows), "Histórico de Score");
      const stamp = format(new Date(), "yyyy-MM-dd");
      XLSX.writeFile(wb, `historico-cs-${stamp}.xlsx`);
      toast.success("Excel exportado");
    } catch (err) {
      console.error(err);
      toast.error("Falha ao exportar Excel");
    } finally {
      setExporting(false);
    }
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
          Tarefas concluídas e anuladas, agrupadas por clube. {tasks.length} carregada{tasks.length === 1 ? "" : "s"}{hasMore ? "" : " · fim"}.
        </p>
      </header>

      {/* Weekly digest */}
      {digest && (
        <Collapsible open={digestOpen} onOpenChange={setDigestOpen}>
          <section className="rounded-xl border border-primary/30 bg-gradient-to-br from-primary/5 to-primary/10 overflow-hidden">
            <CollapsibleTrigger asChild>
              <button className="w-full flex items-center justify-between gap-3 px-5 py-4 hover:bg-primary/5 transition-colors text-left">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-xs uppercase tracking-wide font-semibold text-primary">Resumo da semana</span>
                  <span className="text-sm text-muted-foreground hidden sm:inline">
                    {digest.totalCompleted} {digest.totalCompleted === 1 ? "tarefa" : "tarefas"} · {digest.clubsContacted} {digest.clubsContacted === 1 ? "clube" : "clubes"} · {digest.scoreChanges} {digest.scoreChanges === 1 ? "alteração de score" : "alterações de score"}
                  </span>
                </div>
                <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform shrink-0", digestOpen && "rotate-180")} />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="px-5 pb-5 grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Tarefas concluídas</div>
                  <div className="text-2xl font-semibold mt-1 tabular-nums">{digest.totalCompleted}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Clubes contactados</div>
                  <div className="text-2xl font-semibold mt-1 tabular-nums">{digest.clubsContacted}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Alterações de score</div>
                  <div className="text-2xl font-semibold mt-1 tabular-nums">{digest.scoreChanges}</div>
                </div>
                <div className="col-span-2 md:col-span-1">
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Maiores quedas</div>
                  {digest.topDrops.length === 0 ? (
                    <div className="text-xs text-muted-foreground mt-2">Sem quedas no período.</div>
                  ) : (
                    <ul className="mt-1.5 space-y-1">
                      {digest.topDrops.map((d) => (
                        <li key={d.tenant} className="flex items-center justify-between gap-2 text-xs">
                          <ClubLink name={d.tenant} className="truncate hover:underline" />
                          <span className="text-danger font-semibold tabular-nums shrink-0">{d.drop}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </CollapsibleContent>
          </section>
        </Collapsible>
      )}


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

        <button
          onClick={exportExcel}
          disabled={exporting}
          className="ml-auto inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm hover:bg-muted/50 min-h-[44px] disabled:opacity-50"
        >
          <Download className="h-4 w-4" />
          {exporting ? "A exportar…" : "Exportar Excel"}
        </button>
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
              {summary.topOutcome === "bug_solved" ? (
                <span className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium bg-primary/10 text-primary border border-primary/20">
                  Bug resolvido
                </span>
              ) : summary.topOutcome === "cancelled" ? (
                <span className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium bg-muted text-muted-foreground border border-border">
                  Anulada
                </span>
              ) : (
                <span className={cn("inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium", outcomeBadgeClass(summary.topOutcome))}>
                  {outcomeLabel(summary.topOutcome)}
                </span>
              )}
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
            {grouped.map(({ tenant, entries: list, last }) => {
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
                            <span className="md:hidden mt-2">
                              <EntryBadge entry={last} />
                            </span>
                          </div>
                        </div>
                        <div className="hidden md:flex items-center gap-3 shrink-0">
                          <EntryBadge entry={last} />
                          <span className="text-xs text-muted-foreground">
                            {format(new Date(entryTs(last)), "dd MMM yyyy", { locale: pt })}
                          </span>
                        </div>
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      {/* Mobile: stacked cards */}
                      <ul className="md:hidden px-4 pb-4 space-y-2">
                        {list.map((e) => {
                          const note = e.kind === "bug" ? e.bug.note : e.task.note;
                          const flags = e.kind === "task" ? (e.task.flags ?? []) : [];
                          return (
                            <li key={e.id} className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-2">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs text-muted-foreground">
                                  {format(new Date(entryTs(e)), "dd MMM yyyy", { locale: pt })}
                                </span>
                                <EntryBadge entry={e} className="shrink-0" />
                              </div>
                              {e.kind === "bug" && (
                                <div className="text-xs flex items-center gap-2 flex-wrap">
                                  <span className="font-medium">{e.bug.title}</span>
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground uppercase tracking-wide">
                                    {BUG_SEVERITY_LABEL[e.bug.severity]}
                                  </span>
                                  <a
                                    href={e.bug.link}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-primary hover:underline"
                                  >
                                    <ExternalLink className="h-3 w-3" /> abrir
                                  </a>
                                </div>
                              )}
                              {flags.length > 0 && (
                                <div>
                                  <span className="text-xs px-1.5 py-0.5 rounded bg-muted">{formatFlagsLabel(flags)}</span>
                                </div>
                              )}
                              {note && (
                                <p className="text-xs italic text-muted-foreground break-words">“{note}”</p>
                              )}
                            </li>
                          );
                        })}
                      </ul>

                      {/* Desktop: table */}
                      <div className="hidden md:block px-5 pb-4 overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-xs uppercase tracking-wide text-muted-foreground border-b border-border">
                              <th className="text-left font-medium py-2 pr-3 whitespace-nowrap">Data</th>
                              <th className="text-left font-medium py-2 pr-3">Detalhe</th>
                              <th className="text-left font-medium py-2 pr-3 whitespace-nowrap">Resultado</th>
                              <th className="text-left font-medium py-2">Comentário</th>
                            </tr>
                          </thead>
                          <tbody>
                            {list.map((e) => {
                              const note = e.kind === "bug" ? e.bug.note : e.task.note;
                              return (
                                <tr key={e.id} className="border-b border-border/50 last:border-0 align-top">
                                  <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground">
                                    {format(new Date(entryTs(e)), "dd MMM yyyy", { locale: pt })}
                                  </td>
                                  <td className="py-2 pr-3">
                                    {e.kind === "bug" ? (
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <span className="font-medium">{e.bug.title}</span>
                                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground uppercase tracking-wide">
                                          {BUG_SEVERITY_LABEL[e.bug.severity]}
                                        </span>
                                        <a
                                          href={e.bug.link}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                                        >
                                          <ExternalLink className="h-3 w-3" /> abrir
                                        </a>
                                      </div>
                                    ) : (
                                      <span className="text-xs px-1.5 py-0.5 rounded bg-muted">{formatFlagsLabel(e.task.flags)}</span>
                                    )}
                                  </td>
                                  <td className="py-2 pr-3 whitespace-nowrap">
                                    <EntryBadge entry={e} />
                                  </td>
                                  <td className="py-2 text-muted-foreground">
                                    {note ? <span className="italic">“{note}”</span> : <span className="text-muted-foreground/60">—</span>}
                                  </td>
                                </tr>
                              );
                            })}
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
