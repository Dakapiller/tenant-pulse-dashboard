import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  AlertTriangle, Building2, ChevronDown, Download, MoreVertical, Search, X,
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
  sumCSImpact,
  lastCompletedActivityAt,
  currentWeekStart,
  outcomeLabel,
  CLUB_STATUS_LABEL,
  type CSTenantStatus,
  type CSTask,
  type ClubStatus,
  type ClubStatusLog,
} from "@/lib/cs";
import { computeRiskWithCS, FLAG_META } from "@/lib/risk";
import { formatEuro, formatNumber, formatPercent, periodLabel } from "@/lib/format";

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
  score: number;
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

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | ClubStatus>("all");
  const [pendingFilter, setPendingFilter] = useState<"all" | "has" | "none">("all");
  const [riskFilter, setRiskFilter] = useState<"all" | "high" | "medium" | "healthy">("all");

  const [drawerTenant, setDrawerTenant] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [actionMenuFor, setActionMenuFor] = useState<string | null>(null);

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
      const risk = computeRiskWithCS(sorted, sts);
      const status = currentClubStatus(sts);
      const pending = tks.filter((t) => t.status === "pending" && t.week_start === weekStart).length;
      const missing = !!latestPeriod && !sorted.some((s) => s.period === latestPeriod);
      result.push({
        name, latest, history: sorted, statuses: sts, tasks: tks,
        status, score: risk.score, level: risk.level,
        csImpact: sumCSImpact(sts),
        lastActivity: lastCompletedActivityAt(tks),
        pending, missingFromLatest: missing,
      });
    }
    return result;
  }, [snapshots, statuses, tasks, weekStart, latestPeriod]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (q && !r.name.toLowerCase().includes(q)) return false;
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (pendingFilter === "has" && r.pending === 0) return false;
      if (pendingFilter === "none" && r.pending > 0) return false;
      if (riskFilter !== "all" && r.level !== riskFilter) return false;
      return true;
    }).sort((a, b) => {
      if (a.missingFromLatest !== b.missingFromLatest) return a.missingFromLatest ? -1 : 1;
      return b.score - a.score;
    });
  }, [rows, search, statusFilter, pendingFilter, riskFilter]);

  const missingCount = rows.filter((r) => r.missingFromLatest && r.status !== "churned").length;

  async function handleStatusChange(tenant: string, current: ClubStatus, next: ClubStatus) {
    await setClubStatus(tenant, next, current, null);
    await loadAll();
    setActionMenuFor(null);
  }

  if (loading) return <div className="p-10 text-muted-foreground">A carregar…</div>;

  return (
    <div className="p-8 max-w-[1500px] mx-auto">
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
        <div className="mb-5 rounded-lg border border-warning/40 bg-warning/10 p-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-warning shrink-0 mt-0.5" />
          <div className="text-sm">
            <div className="font-medium text-warning">
              {missingCount} {missingCount === 1 ? "clube não foi encontrado" : "clubes não foram encontrados"} no último carregamento — reveja abaixo.
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Estes clubes existiam em períodos anteriores mas estão ausentes em {latestPeriod ? periodLabel(latestPeriod) : "—"}. Foram sinalizados automaticamente como candidatos a churn.
            </div>
          </div>
        </div>
      )}

      <section className="rounded-xl border border-border bg-background overflow-hidden">
        <div className="p-4 border-b border-border flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-60 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Procurar clube…"
              className="w-full pl-9 pr-3 py-2 text-sm rounded-md border border-border bg-background"
            />
          </div>
          <Filter label="Estado" value={statusFilter} onChange={(v) => setStatusFilter(v as typeof statusFilter)}
            options={[
              { v: "all", l: "Todos" },
              { v: "active", l: "Ativo" },
              { v: "churn_candidate", l: "Candidato a churn" },
              { v: "churned", l: "Em churn" },
            ]} />
          <Filter label="Tarefas" value={pendingFilter} onChange={(v) => setPendingFilter(v as typeof pendingFilter)}
            options={[{ v: "all", l: "Todas" }, { v: "has", l: "Com pendentes" }, { v: "none", l: "Sem pendentes" }]} />
          <Filter label="Risco" value={riskFilter} onChange={(v) => setRiskFilter(v as typeof riskFilter)}
            options={[
              { v: "all", l: "Todos" },
              { v: "high", l: "Alto" },
              { v: "medium", l: "Médio" },
              { v: "healthy", l: "Saudável" },
            ]} />
          <div className="ml-auto text-xs text-muted-foreground">{filtered.length} de {rows.length}</div>
        </div>

        <div className="overflow-auto max-h-[700px]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface z-10 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left">Clube</th>
                <th className="px-4 py-3 text-right">Jogos</th>
                <th className="px-4 py-3 text-right">GMV</th>
                <th className="px-4 py-3 text-right">Receita</th>
                <th className="px-4 py-3 text-right">Taxa</th>
                <th className="px-4 py-3 text-center">Saúde</th>
                <th className="px-4 py-3 text-center">CS Δ</th>
                <th className="px-4 py-3 text-left">Última atividade</th>
                <th className="px-4 py-3 text-center">Pendentes</th>
                <th className="px-4 py-3 text-left">Estado</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const healthColor = r.score >= 60 ? "text-danger bg-danger/10" : r.score >= 30 ? "text-warning bg-warning/15" : "text-success bg-success/10";
                const impactColor = r.csImpact > 0 ? "text-danger" : r.csImpact < 0 ? "text-success" : "text-muted-foreground";
                return (
                  <tr key={r.name} className={`border-t border-border hover:bg-surface ${r.missingFromLatest ? "bg-warning/5" : ""}`}>
                    <td className="px-4 py-2.5">
                      <button onClick={() => setDrawerTenant(r.name)} className="font-medium hover:underline text-left">
                        {r.name}
                      </button>
                      {r.missingFromLatest && (
                        <span className="ml-2 text-[10px] uppercase text-warning font-semibold">Em falta</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{r.latest ? formatNumber(r.latest.games_online) : "—"}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{r.latest ? formatEuro(r.latest.gmv_all) : "—"}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{r.latest ? formatEuro(r.latest.revenue) : "—"}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{r.latest ? formatPercent(r.latest.transacted_rate) : "—"}</td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={`inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${healthColor}`}>{r.score}</span>
                    </td>
                    <td className={`px-4 py-2.5 text-center text-xs font-semibold tabular-nums ${impactColor}`}>
                      {r.csImpact > 0 ? `+${r.csImpact}` : r.csImpact < 0 ? r.csImpact : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      {r.lastActivity ? new Date(r.lastActivity).toLocaleDateString("pt-PT") : "Nunca"}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {r.pending > 0 ? (
                        <span className="inline-flex items-center justify-center rounded-full bg-warning/15 text-warning px-2 py-0.5 text-xs font-medium">{r.pending}</span>
                      ) : (
                        <span className="text-success">✓</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <ClubStatusBadge status={r.status} />
                    </td>
                    <td className="px-4 py-2.5 text-right relative">
                      <button
                        onClick={() => setActionMenuFor(actionMenuFor === r.name ? null : r.name)}
                        className="p-1 rounded hover:bg-background"
                      >
                        <MoreVertical className="h-4 w-4" />
                      </button>
                      {actionMenuFor === r.name && (
                        <div className="absolute right-2 top-9 z-20 w-56 rounded-md border border-border bg-background shadow-lg text-left">
                          <ActionItem onClick={() => handleStatusChange(r.name, r.status, "churn_candidate")} disabled={r.status === "churn_candidate"}>Sinalizar como candidato a churn</ActionItem>
                          <ActionItem onClick={() => handleStatusChange(r.name, r.status, "churned")} disabled={r.status === "churned"}>Marcar como churned</ActionItem>
                          <ActionItem onClick={() => handleStatusChange(r.name, r.status, "active")} disabled={r.status === "active"}>Limpar (voltar a ativo)</ActionItem>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={11} className="px-4 py-10 text-center text-muted-foreground text-sm">Sem clubes para os filtros atuais.</td></tr>
              )}
            </tbody>
          </table>
        </div>
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

function ActionItem({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="w-full text-left px-3 py-2 text-xs hover:bg-surface disabled:opacity-40 disabled:cursor-not-allowed">
      {children}
    </button>
  );
}

function ClubStatusBadge({ status }: { status: ClubStatus }) {
  const map = {
    active: { bg: "bg-success/10", text: "text-success" },
    churn_candidate: { bg: "bg-warning/15", text: "text-warning" },
    churned: { bg: "bg-danger/10", text: "text-danger" },
  } as const;
  const m = map[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${m.bg} ${m.text}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {CLUB_STATUS_LABEL[status]}
    </span>
  );
}

// ---------- Drawer ----------

function ClubDrawer({ tenant, row, onClose, onChanged }: { tenant: string; row: ClubRow; onClose: () => void; onChanged: () => Promise<void> }) {
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
              <ClubStatusBadge status={row.status} />
              <Link to="/tenant/$name" params={{ name: tenant }} className="text-xs text-muted-foreground hover:text-foreground underline">
                Abrir página completa
              </Link>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-surface" aria-label="Fechar"><X className="h-4 w-4" /></button>
        </div>

        <div className="p-6 space-y-6">
          {/* Health breakdown */}
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

          {/* Performance history */}
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

          {/* CS task history */}
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

          {/* Status history */}
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

      // Build datasets
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
  const sheet = XLSX.utils.json_to_sheet(rows);
  return XLSX.utils.sheet_to_csv(sheet);
}

function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// suppress unused ChevronDown import warning if not used elsewhere
void ChevronDown;
