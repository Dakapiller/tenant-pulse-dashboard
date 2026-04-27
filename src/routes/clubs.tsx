import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  AlertTriangle, Building2, Check, ChevronRight, Download, X,
} from "lucide-react";
import { fetchAllSnapshots, fetchPeriods, type Snapshot } from "@/lib/data";
import {
  fetchAllCSStatuses,
  fetchAllCSTasks,
  fetchClubStatusLogs,
  fetchClubStatusLogsForTenant,
  fetchCSStatusesForTenant,
  fetchCSTasksForTenant,
  setClubStatus,
  currentClubStatus,
  currentChurnCompetitor,
  scoreWithDelta,
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
import { computeRiskWithCS, FLAG_META } from "@/lib/risk";
import { formatEuro, formatNumber, formatPercent, periodLabel } from "@/lib/format";
import { DataTable, ScoreDelta, type ColumnDef } from "@/components/DataTable";

export const Route = createFileRoute("/clubs")({
  component: ClubsPage,
});

interface ClubRow {
  name: string;
  latest: Snapshot | null;
  history: Snapshot[];
  statuses: CSTenantStatus[];
  tasks: CSTask[];
  status: ClubStatus;
  competitor: string | null;
  score: number;
  scoreDelta: number | null;
  level: "high" | "medium" | "healthy";
  csImpact: number;
  lastActivity: string | null;
  pending: number;
  missingFromLatest: boolean;
}

function ClubsPage() {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [periods, setPeriods] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<CSTenantStatus[]>([]);
  const [tasks, setTasks] = useState<CSTask[]>([]);
  const [loading, setLoading] = useState(true);

  const [drawerTenant, setDrawerTenant] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [editingTenant, setEditingTenant] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [missingOpen, setMissingOpen] = useState(false);

  async function loadAll() {
    const [s, p, sts, tks] = await Promise.all([
      fetchAllSnapshots(), fetchPeriods(), fetchAllCSStatuses(), fetchAllCSTasks(),
    ]);
    setSnapshots(s); setPeriods(p); setStatuses(sts); setTasks(tks);
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

    const result: ClubRow[] = [];
    for (const [name, hist] of histByTenant) {
      const sorted = [...hist].sort((a, b) => a.period.localeCompare(b.period));
      const latest = sorted[sorted.length - 1] ?? null;
      const sts = stsByTenant.get(name) ?? [];
      const tks = tasksByTenant.get(name) ?? [];
      const sd = scoreWithDelta(sorted, sts);
      const status = currentClubStatus(sts);
      const competitor = currentChurnCompetitor(sts);
      const pending = tks.filter((t) => t.status === "pending" && t.week_start === weekStart).length;
      const missing = !!latestPeriod && !sorted.some((s) => s.period === latestPeriod);
      result.push({
        name, latest, history: sorted, statuses: sts, tasks: tks,
        status, competitor, score: sd.score, scoreDelta: sd.delta, level: sd.level,
        csImpact: sumCSImpact(sts),
        lastActivity: lastCompletedActivityAt(tks),
        pending, missingFromLatest: missing,
      });
    }
    return result;
  }, [snapshots, statuses, tasks, weekStart, latestPeriod]);

  const missingCount = rows.filter((r) => r.missingFromLatest && r.status !== "churned" && r.status !== "closed").length;

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
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1500px] mx-auto">
      <header className="mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Building2 className="h-6 w-6" /> Clubes
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Controlo central de todos os clubes — saúde, atividade CS e ciclo de vida.</p>
        </div>
        <button
          onClick={() => setExportOpen(true)}
          className="inline-flex items-center gap-2 rounded-md bg-foreground text-background px-4 py-2 text-sm font-medium hover:opacity-90"
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

      <section className="rounded-xl border border-border bg-background overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between text-xs text-muted-foreground">
          <span>{rows.length} clubes</span>
        </div>
        <DataTable<ClubRow>
          rows={rows}
          rowKey={(r) => r.name}
          defaultSort={{ key: "name", dir: "asc" }}
          stickyHeader
          containerClassName="max-h-[700px]"
          rowClassName={(r) => r.missingFromLatest ? "bg-warning/5" : ""}
          emptyMessage="Sem clubes."
          selectable
          selectedKeys={selectedKeys}
          onSelectionChange={setSelectedKeys}
          columns={[
            {
              key: "name",
              header: "Clube",
              sortValue: (r) => r.name,
              filterValue: (r) => r.name,
              filter: { kind: "text" },
              render: (r) => (
                <>
                  <button onClick={() => setDrawerTenant(r.name)} className="font-medium hover:underline text-left">{r.name}</button>
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
              align: "center",
              sortValue: (r) => r.score,
              filter: { kind: "select", options: [
                { value: "high", label: "Alto" }, { value: "medium", label: "Médio" }, { value: "healthy", label: "Saudável" },
              ]},
              filterValue: (r) => r.level,
              render: (r) => {
                const healthColor = r.score >= 60 ? "text-danger bg-danger/10" : r.score >= 30 ? "text-warning bg-warning/15" : "text-success bg-success/10";
                return (
                  <span className="inline-flex items-center gap-1.5">
                    <span className={`inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${healthColor}`}>{r.score}</span>
                    <ScoreDelta delta={r.scoreDelta} />
                  </span>
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
              render: (r) => r.pending > 0
                ? <span className="inline-flex items-center justify-center rounded-full bg-warning/15 text-warning px-2 py-0.5 text-xs font-medium">{r.pending}</span>
                : <span className="text-success">✓</span>,
            },
            {
              key: "status",
              header: "Estado",
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
          ]}
        />
      </section>

      {drawerTenant && (
        <ClubDrawer
          tenant={drawerTenant}
          row={rows.find((r) => r.name === drawerTenant)!}
          onClose={() => setDrawerTenant(null)}
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
          rows={rows.filter((r) => r.missingFromLatest && r.status !== "churned" && r.status !== "closed")}
          onApply={async (names, next, competitor) => {
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
            for (const name of names) {
              const r = rows.find((x) => x.name === name);
              if (!r) continue;
              await setClubStatus(name, next, r.status, null, "cs", competitor);
            }
            setSelectedKeys(new Set());
            await loadAll();
          }}
          onCancel={() => setSelectedKeys(new Set())}
        />
      )}
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

// ---------- Drawer ----------

function ClubDrawer({ tenant, row, onClose }: { tenant: string; row: ClubRow; onClose: () => void; onChanged?: () => Promise<void> }) {
  const [statusLogs, setStatusLogs] = useState<ClubStatusLog[]>([]);
  const [tenantTasks, setTenantTasks] = useState<CSTask[]>([]);
  const [tenantStatuses, setTenantStatuses] = useState<CSTenantStatus[]>([]);

  useEffect(() => {
    (async () => {
      const [logs, tks, sts] = await Promise.all([
        fetchClubStatusLogsForTenant(tenant),
        fetchCSTasksForTenant(tenant),
        fetchCSStatusesForTenant(tenant),
      ]);
      setStatusLogs(logs); setTenantTasks(tks); setTenantStatuses(sts);
    })();
  }, [tenant]);

  const risk = useMemo(() => computeRiskWithCS(row.history, tenantStatuses), [row.history, tenantStatuses]);

  const monthly = useMemo(() => {
    return row.history.map((s, i) => {
      const prev = row.history[i - 1];
      const delta = (k: keyof Snapshot) => {
        if (!prev) return null;
        const a = Number(prev[k] ?? 0); const b = Number(s[k] ?? 0);
        if (a === 0) return null;
        return ((b - a) / Math.abs(a)) * 100;
      };
      return { snapshot: s, deltas: {
        games_online: delta("games_online"),
        gmv_all: delta("gmv_all"),
        revenue: delta("revenue"),
        transacted_rate: delta("transacted_rate"),
      } };
    }).reverse();
  }, [row.history]);

  const completedTasks = tenantTasks.filter((t) => t.status === "completed");
  const MODS: Record<string, number> = { bad_relationship: 25, good_receptivity: -15, very_satisfied: -30 };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onMouseDown={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-full max-w-3xl h-full bg-background border-l border-border shadow-xl overflow-y-auto"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-background border-b border-border px-6 py-4 flex items-center justify-between z-10">
          <div>
            <h2 className="text-lg font-semibold">{tenant}</h2>
            <div className="flex items-center gap-2 mt-1">
              <ClubStatusBadge status={row.status} competitor={row.competitor} />
              <Link to="/tenant/$name" params={{ name: tenant }} className="text-xs text-muted-foreground hover:text-foreground underline">
                Abrir página completa
              </Link>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-surface" aria-label="Fechar"><X className="h-4 w-4" /></button>
        </div>

        <div className="p-6 space-y-6">
          <section className="rounded-lg border border-border p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Score de saúde</div>
            <div className="flex items-end gap-4 mb-3">
              <div className="text-3xl font-bold tabular-nums">{risk.score}</div>
              <div className="text-xs text-muted-foreground pb-1">
                Base: {risk.dataScore} · CS: {risk.csModifier && risk.csModifier > 0 ? `+${risk.csModifier}` : risk.csModifier}
              </div>
            </div>
            {risk.flags.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {risk.flags.map((f) => (
                  <span key={f} className="text-xs rounded-full bg-surface border border-border px-2 py-0.5" title={FLAG_META[f].description}>
                    {FLAG_META[f].label} · +{FLAG_META[f].points}
                  </span>
                ))}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">Sem sinalizações de risco ativas.</div>
            )}
          </section>

          <section className="rounded-lg border border-border overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border bg-surface text-sm font-medium">Histórico de performance</div>
            <div className="max-h-80 overflow-auto">
              <table className="w-full text-xs">
                <thead className="bg-surface/60 sticky top-0">
                  <tr className="text-muted-foreground">
                    <th className="px-3 py-2 text-left">Mês</th>
                    <th className="px-3 py-2 text-right">Jogos</th>
                    <th className="px-3 py-2 text-right">Δ</th>
                    <th className="px-3 py-2 text-right">GMV</th>
                    <th className="px-3 py-2 text-right">Δ</th>
                    <th className="px-3 py-2 text-right">Receita</th>
                    <th className="px-3 py-2 text-right">Δ</th>
                    <th className="px-3 py-2 text-right">Taxa</th>
                  </tr>
                </thead>
                <tbody>
                  {monthly.map((m) => (
                    <tr key={m.snapshot.period} className="border-t border-border">
                      <td className="px-3 py-1.5">{periodLabel(m.snapshot.period)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(m.snapshot.games_online)}</td>
                      <td className="px-3 py-1.5 text-right"><Delta v={m.deltas.games_online} /></td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{formatEuro(m.snapshot.gmv_all)}</td>
                      <td className="px-3 py-1.5 text-right"><Delta v={m.deltas.gmv_all} /></td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{formatEuro(m.snapshot.revenue)}</td>
                      <td className="px-3 py-1.5 text-right"><Delta v={m.deltas.revenue} /></td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{formatPercent(m.snapshot.transacted_rate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-lg border border-border overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border bg-surface text-sm font-medium">Histórico CS — Tarefas</div>
            {completedTasks.length === 0 ? (
              <div className="p-4 text-xs text-muted-foreground">Sem tarefas registadas.</div>
            ) : (
              <ul className="divide-y divide-border">
                {completedTasks.map((t) => {
                  const impact = MODS[t.outcome ?? ""] ?? 0;
                  return (
                    <li key={t.id} className="px-4 py-3 text-xs">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-muted-foreground">{t.completed_at ? new Date(t.completed_at).toLocaleDateString("pt-PT") : "—"}</span>
                        <span className={`font-semibold ${impact > 0 ? "text-danger" : impact < 0 ? "text-success" : "text-muted-foreground"}`}>
                          {impact > 0 ? `+${impact}` : impact < 0 ? impact : "—"}
                        </span>
                      </div>
                      <div className="mt-1 font-medium">{t.reason}</div>
                      <div className="text-muted-foreground mt-0.5">CTA: {t.cta}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {(t.flags ?? []).map((f) => (
                          <span key={f} className="rounded-full bg-surface px-1.5 py-0.5 text-[10px]">
                            {FLAG_META[f as keyof typeof FLAG_META]?.label ?? f}
                          </span>
                        ))}
                        <span className="ml-auto rounded-full bg-surface px-1.5 py-0.5">{outcomeLabel(t.outcome)}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="rounded-lg border border-border overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border bg-surface text-sm font-medium">Histórico de estado</div>
            {statusLogs.length === 0 ? (
              <div className="p-4 text-xs text-muted-foreground">Sem alterações de estado registadas.</div>
            ) : (
              <ul className="divide-y divide-border text-xs">
                {statusLogs.map((l) => (
                  <li key={l.id} className="px-4 py-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <span className="text-muted-foreground">{CLUB_STATUS_LABEL[l.previous_status as ClubStatus] ?? l.previous_status}</span>
                        <span className="mx-2">→</span>
                        <span className="font-medium">{CLUB_STATUS_LABEL[l.new_status as ClubStatus] ?? l.new_status}</span>
                      </div>
                      <span className="text-muted-foreground">{new Date(l.changed_at).toLocaleString("pt-PT")}</span>
                    </div>
                    {l.note && <div className="mt-1 italic text-muted-foreground">"{l.note}"</div>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
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
  count, onApply, onCancel,
}: {
  count: number;
  onApply: (next: ClubStatus, competitor: string | null) => Promise<void>;
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
      <div className="mx-auto max-w-[1500px] px-4 py-3 flex items-center gap-3 flex-wrap">
        <span className="text-sm font-medium">{count} {count === 1 ? "clube selecionado" : "clubes selecionados"}</span>
        <div className="flex items-center gap-2 flex-wrap ml-auto">
          <select
            value={next}
            onChange={(e) => setNext(e.target.value as ClubStatus)}
            className="px-2 py-1.5 text-base sm:text-sm rounded-md border border-border bg-background"
          >
            {CLUB_STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          {next === "churned" && (
            <select
              value={comp}
              onChange={(e) => setComp(e.target.value)}
              className="px-2 py-1.5 text-base sm:text-sm rounded-md border border-border bg-background"
            >
              {COMPETITOR_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          )}
          <button
            onClick={async () => {
              setBusy(true);
              try { await onApply(next, next === "churned" ? comp : null); }
              finally { setBusy(false); }
            }}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md bg-foreground text-background px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            <Check className="h-4 w-4" /> {busy ? "A aplicar…" : "Aplicar"}
          </button>
          <button
            onClick={onCancel}
            className="text-sm text-muted-foreground hover:text-foreground px-2 py-2"
          >
            Cancelar
          </button>
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
                    const healthColor = r.score >= 60 ? "text-danger bg-danger/10" : r.score >= 30 ? "text-warning bg-warning/15" : "text-success bg-success/10";
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
