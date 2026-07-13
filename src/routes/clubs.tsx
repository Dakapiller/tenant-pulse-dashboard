import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ClubLink } from "@/components/ClubLink";
import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  AlertTriangle, Building2, Check, ChevronRight, Download, Eye, EyeOff, ListChecks, Plus, SlidersHorizontal, Sparkles, Star, X,
} from "lucide-react";
import { NewTaskDialog } from "@/components/NewTaskDialog";
import { AdjustScoreDialog } from "@/components/AdjustScoreDialog";
import { YoYSection } from "@/components/YoYSection";
import { HealthBadge } from "@/components/HealthBadge";
import { TaskQuickActions } from "@/components/TaskQuickActions";
import { PendingTasksFlatView, BulkActionBar, type PendingTaskFilter } from "@/components/PendingTasksPanel";
import { fetchAllSnapshots, fetchPeriods, type Snapshot } from "@/lib/data";
import {
  fetchAllCSStatuses,
  fetchAllCSTasks,
  fetchClubStatusLogs,
  fetchClubStatusLogsForTenant,
  fetchCSStatusesForTenant,
  fetchCSTasksForTenant,
  fetchPriorityMap,
  setTenantPriority,
  cancelCSTasksBatch,
  completeCSTasksBatch,
  postponeCSTask,
  excludedTenants,
  setClubStatus,
  currentClubStatus,
  currentChurnCompetitor,
  riskWithDelta,
  latestCSOutcome,
  sumCSImpact,
  lastCompletedActivityAt,
  currentWeekStart,
  outcomeLabel,
  CLUB_STATUS_LABEL,
  CLUB_STATUS_OPTIONS,
  COMPETITOR_OPTIONS,
  type CSTenantStatus,
  type CSTask,
  type ClubStatus,
  type ClubStatusLog,
} from "@/lib/cs";
import { computeRiskWithCS, FLAG_META, type RiskFlag } from "@/lib/risk";
import { fetchHealthScores, fetchHealthLog } from "@/lib/health";
import { formatEuro, formatNumber, formatPercent, periodLabel } from "@/lib/format";
import { DataTable, ScoreDelta, type ColumnDef } from "@/components/DataTable";
import { relativeLabelPT, relativeColorClass, activityColorClass, absoluteLabel } from "@/lib/relativeTime";
import { LineChart, Line, ResponsiveContainer } from "recharts";

export const Route = createFileRoute("/clubs")({
  validateSearch: (s: Record<string, unknown>): { tenant?: string; level?: "high" | "medium" | "healthy"; q?: string } => ({
    tenant: typeof s.tenant === "string" ? s.tenant : undefined,
    level: s.level === "high" || s.level === "medium" || s.level === "healthy" ? s.level : undefined,
    q: typeof s.q === "string" ? s.q : undefined,
  }),
  component: ClubsPage,
});

interface ClubRow {
  name: string;
  latest: Snapshot | null;
  history: Snapshot[];
  statuses: CSTenantStatus[];
  tasks: CSTask[];
  statusLogs: ClubStatusLog[];
  status: ClubStatus;
  competitor: string | null;
  score: number;
  prevScore: number | null;
  scoreDelta: number | null;
  level: "high" | "medium" | "healthy";
  csImpact: number;
  lastActivity: string | null;
  pending: number;
  pendingThisWeek: number;
  overdue: number;
  missingFromLatest: boolean;
  isNew: boolean;
  firstSeen: string | null;
  flagsCurrent: string[];
  flagsAdded: string[];
  flagsResolved: string[];
  csOutcome: { outcome: string; recordedAt: string } | null;
  isPriority: boolean;
}

function ClubsPage() {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [periods, setPeriods] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<CSTenantStatus[]>([]);
  const [tasks, setTasks] = useState<CSTask[]>([]);
  const [statusLogs, setStatusLogs] = useState<ClubStatusLog[]>([]);
  const [healthScores, setHealthScores] = useState<Map<string, number>>(new Map());
  const [priorityMap, setPriorityMap] = useState<Map<string, boolean>>(new Map());
  const [loading, setLoading] = useState(true);

  const [drawerTenant, setDrawerTenant] = useState<string | null>(null);
  const navigate = useNavigate();
  const search = useSearch({ from: "/clubs" });

  // Sync ?tenant=… search param into the drawer
  useEffect(() => {
    if (search.tenant) setDrawerTenant(search.tenant);
    else setDrawerTenant(null);
  }, [search.tenant]);

  const closeDrawer = () => {
    navigate({ to: "/clubs", search: { tenant: undefined } });
  };

  const [exportOpen, setExportOpen] = useState(false);
  const [editingTenant, setEditingTenant] = useState<string | null>(null);
  const [expandedTenant, setExpandedTenant] = useState<string | null>(null);
  const [inlineScoreTenant, setInlineScoreTenant] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [missingOpen, setMissingOpen] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [filterNewOnly, setFilterNewOnly] = useState(false);
  const [filterPendingOnly, setFilterPendingOnly] = useState(false);
  const [bulkScoreOpen, setBulkScoreOpen] = useState(false);
  const [pendingPanelOpen, setPendingPanelOpen] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [pendingTaskFilter, setPendingTaskFilter] = useState<PendingTaskFilter>("all");

  async function loadAll() {
    const [s, p, sts, tks, logs, scores, prio] = await Promise.all([
      fetchAllSnapshots(), fetchPeriods(), fetchAllCSStatuses(), fetchAllCSTasks(), fetchClubStatusLogs(), fetchHealthScores(), fetchPriorityMap(),
    ]);
    setSnapshots(s); setPeriods(p); setStatuses(sts); setTasks(tks); setStatusLogs(logs); setHealthScores(scores); setPriorityMap(prio);
  }

  useEffect(() => {
    (async () => {
      try { await loadAll(); } finally { setLoading(false); }
    })();
  }, []);

  const latestPeriod = periods[0];
  const weekStart = useMemo(() => currentWeekStart(), []);

  const rows: ClubRow[] = useMemo(() => {
    const histByTenant = new Map<string, Snapshot[]>();
    snapshots.forEach((s) => {
      if (!histByTenant.has(s.tenant_name)) histByTenant.set(s.tenant_name, []);
      histByTenant.get(s.tenant_name)!.push(s);
    });
    const stsByTenant = new Map<string, CSTenantStatus[]>();
    statuses.forEach((s) => {
      if (!stsByTenant.has(s.tenant_name)) stsByTenant.set(s.tenant_name, []);
      stsByTenant.get(s.tenant_name)!.push(s);
    });
    const tasksByTenant = new Map<string, CSTask[]>();
    tasks.forEach((t) => {
      if (!tasksByTenant.has(t.tenant_name)) tasksByTenant.set(t.tenant_name, []);
      tasksByTenant.get(t.tenant_name)!.push(t);
    });
    const logsByTenant = new Map<string, ClubStatusLog[]>();
    statusLogs.forEach((l) => {
      if (!logsByTenant.has(l.tenant_name)) logsByTenant.set(l.tenant_name, []);
      logsByTenant.get(l.tenant_name)!.push(l);
    });

    const result: ClubRow[] = [];
    for (const [name, hist] of histByTenant) {
      const sorted = [...hist].sort((a, b) => a.period.localeCompare(b.period));
      const latest = sorted[sorted.length - 1] ?? null;
      const sts = stsByTenant.get(name) ?? [];
      const tks = tasksByTenant.get(name) ?? [];
      const rd = riskWithDelta(sorted, sts, healthScores.get(name) ?? null, null);
      const status = currentClubStatus(sts);
      const competitor = currentChurnCompetitor(sts);
      const pendingThisWeek = tks.filter((t) => t.status === "pending" && t.week_start === weekStart).length;
      const overdue = tks.filter((t) => t.status === "pending" && t.week_start < weekStart).length;
      const pending = pendingThisWeek + overdue;
      const missing = !!latestPeriod && !sorted.some((s) => s.period === latestPeriod);
      const firstSeen = sorted[0]?.period ?? null;
      const isNew = !!latestPeriod && firstSeen === latestPeriod && sorted.length === 1;
      const csOut = latestCSOutcome(sts);
      result.push({
        name, latest, history: sorted, statuses: sts, tasks: tks, statusLogs: logsByTenant.get(name) ?? [],
        status, competitor, score: rd.score, prevScore: rd.prevScore, scoreDelta: rd.delta, level: rd.level,
        csImpact: sumCSImpact(sts),
        lastActivity: lastCompletedActivityAt(tks),
        pending, pendingThisWeek, overdue, missingFromLatest: missing,
        isNew, firstSeen,
        flagsCurrent: rd.flags.current, flagsAdded: rd.flags.added, flagsResolved: rd.flags.resolved,
        csOutcome: csOut,
        isPriority: priorityMap.get(name) ?? false,
      });
    }
    return result;
  }, [snapshots, statuses, tasks, statusLogs, weekStart, latestPeriod, healthScores, priorityMap]);

  const isInactive = (s: ClubStatus) => s === "churned" || s === "closed" || s === "changed_owner";
  const missingCount = rows.filter((r) => r.missingFromLatest && !isInactive(r.status)).length;
  const newCount = rows.filter((r) => r.isNew).length;
  const inactiveCount = rows.filter((r) => isInactive(r.status)).length;
  const pendingCount = rows.filter((r) => r.pending > 0 && !isInactive(r.status)).length;
  const visibleRows = useMemo(() => {
    let r = showInactive ? rows : rows.filter((x) => !isInactive(x.status));
    if (filterNewOnly) r = r.filter((x) => x.isNew);
    if (filterPendingOnly) r = r.filter((x) => x.pending > 0);
    if (search.level) r = r.filter((x) => x.level === search.level);
    return r;
  }, [rows, showInactive, filterNewOnly, filterPendingOnly, search.level]);

  async function handleStatusChange(tenant: string, current: ClubStatus, next: ClubStatus, competitor: string | null) {
    if (next === "churned" && current !== "churned") {
      const ok = window.confirm(
        `Tens a certeza que queres marcar "${tenant}" como Em Churn?\n\nEsta ação remove o clube das métricas agregadas (KPIs, gráficos e cálculos de risco).`,
      );
      if (!ok) return;
    }
    await setClubStatus(tenant, next, current, null, "cs", competitor);
    await loadAll();
    setEditingTenant(null);
  }

  if (loading) return <div className="p-10 text-muted-foreground">A carregar…</div>;

  return (
    <div className="p-4 sm:p-6 lg:p-8 pb-24 md:pb-8 max-w-[1500px] mx-auto">
      <header className="mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Building2 className="h-6 w-6" /> Clubes
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Controlo central de todos os clubes — saúde, atividade CS e ciclo de vida.</p>
        </div>
        <button
          onClick={() => setExportOpen(true)}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-foreground text-background px-4 min-h-11 sm:min-h-9 text-sm font-medium hover:opacity-90 w-full sm:w-auto"
        >
          <Download className="h-4 w-4" /> Exportar
        </button>
      </header>

      {missingCount > 0 && (
        <button
          onClick={() => setMissingOpen(true)}
          className="w-full mb-5 rounded-lg border border-warning/40 bg-warning/10 hover:bg-warning/15 hover:border-warning/60 transition-colors p-4 flex items-start gap-3 text-left cursor-pointer"
        >
          <AlertTriangle className="h-5 w-5 text-warning shrink-0 mt-0.5" />
          <div className="text-sm flex-1">
            <div className="font-medium text-warning flex items-center gap-1.5">
              {missingCount} {missingCount === 1 ? "clube em falta" : "clubes em falta"} no último carregamento — clique para rever
              <ChevronRight className="h-4 w-4" />
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Estes clubes existiam em períodos anteriores mas estão ausentes em {latestPeriod ? periodLabel(latestPeriod) : "—"}. Confirme o estado de cada um.
            </div>
          </div>
        </button>
      )}

      {newCount > 0 && (
        <button
          onClick={() => setFilterNewOnly((v) => !v)}
          className={`w-full mb-5 rounded-lg border p-4 flex items-start gap-3 text-left transition-colors ${filterNewOnly ? "border-success bg-success/15" : "border-success/40 bg-success/10 hover:bg-success/15"}`}
        >
          <Sparkles className="h-5 w-5 text-success shrink-0 mt-0.5" />
          <div className="text-sm flex-1">
            <div className="font-medium text-success">
              {newCount} {newCount === 1 ? "novo clube" : "novos clubes"} em {latestPeriod ? periodLabel(latestPeriod) : "—"}
              {filterNewOnly && <span className="ml-2 text-xs font-normal">· filtro ativo (clique para limpar)</span>}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {filterNewOnly ? "A mostrar apenas novos clubes." : "Apareceram pela primeira vez no último carregamento. Clique para filtrar a lista."}
            </div>
          </div>
        </button>
      )}

      <section className="rounded-xl border border-border bg-background overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between text-xs text-muted-foreground gap-3 flex-wrap">
          <span>
            {visibleRows.length} {visibleRows.length === 1 ? "clube" : "clubes"}
            {!showInactive && inactiveCount > 0 && (
              <span className="ml-1 text-muted-foreground/70">
                · {inactiveCount} ocultos (em churn / fechados)
              </span>
            )}
          </span>
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={() => setPendingPanelOpen((v) => !v)}
              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors ${pendingPanelOpen ? "border-foreground bg-foreground text-background" : "border-border hover:bg-surface"}`}
              title="Ver e gerir tarefas pendentes em massa"
            >
              <ListChecks className="h-3.5 w-3.5" />
              {pendingPanelOpen ? "Ocultar tarefas pendentes" : "Ver tarefas pendentes"}
            </button>
            {pendingCount > 0 && (
              <button
                onClick={() => setFilterPendingOnly((v) => !v)}
                className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors ${filterPendingOnly ? "border-warning bg-warning/15 text-warning" : "border-border hover:bg-surface"}`}
                title="Mostrar apenas clubes com tarefas pendentes (incluindo atrasadas)"
              >
                <AlertTriangle className="h-3.5 w-3.5" />
                {filterPendingOnly ? "A filtrar pendentes" : `Apenas com pendentes (${pendingCount})`}
              </button>
            )}
            {inactiveCount > 0 && (
              <button
                onClick={() => setShowInactive((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-surface"
                title={showInactive ? "Ocultar clubes em churn e fechados" : "Mostrar clubes em churn e fechados"}
              >
                {showInactive ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {showInactive ? "Ocultar inativos" : "Mostrar inativos"}
              </button>
            )}
          </div>
        </div>
        <DataTable<ClubRow>
          rows={visibleRows}
          rowKey={(r) => r.name}
          defaultSort={{ key: "name", dir: "asc" }}
          stickyHeader
          pageSize={50}
          containerClassName="max-h-[700px]"
          rowClassName={(r) => expandedTenant === r.name ? "bg-surface/40" : r.isNew ? "bg-success/5" : r.missingFromLatest ? "bg-warning/5" : ""}
          onRowClick={(r) => setExpandedTenant(expandedTenant === r.name ? null : r.name)}
          expandedRow={(r) => expandedTenant === r.name ? <ClubHistoryPanel row={r} onChanged={loadAll} /> : null}
          emptyMessage="Sem clubes."
          selectable
          selectedKeys={selectedKeys}
          onSelectionChange={setSelectedKeys}
          columns={[
            {
              key: "priority",
              header: "",
              align: "center",
              sortable: false,
              render: (r) => (
                <button
                  type="button"
                  title="Clube prioritário — recebe tarefa semanal automática independentemente do health score. Útil para clubes de alto GMV ou com potencial de crescimento."
                  aria-label={r.isPriority ? "Remover prioridade" : "Marcar como prioritário"}
                  onClick={async (e) => {
                    e.stopPropagation();
                    const next = !r.isPriority;
                    // Optimistic toggle.
                    setPriorityMap((m) => { const n = new Map(m); n.set(r.name, next); return n; });
                    try {
                      await setTenantPriority(r.name, next);
                    } catch {
                      // Revert on failure.
                      setPriorityMap((m) => { const n = new Map(m); n.set(r.name, !next); return n; });
                    }
                  }}
                  className="p-1 rounded hover:bg-surface"
                >
                  <Star
                    className={`h-4 w-4 ${r.isPriority ? "fill-warning text-warning" : "text-muted-foreground/40"}`}
                  />
                </button>
              ),
            },
            {
              key: "name",
              header: "Clube",
              mobilePrimary: true,
              sortValue: (r) => r.name,
              filterValue: (r) => r.name,
              filter: { kind: "text" },
              render: (r) => (
                <>
                  <ClubLink name={r.name} />
                  {r.isNew && (
                    <span className="ml-2 inline-flex items-center gap-1 text-[10px] uppercase font-semibold text-success bg-success/10 px-1.5 py-0.5 rounded-full">
                      <Sparkles className="h-2.5 w-2.5" /> Novo
                    </span>
                  )}
                  {r.missingFromLatest && <span className="ml-2 text-[10px] uppercase text-warning font-semibold">Em falta</span>}
                </>
              ),
            },
            { key: "games", header: "Jogos", align: "right", hideOnMobile: true, sortValue: (r) => r.latest?.games_online ?? null, render: (r) => r.latest ? formatNumber(r.latest.games_online) : "—" },
            { key: "gmv", header: "GMV", align: "right", sortValue: (r) => r.latest?.gmv_all ?? null, render: (r) => r.latest ? formatEuro(r.latest.gmv_all) : "—" },
            { key: "revenue", header: "Receita", align: "right", hideOnMobile: true, sortValue: (r) => r.latest?.revenue ?? null, render: (r) => r.latest ? formatEuro(r.latest.revenue) : "—" },
            { key: "rate", header: "Taxa", align: "right", hideOnMobile: true, sortValue: (r) => r.latest?.transacted_rate ?? null, render: (r) => r.latest ? formatPercent(r.latest.transacted_rate) : "—" },
            {
              key: "score",
              header: "Saúde",
              mobileSecondary: true,
              mobileLabel: "Saúde",
              align: "center",
              sortValue: (r) => r.score,
              filter: { kind: "select", options: [
                { value: "high", label: "Alto" }, { value: "medium", label: "Médio" }, { value: "healthy", label: "Saudável" },
              ]},
              filterValue: (r) => r.level,
              render: (r) => {
                const healthColor = r.score < 30 ? "text-danger bg-danger/10" : r.score < 60 ? "text-warning bg-warning/15" : "text-success bg-success/10";
                return (
                  <ScoreTooltip row={r}>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setInlineScoreTenant(r.name); }}
                      title="Ajustar score manualmente"
                      className="inline-flex items-center gap-1.5 cursor-pointer hover:opacity-80"
                    >
                      <span className={`inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${healthColor}`}>{r.score}</span>
                      <ScoreDelta delta={r.scoreDelta} previous={r.prevScore} current={r.score} />
                    </button>
                  </ScoreTooltip>
                );
              },
            },
            {
              key: "csImpact",
              header: "CS Δ",
              align: "center",
              hideOnMobile: true,
              sortValue: (r) => r.csImpact,
              render: (r) => {
                const impactColor = r.csImpact > 0 ? "text-danger" : r.csImpact < 0 ? "text-success" : "text-muted-foreground";
                return (
                  <span className={`text-xs font-semibold tabular-nums ${impactColor}`}>
                    {r.csImpact > 0 ? `+${r.csImpact}` : r.csImpact < 0 ? r.csImpact : "—"}
                  </span>
                );
              },
            },
            {
              key: "lastActivity",
              header: "Última atividade",
              hideOnMobile: true,
              sortValue: (r) => r.lastActivity ?? "",
              render: (r) => <span className="text-xs text-muted-foreground">{r.lastActivity ? new Date(r.lastActivity).toLocaleDateString("pt-PT") : "Nunca"}</span>,
            },
            {
              key: "pending",
              header: "Pendentes",
              align: "center",
              sortValue: (r) => r.pending,
              render: (r) => r.pending > 0 ? (
                <span
                  title={`${r.pendingThisWeek} desta semana${r.overdue > 0 ? `, ${r.overdue} atrasada${r.overdue === 1 ? "" : "s"}` : ""}`}
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${r.overdue > 0 ? "bg-danger/15 text-danger" : "bg-warning/15 text-warning"}`}
                >
                  {r.pending}
                  {r.overdue > 0 && <span className="text-[10px]">⚠</span>}
                </span>
              ) : <span className="text-success">✓</span>,
            },
            {
              key: "status",
              header: "Estado",
              mobileSecondary: true,
              mobileLabel: "Estado",
              sortValue: (r) => CLUB_STATUS_LABEL[r.status],
              filter: { kind: "select", options: CLUB_STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label })) },
              filterValue: (r) => r.status,
              render: (r) => editingTenant === r.name ? (
                <InlineStatusEditor
                  current={r.status}
                  competitor={r.competitor}
                  onCancel={() => setEditingTenant(null)}
                  onSave={(next, comp) => handleStatusChange(r.name, r.status, next, comp)}
                />
              ) : (
                <button onClick={(e) => { e.stopPropagation(); setEditingTenant(r.name); }} className="text-left">
                  <ClubStatusBadge status={r.status} competitor={r.competitor} />
                </button>
              ),
            },
            {
              key: "expand",
              header: "",
              align: "right",
              sortable: false,
              render: (r) => <ChevronRight className={`h-4 w-4 inline transition-transform ${expandedTenant === r.name ? "rotate-90" : ""}`} />,
            },
          ]}
        />
      </section>

      {drawerTenant && rows.find((r) => r.name === drawerTenant) && (
        <ClubDrawer
          tenant={drawerTenant}
          row={rows.find((r) => r.name === drawerTenant)!}
          onClose={closeDrawer}
          onChanged={loadAll}
        />
      )}

      {exportOpen && (
        <ExportModal
          rows={rows}
          onClose={() => setExportOpen(false)}
        />
      )}

      {missingOpen && (
        <MissingClubsModal
          rows={rows.filter((r) => r.missingFromLatest && r.status !== "churned" && r.status !== "closed" && r.status !== "changed_owner")}
          onApply={async (names, next, competitor) => {
            if (next === "churned") {
              const toChurn = names.filter((n) => {
                const r = rows.find((x) => x.name === n);
                return r && r.status !== "churned";
              });
              if (toChurn.length > 0) {
                const ok = window.confirm(
                  `Tens a certeza que queres marcar ${toChurn.length} ${toChurn.length === 1 ? "clube" : "clubes"} como Em Churn?\n\nEsta ação remove-os das métricas agregadas.`,
                );
                if (!ok) return;
              }
            }
            for (const name of names) {
              const r = rows.find((x) => x.name === name);
              if (!r) continue;
              await setClubStatus(name, next, r.status, null, "cs", competitor);
            }
            await loadAll();
          }}
          onClose={() => setMissingOpen(false)}
        />
      )}

      {selectedKeys.size > 0 && (
        <BulkStatusBar
          count={selectedKeys.size}
          onApply={async (next, competitor) => {
            const names = Array.from(selectedKeys);
            if (next === "churned") {
              const toChurn = names.filter((n) => {
                const r = rows.find((x) => x.name === n);
                return r && r.status !== "churned";
              });
              if (toChurn.length > 0) {
                const ok = window.confirm(
                  `Tens a certeza que queres marcar ${toChurn.length} ${toChurn.length === 1 ? "clube" : "clubes"} como Em Churn?\n\nEsta ação remove-os das métricas agregadas.`,
                );
                if (!ok) return;
              }
            }
            for (const name of names) {
              const r = rows.find((x) => x.name === name);
              if (!r) continue;
              await setClubStatus(name, next, r.status, null, "cs", competitor);
            }
            setSelectedKeys(new Set());
            await loadAll();
          }}
          onAdjustScore={() => setBulkScoreOpen(true)}
          onCancel={() => setSelectedKeys(new Set())}
        />
      )}

      <AdjustScoreDialog
        open={bulkScoreOpen}
        mode="bulk"
        tenants={Array.from(selectedKeys).map((name) => {
          const r = rows.find((x) => x.name === name);
          return { name, score: r?.score ?? 0 };
        })}
        onClose={() => setBulkScoreOpen(false)}
        onApplied={async () => { setSelectedKeys(new Set()); await loadAll(); }}
      />

      {inlineScoreTenant && (() => {
        const r = rows.find((x) => x.name === inlineScoreTenant);
        if (!r) return null;
        return (
          <AdjustScoreDialog
            open
            mode="single"
            tenant={r.name}
            currentScore={r.score}
            onClose={() => setInlineScoreTenant(null)}
            onApplied={async () => { setInlineScoreTenant(null); await loadAll(); }}
          />
        );
      })()}
    </div>
  );
}

function Filter({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { v: string; l: string }[] }) {
  return (
    <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="px-2 py-1.5 rounded-md border border-border bg-background text-xs">
        {options.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
    </label>
  );
}

function InlineStatusEditor({
  current, competitor, onCancel, onSave,
}: {
  current: ClubStatus;
  competitor: string | null;
  onCancel: () => void;
  onSave: (next: ClubStatus, competitor: string | null) => void | Promise<void>;
}) {
  const [next, setNext] = useState<ClubStatus>(current);
  const [comp, setComp] = useState<string>(competitor ?? COMPETITOR_OPTIONS[0].value);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onCancel();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onCancel]);

  return (
    <div ref={ref} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background p-1 shadow-sm">
      <select
        value={next}
        onChange={(e) => setNext(e.target.value as ClubStatus)}
        className="px-2 py-1 rounded text-xs border border-border bg-background"
        autoFocus
      >
        {CLUB_STATUS_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {next === "churned" && (
        <select
          value={comp}
          onChange={(e) => setComp(e.target.value)}
          className="px-2 py-1 rounded text-xs border border-border bg-background"
        >
          {COMPETITOR_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      )}
      <button
        onClick={() => onSave(next, next === "churned" ? comp : null)}
        className="p-1 rounded bg-foreground text-background hover:opacity-90"
        aria-label="Confirmar"
      >
        <Check className="h-3 w-3" />
      </button>
    </div>
  );
}

function ClubStatusBadge({ status, competitor }: { status: ClubStatus; competitor?: string | null }) {
  const map: Record<ClubStatus, { bg: string; text: string }> = {
    active: { bg: "bg-success/10", text: "text-success" },
    possible_churn: { bg: "bg-warning/15", text: "text-warning" },
    churned: { bg: "bg-danger/10", text: "text-danger" },
    closed: { bg: "bg-muted", text: "text-muted-foreground" },
    changed_owner: { bg: "bg-accent", text: "text-accent-foreground" },
  };
  const m = map[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${m.bg} ${m.text}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {CLUB_STATUS_LABEL[status]}
      {status === "churned" && competitor && (
        <span className="ml-1 opacity-70">· {competitor}</span>
      )}
    </span>
  );
}

function periodEndIso(period: string): string {
  const d = new Date(period);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 23, 59, 59)).toISOString();
}

interface ScoreChangeEvent {
  period: string;
  oldScore: number;
  newScore: number;
  delta: number;
  reasons: string[];
}

function scoreChangeEvents(row: ClubRow): ScoreChangeEvent[] {
  const sorted = [...row.history].sort((a, b) => a.period.localeCompare(b.period));
  let prevScore: number | null = null;
  let prevFlagSet = new Set<string>();
  let prevCsMod = 0;
  const events: ScoreChangeEvent[] = [];
  sorted.forEach((snapshot, index) => {
    const statusesUntilPeriod = row.statuses.filter((s) => !s.recorded_at || s.recorded_at <= periodEndIso(snapshot.period));
    const r = computeRiskWithCS(sorted.slice(0, index + 1), statusesUntilPeriod);
    const current = r.score;
    if (prevScore !== null && prevScore !== current) {
      const reasons: string[] = [];
      // Flags added
      r.flagDetails.forEach((d) => {
        if (!prevFlagSet.has(d.flag)) reasons.push(d.reason);
      });
      // Flags resolved
      const curFlags = new Set(r.flagDetails.map((d) => d.flag));
      prevFlagSet.forEach((f) => {
        if (!curFlags.has(f as RiskFlag)) reasons.push(`Recuperado: ${FLAG_META[f as RiskFlag]?.label ?? f}`);
      });
      // CS modifier change
      const csMod = r.csModifier ?? 0;
      if (csMod !== prevCsMod) {
        const diff = csMod - prevCsMod;
        reasons.push(`Variação CS: ${diff > 0 ? "+" : ""}${diff} pts`);
      }
      events.push({ period: snapshot.period, oldScore: prevScore, newScore: current, delta: current - prevScore, reasons });
    }
    prevScore = current;
    prevFlagSet = new Set(r.flagDetails.map((d) => d.flag));
    prevCsMod = r.csModifier ?? 0;
  });
  const latestMonthlyScore = prevScore;
  if (row.prevScore !== null && row.scoreDelta !== null && row.scoreDelta !== 0 && latestMonthlyScore !== row.score) {
    events.push({ period: "Atual", oldScore: row.prevScore, newScore: row.score, delta: row.scoreDelta, reasons: [] });
  }
  return events;
}

function ScoreChangeLine({ oldScore, newScore, delta }: { oldScore: number; newScore: number; delta: number }) {
  const improving = delta < 0;
  return (
    <span className={`font-semibold tabular-nums ${improving ? "text-success" : "text-danger"}`}>
      {improving ? "▼" : "▲"} {Math.abs(delta)} pts · {oldScore} → {newScore}
    </span>
  );
}

function ClubHistoryPanel({ row, onChanged }: { row: ClubRow; onChanged?: () => void | Promise<void> }) {
  // Memoize per-snapshot risk recomputation; expensive for tenants with long history.
  const scoreEventsRaw = useMemo(() => scoreChangeEvents(row), [row]);

  const taskEvents = row.tasks
    .filter((t) => t.status === "completed" && t.completed_at)
    .map((t) => ({
      at: t.completed_at!,
      type: "Tarefa CS",
      title: t.reason,
      meta: `${outcomeLabel(t.outcome)}${t.note ? ` · “${t.note}”` : ""}`,
      score: null as { oldScore: number; newScore: number; delta: number } | null,
      reasons: [] as string[],
    }));
  const statusEvents = row.statusLogs.map((l) => ({
    at: l.changed_at,
    type: "Estado",
    title: `${CLUB_STATUS_LABEL[l.previous_status as ClubStatus] ?? l.previous_status} → ${CLUB_STATUS_LABEL[l.new_status as ClubStatus] ?? l.new_status}`,
    meta: l.note ? `“${l.note}”` : "",
    score: null as { oldScore: number; newScore: number; delta: number } | null,
    reasons: [] as string[],
  }));
  const scoreEvents = scoreEventsRaw.map((s) => ({
    at: s.period === "Atual" ? new Date().toISOString() : periodEndIso(s.period),
    type: "Score",
    title: s.period === "Atual" ? "Variação atual do score" : `Variação em ${periodLabel(s.period)}`,
    meta: "",
    score: { oldScore: s.oldScore, newScore: s.newScore, delta: s.delta },
    reasons: s.reasons,
  }));
  const events = [...taskEvents, ...statusEvents, ...scoreEvents].sort((a, b) => b.at.localeCompare(a.at));

  const pendingTasks = row.tasks.filter((t) => t.status === "pending");

  return (
    <div className="rounded-md border border-border bg-background p-3 space-y-3">
      {pendingTasks.length > 0 && (
        <div className="rounded-md border border-warning/40 bg-warning/5 p-3">
          <div className="text-[11px] uppercase tracking-wide text-warning font-semibold mb-2">
            Tarefas pendentes · {pendingTasks.length}
          </div>
          <ul className="space-y-3">
            {pendingTasks.map((t) => (
              <li key={t.id} className="text-xs space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{t.reason}</span>
                  <span className={`shrink-0 ${relativeColorClass(t.week_start)}`} title={absoluteLabel(t.week_start)}>{relativeLabelPT(t.week_start)}</span>
                </div>
                <div className="text-muted-foreground">CTA: {t.cta}</div>
                <TaskQuickActions task={t} onChanged={onChanged} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {events.length === 0 ? (
        <div className="text-xs text-muted-foreground">Sem histórico registado.</div>
      ) : (
        <ul className="divide-y divide-border">
          {events.map((event, index) => (
            <li key={`${event.at}-${event.type}-${index}`} className="py-2.5 text-xs flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] uppercase text-muted-foreground">{event.type}</span>
                  <span className="font-medium">{event.title}</span>
                </div>
                {event.score ? (
                  <div className="mt-1 space-y-1">
                    <ScoreChangeLine {...event.score} />
                    {event.reasons.length > 0 && (
                      <ul className="ml-1 mt-1 space-y-0.5 text-muted-foreground">
                        {event.reasons.map((r, i) => (
                          <li key={i} className="flex gap-1.5"><span>•</span><span>{r}</span></li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : event.meta ? (
                  <div className="mt-1 text-muted-foreground">{event.meta}</div>
                ) : null}
              </div>
              <span className="shrink-0 text-muted-foreground tabular-nums">{new Date(event.at).toLocaleString("pt-PT")}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------- Drawer ----------

function ClubDrawer({ tenant, row, onClose, onChanged }: { tenant: string; row: ClubRow; onClose: () => void; onChanged?: () => Promise<void> }) {
  const [tenantTasks, setTenantTasks] = useState<CSTask[]>([]);
  const [taskOpen, setTaskOpen] = useState(false);
  const [scoreOpen, setScoreOpen] = useState(false);

  async function reload() {
    const tks = await fetchCSTasksForTenant(tenant);
    setTenantTasks(tks);
  }

  useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tenant]);

  const completedTasks = tenantTasks.filter((t) => t.status === "completed");
  const pendingTasks = tenantTasks.filter((t) => t.status === "pending");

  const lastActivity = completedTasks
    .map((t) => t.completed_at)
    .filter((x): x is string => !!x)
    .sort()
    .pop();

  return (
    <div className="fixed inset-0 z-50 flex md:justify-end" onMouseDown={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-full md:max-w-3xl h-full bg-background md:border-l border-border shadow-xl overflow-y-auto animate-in slide-in-from-bottom md:slide-in-from-right duration-200"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-background border-b border-border px-4 sm:px-6 py-4 flex items-center justify-between gap-2 z-10">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold truncate">{tenant}</h2>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <ClubStatusBadge status={row.status} competitor={row.competitor} />
              {pendingTasks.length > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 text-warning text-[11px] font-semibold px-2 py-0.5">
                  {pendingTasks.length} {pendingTasks.length === 1 ? "tarefa pendente" : "tarefas pendentes"}
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="inline-flex items-center justify-center h-11 w-11 rounded hover:bg-surface shrink-0" aria-label="Fechar"><X className="h-5 w-5" /></button>
        </div>

        <div className="p-6 space-y-6">
          <section className="rounded-lg border border-border p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Score de saúde</div>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="text-3xl font-bold tabular-nums">{row.score}</div>
              <HealthBadge score={row.score} showScore={false} />
              {lastActivity ? (
                <span className={`text-[11px] font-medium ${activityColorClass(lastActivity)}`} title={absoluteLabel(lastActivity)}>
                  última actividade {relativeLabelPT(lastActivity)}
                </span>
              ) : (
                <span className="text-[11px] font-medium text-danger">sem actividade registada</span>
              )}
            </div>
          </section>

          <YoYSection history={row.history} />

          {pendingTasks.length > 0 && (
            <section className="rounded-lg border border-warning/40 bg-warning/5 overflow-hidden">
              <div className="px-4 py-2.5 border-b border-warning/30 text-sm font-medium text-warning flex items-center justify-between">
                <span>Tarefas pendentes</span>
                <span className="text-xs font-normal">{pendingTasks.length}</span>
              </div>
              <ul className="divide-y divide-warning/20">
                {pendingTasks
                  .slice()
                  .sort((a, b) => a.week_start.localeCompare(b.week_start))
                  .map((t) => (
                    <li key={t.id} className="px-4 py-3 text-xs">
                      <div className="flex items-center justify-between gap-3">
                        <span className={relativeColorClass(t.week_start)} title={absoluteLabel(t.week_start)}>{relativeLabelPT(t.week_start)}</span>
                        <span className={`text-[10px] uppercase font-semibold rounded-full px-1.5 py-0.5 ${t.priority >= 80 ? "bg-danger/15 text-danger" : t.priority >= 50 ? "bg-warning/15 text-warning" : "bg-surface text-muted-foreground"}`}>
                          {t.priority >= 80 ? "Alta" : t.priority >= 50 ? "Média" : "Baixa"}
                        </span>
                      </div>
                      <div className="mt-1 font-medium whitespace-pre-line">{t.reason}</div>
                      <div className="text-muted-foreground mt-0.5 whitespace-pre-line">CTA: {t.cta}</div>
                      <div className="mt-2">
                        <TaskQuickActions task={t} onChanged={async () => { await reload(); await onChanged?.(); }} />
                      </div>
                    </li>
                  ))}
              </ul>
            </section>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border">
            <button
              onClick={() => setTaskOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 h-10 text-sm font-medium hover:bg-surface"
            >
              <Plus className="h-4 w-4" /> Tarefa
            </button>
            <button
              onClick={() => setScoreOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 h-10 text-sm font-medium hover:bg-surface"
            >
              <SlidersHorizontal className="h-4 w-4" /> Score
            </button>
            <Link
              to="/tenant/$name"
              params={{ name: tenant }}
              className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-foreground text-background px-3 h-10 text-sm font-medium hover:opacity-90"
            >
              Abrir página completa
            </Link>
          </div>
        </div>
      </div>

      <NewTaskDialog
        open={taskOpen}
        onClose={() => setTaskOpen(false)}
        tenant={tenant}
        onCreated={async () => { await reload(); await onChanged?.(); }}
      />
      <AdjustScoreDialog
        open={scoreOpen}
        mode="single"
        tenant={tenant}
        currentScore={row.score}
        onClose={() => setScoreOpen(false)}
        onApplied={async () => { await reload(); await onChanged?.(); }}
      />
    </div>
  );
}

function Delta({ v }: { v: number | null }) {
  if (v === null) return <span className="text-muted-foreground">—</span>;
  const positive = v >= 0;
  return (
    <span className={`tabular-nums text-[11px] font-medium ${positive ? "text-success" : "text-danger"}`}>
      {positive ? "▲" : "▼"} {Math.abs(v).toFixed(1)}%
    </span>
  );
}

// ---------- Export modal ----------

type ExportFormat = "xlsx" | "csv" | "pdf";
type ExportPeriod = "daily" | "weekly" | "monthly" | "yearly";

function ExportModal({ rows, onClose }: { rows: ClubRow[]; onClose: () => void }) {
  const [period, setPeriod] = useState<ExportPeriod>("monthly");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [scope, setScope] = useState<"all" | "selected">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [format, setFormat] = useState<ExportFormat>("xlsx");
  const [includePerf, setIncludePerf] = useState(true);
  const [includeCS, setIncludeCS] = useState(true);
  const [includeStatus, setIncludeStatus] = useState(true);
  const [busy, setBusy] = useState(false);

  function toggle(name: string) {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name); else next.add(name);
    setSelected(next);
  }

  async function generate() {
    setBusy(true);
    try {
      const targetRows = scope === "all" ? rows : rows.filter((r) => selected.has(r.name));
      const dateNow = new Date().toISOString().slice(0, 10);
      const baseName = `tenant-pulse-export-${period}-${dateNow}`;

      const perfRows: Record<string, unknown>[] = [];
      const csRows: Record<string, unknown>[] = [];
      const statusRows: Record<string, unknown>[] = [];
      const allLogs = await fetchClubStatusLogs();
      const logsByTenant = new Map<string, ClubStatusLog[]>();
      allLogs.forEach((l) => {
        if (!logsByTenant.has(l.tenant_name)) logsByTenant.set(l.tenant_name, []);
        logsByTenant.get(l.tenant_name)!.push(l);
      });

      const inRange = (iso: string) => {
        if (from && iso < from) return false;
        if (to && iso > to) return false;
        return true;
      };

      targetRows.forEach((r) => {
        if (includePerf) {
          r.history.filter((s) => inRange(s.period)).forEach((s) => {
            perfRows.push({
              Clube: r.name,
              Periodo: s.period,
              "Jogos Online": s.games_online,
              "GMV Jogos": s.gmv_games,
              "GMV Total": s.gmv_all,
              "Receita": s.revenue,
              "SaaS": s.saas,
              "Comissoes B2C": s.b2c_commissions,
              "Comissoes B2B": s.b2b_commissions,
              "Taxa Transacionada (%)": (Number(s.transacted_rate) * 100).toFixed(2),
            });
          });
        }
        if (includeCS) {
          r.tasks.filter((t) => t.status === "completed" && t.completed_at && inRange(t.completed_at.slice(0, 10))).forEach((t) => {
            csRows.push({
              Clube: r.name,
              Data: t.completed_at?.slice(0, 10) ?? "",
              Razao: t.reason,
              CTA: t.cta,
              Resultado: outcomeLabel(t.outcome),
              Sinalizacoes: (t.flags ?? []).join(", "),
            });
          });
        }
        if (includeStatus) {
          (logsByTenant.get(r.name) ?? []).filter((l) => inRange(l.changed_at.slice(0, 10))).forEach((l) => {
            statusRows.push({
              Clube: r.name,
              Data: l.changed_at.slice(0, 10),
              "Estado anterior": CLUB_STATUS_LABEL[l.previous_status as ClubStatus] ?? l.previous_status,
              "Estado novo": CLUB_STATUS_LABEL[l.new_status as ClubStatus] ?? l.new_status,
              Nota: l.note ?? "",
            });
          });
        }
      });

      if (format === "xlsx") {
        const wb = XLSX.utils.book_new();
        if (includePerf) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(perfRows), "Performance");
        if (includeCS) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(csRows), "CS");
        if (includeStatus) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(statusRows), "Estados");
        XLSX.writeFile(wb, `${baseName}.xlsx`);
      } else if (format === "csv") {
        const sections: string[] = [];
        if (includePerf) sections.push("# Performance\n" + sheetToCsv(perfRows));
        if (includeCS) sections.push("# CS\n" + sheetToCsv(csRows));
        if (includeStatus) sections.push("# Estados\n" + sheetToCsv(statusRows));
        downloadText(`${baseName}.csv`, sections.join("\n\n"));
      } else {
        const doc = new jsPDF();
        let cursorY = 14;
        doc.setFontSize(14);
        doc.text(`Tenant Pulse — Exportação ${period}`, 14, cursorY); cursorY += 8;
        doc.setFontSize(10);
        doc.text(`Gerado em ${dateNow}`, 14, cursorY); cursorY += 6;
        const addTable = (title: string, data: Record<string, unknown>[]) => {
          if (data.length === 0) return;
          doc.setFontSize(12); doc.text(title, 14, cursorY); cursorY += 4;
          autoTable(doc, {
            startY: cursorY,
            head: [Object.keys(data[0])],
            body: data.map((r) => Object.values(r).map((v) => String(v ?? ""))),
            styles: { fontSize: 7 },
            margin: { left: 14, right: 14 },
          });
          // @ts-expect-error lastAutoTable provided by autotable plugin
          cursorY = (doc.lastAutoTable?.finalY ?? cursorY) + 8;
        };
        if (includePerf) addTable("Performance", perfRows);
        if (includeCS) addTable("Histórico CS", csRows);
        if (includeStatus) addTable("Histórico de estados", statusRows);
        doc.save(`${baseName}.pdf`);
      }

      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onMouseDown={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative w-full max-w-xl rounded-xl bg-background border border-border shadow-xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h3 className="text-base font-semibold">Exportar dados</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-surface"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 space-y-4 max-h-[70vh] overflow-auto">
          <div>
            <label className="text-xs uppercase tracking-wide text-muted-foreground">Periodicidade</label>
            <div className="mt-1 inline-flex rounded-md border border-border p-0.5 bg-background">
              {(["daily", "weekly", "monthly", "yearly"] as ExportPeriod[]).map((p) => (
                <button key={p} onClick={() => setPeriod(p)} className={`px-3 py-1.5 text-xs rounded ${period === p ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}>
                  {p === "daily" ? "Diário" : p === "weekly" ? "Semanal" : p === "monthly" ? "Mensal" : "Anual"}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs uppercase tracking-wide text-muted-foreground">De</label>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 w-full px-2 py-1.5 rounded-md border border-border bg-background text-sm" />
            </div>
            <div>
              <label className="text-xs uppercase tracking-wide text-muted-foreground">Até</label>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 w-full px-2 py-1.5 rounded-md border border-border bg-background text-sm" />
            </div>
          </div>

          <div>
            <label className="text-xs uppercase tracking-wide text-muted-foreground">Âmbito</label>
            <div className="mt-1 flex items-center gap-3">
              <label className="text-sm flex items-center gap-2"><input type="radio" checked={scope === "all"} onChange={() => setScope("all")} /> Todos os clubes</label>
              <label className="text-sm flex items-center gap-2"><input type="radio" checked={scope === "selected"} onChange={() => setScope("selected")} /> Selecionados</label>
            </div>
            {scope === "selected" && (
              <div className="mt-2 max-h-40 overflow-auto rounded-md border border-border p-2 grid grid-cols-2 gap-1">
                {rows.map((r) => (
                  <label key={r.name} className="text-xs flex items-center gap-2">
                    <input type="checkbox" checked={selected.has(r.name)} onChange={() => toggle(r.name)} />
                    {r.name}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="text-xs uppercase tracking-wide text-muted-foreground">Formato</label>
            <div className="mt-1 inline-flex rounded-md border border-border p-0.5 bg-background">
              {(["xlsx", "csv", "pdf"] as ExportFormat[]).map((f) => (
                <button key={f} onClick={() => setFormat(f)} className={`px-3 py-1.5 text-xs rounded uppercase ${format === f ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}>{f}</button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs uppercase tracking-wide text-muted-foreground">Incluir</label>
            <div className="mt-1 space-y-1.5">
              <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={includePerf} onChange={(e) => setIncludePerf(e.target.checked)} /> Dados de performance</label>
              <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={includeCS} onChange={(e) => setIncludeCS(e.target.checked)} /> Histórico de tarefas CS</label>
              <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={includeStatus} onChange={(e) => setIncludeStatus(e.target.checked)} /> Histórico de estados</label>
            </div>
          </div>
        </div>
        <div className="px-5 py-4 border-t border-border flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm rounded-md border border-border hover:bg-surface">Cancelar</button>
          <button onClick={generate} disabled={busy} className="px-4 py-1.5 text-sm rounded-md bg-foreground text-background font-medium hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-2">
            <Download className="h-4 w-4" /> {busy ? "A gerar…" : "Gerar exportação"}
          </button>
        </div>
      </div>
    </div>
  );
}

function sheetToCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(",")];
  rows.forEach((r) => lines.push(headers.map((h) => escape(r[h])).join(",")));
  return lines.join("\n");
}

function downloadText(name: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

// ---------- Bulk status bar (floating) ----------

function BulkStatusBar({
  count, onApply, onAdjustScore, onCancel,
}: {
  count: number;
  onApply: (next: ClubStatus, competitor: string | null) => Promise<void>;
  onAdjustScore: () => void;
  onCancel: () => void;
}) {
  const [next, setNext] = useState<ClubStatus>("active");
  const [comp, setComp] = useState<string>(COMPETITOR_OPTIONS[0].value);
  const [busy, setBusy] = useState(false);
  return (
    <div
      className="fixed left-0 right-0 bottom-0 z-40 lg:left-60 border-t border-border bg-background/95 backdrop-blur shadow-lg"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-auto max-w-[1500px] px-4 py-3 flex flex-col md:flex-row md:items-center gap-2 md:gap-3">
        <span className="text-sm font-medium">{count} {count === 1 ? "clube selecionado" : "clubes selecionados"}</span>
        <div className="flex flex-col md:flex-row md:items-center gap-2 md:ml-auto w-full md:w-auto">
          <select
            value={next}
            onChange={(e) => setNext(e.target.value as ClubStatus)}
            className="w-full md:w-auto px-3 h-11 md:h-9 text-base md:text-sm rounded-md border border-border bg-background"
          >
            {CLUB_STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          {next === "churned" && (
            <select
              value={comp}
              onChange={(e) => setComp(e.target.value)}
              className="w-full md:w-auto px-3 h-11 md:h-9 text-base md:text-sm rounded-md border border-border bg-background"
            >
              {COMPETITOR_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          )}
          <div className="flex gap-2 w-full md:w-auto">
            <button
              onClick={async () => {
                setBusy(true);
                try { await onApply(next, next === "churned" ? comp : null); }
                finally { setBusy(false); }
              }}
              disabled={busy}
              className="flex-1 md:flex-none inline-flex items-center justify-center gap-1.5 rounded-md bg-foreground text-background px-4 min-h-11 md:min-h-9 text-sm font-medium hover:opacity-90 disabled:opacity-50"
            >
              <Check className="h-4 w-4" /> {busy ? "A aplicar…" : "Aplicar"}
            </button>
            <button
              onClick={onAdjustScore}
              className="flex-1 md:flex-none inline-flex items-center justify-center gap-1.5 rounded-md border border-border px-3 min-h-11 md:min-h-9 text-sm font-medium hover:bg-surface"
              title="Ajustar manualmente o health score dos clubes selecionados"
            >
              <SlidersHorizontal className="h-4 w-4" /> Ajustar score
            </button>
            <button
              onClick={onCancel}
              className="text-sm text-muted-foreground hover:text-foreground px-3 min-h-11 md:min-h-9"
            >
              Cancelar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- Missing clubs modal ----------

function MissingClubsModal({
  rows, onApply, onClose,
}: {
  rows: ClubRow[];
  onApply: (names: string[], next: ClubStatus, competitor: string | null) => Promise<void>;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingTenant, setEditingTenant] = useState<string | null>(null);
  const [actioned, setActioned] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [next, setNext] = useState<ClubStatus>("possible_churn");
  const [comp, setComp] = useState<string>(COMPETITOR_OPTIONS[0].value);

  // remaining = rows still missing & not yet actioned in this session
  const visible = rows.filter((r) => !actioned.has(r.name));

  async function applyBulk() {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      const names = Array.from(selected);
      await onApply(names, next, next === "churned" ? comp : null);
      const newActioned = new Set(actioned);
      names.forEach((n) => newActioned.add(n));
      setActioned(newActioned);
      setSelected(new Set());
    } finally { setBusy(false); }
  }

  async function applySingle(name: string, current: ClubStatus, nextStatus: ClubStatus, competitor: string | null) {
    await onApply([name], nextStatus, competitor);
    const newActioned = new Set(actioned);
    newActioned.add(name);
    setActioned(newActioned);
    setEditingTenant(null);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onMouseDown={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-full max-w-4xl max-h-[85vh] flex flex-col rounded-xl bg-background border border-border shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-border flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-warning" />
              Clubes não encontrados no último carregamento
            </h3>
            <p className="text-xs text-muted-foreground mt-1">Confirma o estado de cada clube antes de fechar.</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-surface" aria-label="Fechar">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-auto">
          {visible.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              Todos os clubes em falta foram revistos. Pode fechar.
            </div>
          ) : (
            <DataTable<ClubRow>
              rows={visible}
              rowKey={(r) => r.name}
              defaultSort={{ key: "lastSeen", dir: "desc" }}
              selectable
              selectedKeys={selected}
              onSelectionChange={setSelected}
              searchable
              searchPlaceholder="Pesquisar clube em falta…"
              emptyMessage="Sem clubes em falta."
              columns={[
                {
                  key: "name", header: "Clube",
                  sortValue: (r) => r.name,
                  filterValue: (r) => r.name,
                  render: (r) => <span className="font-medium">{r.name}</span>,
                },
                {
                  key: "lastSeen", header: "Última vez visto",
                  sortValue: (r) => r.history[r.history.length - 1]?.period ?? "",
                  render: (r) => {
                    const last = r.history[r.history.length - 1];
                    return <span className="text-xs text-muted-foreground">{last ? periodLabel(last.period) : "—"}</span>;
                  },
                },
                {
                  key: "lastGmv", header: "Último GMV",
                  align: "right",
                  sortValue: (r) => r.history[r.history.length - 1]?.gmv_all ?? null,
                  render: (r) => {
                    const last = r.history[r.history.length - 1];
                    return last ? formatEuro(last.gmv_all) : "—";
                  },
                },
                {
                  key: "score", header: "Saúde",
                  align: "center",
                  sortValue: (r) => r.score,
                  render: (r) => {
                    const healthColor = r.score < 30 ? "text-danger bg-danger/10" : r.score < 60 ? "text-warning bg-warning/15" : "text-success bg-success/10";
                    return <span className={`inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${healthColor}`}>{r.score}</span>;
                  },
                },
                {
                  key: "status", header: "Estado",
                  render: (r) => editingTenant === r.name ? (
                    <InlineStatusEditor
                      current={r.status}
                      competitor={r.competitor}
                      onCancel={() => setEditingTenant(null)}
                      onSave={(ns, c) => applySingle(r.name, r.status, ns, c)}
                    />
                  ) : (
                    <button
                      onClick={(e) => { e.stopPropagation(); setEditingTenant(r.name); }}
                      className="text-left"
                    >
                      <ClubStatusBadge status={r.status} competitor={r.competitor} />
                    </button>
                  ),
                },
              ]}
            />
          )}
        </div>

        <div className="border-t border-border px-5 py-3 flex items-center justify-between gap-3 flex-wrap">
          {selected.size > 0 ? (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium">{selected.size} {selected.size === 1 ? "selecionado" : "selecionados"}</span>
              <select
                value={next}
                onChange={(e) => setNext(e.target.value as ClubStatus)}
                className="px-2 py-1.5 text-sm rounded-md border border-border bg-background"
              >
                {CLUB_STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              {next === "churned" && (
                <select
                  value={comp}
                  onChange={(e) => setComp(e.target.value)}
                  className="px-2 py-1.5 text-sm rounded-md border border-border bg-background"
                >
                  {COMPETITOR_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              )}
              <button
                onClick={applyBulk}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-md bg-foreground text-background px-3 py-1.5 text-sm font-medium hover:opacity-90 disabled:opacity-50"
              >
                <Check className="h-4 w-4" /> {busy ? "A aplicar…" : "Aplicar"}
              </button>
              <button onClick={() => setSelected(new Set())} className="text-sm text-muted-foreground hover:text-foreground">Cancelar</button>
            </div>
          ) : <span className="text-xs text-muted-foreground">Selecione clubes para ações em massa, ou edite o estado linha-a-linha.</span>}
          <button
            onClick={onClose}
            className="ml-auto px-4 py-1.5 text-sm rounded-md border border-border hover:bg-surface"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

// Temporary stubs (prior-turn WIP) — render children/nothing until full impl lands
function ScoreTooltip({ children }: { row: ClubRow; children: import("react").ReactNode }) {
  return <>{children}</>;
}
function ScoreVariationSection({ row, tenant }: { row: ClubRow; tenant: string }) {
  const changes = scoreChangeEvents(row).sort((a, b) => {
    const ad = a.period === "Atual" ? new Date().toISOString() : periodEndIso(a.period);
    const bd = b.period === "Atual" ? new Date().toISOString() : periodEndIso(b.period);
    return bd.localeCompare(ad);
  });
  const latest = changes[0];
  return (
    <section className="rounded-lg border border-border overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border bg-surface text-sm font-medium">Variação do score</div>
      <div className="p-4 text-xs space-y-3">
        <ScoreSparkline tenant={tenant} />
        {latest ? (
          <div className="rounded-md border border-border bg-background p-3 flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Última alteração</span>
            <ScoreChangeLine oldScore={latest.oldScore} newScore={latest.newScore} delta={latest.delta} />
          </div>
        ) : (
          <div className="text-muted-foreground">Sem alterações de score registadas.</div>
        )}
        {changes.length > 0 && (
          <ul className="divide-y divide-border rounded-md border border-border">
            {changes.map((c) => (
              <li key={`${c.period}-${c.oldScore}-${c.newScore}`} className="px-3 py-2 flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">{c.period === "Atual" ? "Atual" : periodLabel(c.period)}</span>
                  <ScoreChangeLine oldScore={c.oldScore} newScore={c.newScore} delta={c.delta} />
                </div>
                {c.reasons.length > 0 && (
                  <ul className="ml-1 space-y-0.5 text-muted-foreground">
                    {c.reasons.map((r, i) => (
                      <li key={i} className="flex gap-1.5"><span>•</span><span>{r}</span></li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function ScoreSparkline({ tenant }: { tenant: string }) {
  const [points, setPoints] = useState<{ v: number }[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const log = await fetchHealthLog(tenant, 8);
        if (cancelled) return;
        // fetchHealthLog returns desc; reverse for asc
        const asc = [...log].reverse().map((l) => ({ v: Number(l.new_score) }));
        setPoints(asc);
      } catch {
        if (!cancelled) setPoints([]);
      }
    })();
    return () => { cancelled = true; };
  }, [tenant]);
  if (points.length < 2) return null;
  const first = points[0].v;
  const last = points[points.length - 1].v;
  const colorClass = last > first ? "text-success" : last < first ? "text-danger" : "text-muted-foreground";
  return (
    <div className={`w-full ${colorClass}`} style={{ height: 48 }}>
      <ResponsiveContainer width="100%" height={48}>
        <LineChart data={points} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <Line
            type="monotone"
            dataKey="v"
            stroke="currentColor"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
