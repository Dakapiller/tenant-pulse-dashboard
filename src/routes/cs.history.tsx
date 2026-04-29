import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { ClubLink } from "@/components/ClubLink";
import {
  fetchAllCSStatuses,
  fetchCompletedCSTasksPage,
  excludedTenants,
  outcomeLabel,
  type CSTask,
  type CSTenantStatus,
} from "@/lib/cs";
import { FLAG_META, type RiskFlag } from "@/lib/risk";
import { periodLabel } from "@/lib/format";
import { Eye, EyeOff, History as HistoryIcon } from "lucide-react";

export const Route = createFileRoute("/cs/history")({
  component: CSHistoryPage,
});

const PAGE = 50;

function formatFlagsLabel(flags: string[] | null | undefined): string {
  if (!flags || flags.length === 0) return "—";
  return flags.map((f) => FLAG_META[f as RiskFlag]?.label ?? f).join(" + ");
}

function CSHistoryPage() {
  const [tasks, setTasks] = useState<CSTask[]>([]);
  const [statuses, setStatuses] = useState<CSTenantStatus[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  // Initial load — first page of completed + statuses (for the inactive filter).
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

  const visibleTasks = useMemo(
    () => showInactive ? tasks : tasks.filter((t) => !excluded.has(t.tenant_name)),
    [tasks, excluded, showInactive],
  );

  const inactiveCount = tasks.length - visibleTasks.length;

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

  if (loading) return (
    <div className="p-10 text-muted-foreground">A carregar…</div>
  );

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1400px] mx-auto">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Histórico CS</h1>
          <p className="text-sm text-muted-foreground mt-1">Tarefas concluídas, das mais recentes para as mais antigas.</p>
        </header>

        <section className="rounded-xl border border-border overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <HistoryIcon className="h-4 w-4" />
              <h2 className="text-base font-semibold">Concluídas</h2>
              <span className="text-xs text-muted-foreground">
                {visibleTasks.length} carregada{visibleTasks.length === 1 ? "" : "s"}
                {hasMore ? "" : " · fim"}
              </span>
            </div>
            {inactiveCount > 0 && (
              <button
                onClick={() => setShowInactive((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-surface"
              >
                {showInactive ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {showInactive ? "Ocultar inativos" : `Mostrar inativos (${inactiveCount})`}
              </button>
            )}
          </div>

          <div className="p-5">
            {visibleTasks.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-8">Sem tarefas concluídas.</div>
            ) : (
              <ul className="divide-y divide-border">
                {visibleTasks.map((t) => (
                  <li key={t.id} className="py-3 flex items-start justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <ClubLink name={t.tenant_name} />
                        <span className="text-xs px-1.5 py-0.5 rounded bg-surface">{formatFlagsLabel(t.flags)}</span>
                        <span className="text-xs text-muted-foreground">
                          {t.completed_at ? new Date(t.completed_at).toLocaleDateString("pt-PT") : ""} · Semana de {periodLabel(t.week_start)}
                        </span>
                      </div>
                      {t.reason && <div className="text-xs text-muted-foreground mt-0.5 whitespace-pre-line">{t.reason}</div>}
                      {t.note && <div className="text-xs text-muted-foreground mt-1 italic">Comentário: “{t.note}”</div>}
                    </div>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-surface shrink-0">{outcomeLabel(t.outcome)}</span>
                  </li>
                ))}
              </ul>
            )}

            {hasMore && (
              <div className="pt-4 flex items-center justify-center">
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="px-3 py-1.5 text-xs rounded-md border border-border hover:bg-surface disabled:opacity-50"
                >
                  {loadingMore ? "A carregar…" : "Carregar mais"}
                </button>
              </div>
            )}
          </div>
        </section>
    </div>
  );
}
