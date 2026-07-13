import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Plus, SlidersHorizontal, X } from "lucide-react";
import { NewTaskDialog } from "@/components/NewTaskDialog";
import { AdjustScoreDialog } from "@/components/AdjustScoreDialog";
import { YoYSection } from "@/components/YoYSection";
import { HealthBadge } from "@/components/HealthBadge";
import { TaskQuickActions } from "@/components/TaskQuickActions";
import { fetchSnapshotsForTenant, type Snapshot } from "@/lib/data";
import {
  fetchCSStatusesForTenant,
  fetchCSTasksForTenant,
  currentClubStatus,
  currentChurnCompetitor,
  CLUB_STATUS_LABEL,
  type CSTask,
  type CSTenantStatus,
  type ClubStatus,
} from "@/lib/cs";
import { fetchHealthScores } from "@/lib/health";
import { relativeLabelPT, relativeColorClass, activityColorClass, absoluteLabel } from "@/lib/relativeTime";

function StatusPill({ status, competitor }: { status: ClubStatus; competitor?: string | null }) {
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

interface ClubQuickViewProps {
  tenant: string;
  onClose: () => void;
  onChanged?: () => void | Promise<void>;
}

export function ClubQuickView({ tenant, onClose, onChanged }: ClubQuickViewProps) {
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [statuses, setStatuses] = useState<CSTenantStatus[]>([]);
  const [tasks, setTasks] = useState<CSTask[]>([]);
  const [score, setScore] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [taskOpen, setTaskOpen] = useState(false);
  const [scoreOpen, setScoreOpen] = useState(false);

  async function loadAll() {
    setLoading(true);
    const [snaps, sts, tks, scores] = await Promise.all([
      fetchSnapshotsForTenant(tenant),
      fetchCSStatusesForTenant(tenant),
      fetchCSTasksForTenant(tenant),
      fetchHealthScores(),
    ]);
    setHistory(snaps);
    setStatuses(sts);
    setTasks(tks);
    setScore(scores.get(tenant) ?? 0);
    setLoading(false);
  }

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant]);

  const status = currentClubStatus(statuses);
  const competitor = currentChurnCompetitor(statuses);
  const completedTasks = tasks.filter((t) => t.status === "completed");
  const pendingTasks = tasks.filter((t) => t.status === "pending");
  const lastActivity = completedTasks
    .map((t) => t.completed_at)
    .filter((x): x is string => !!x)
    .sort()
    .pop();

  async function handleChanged() {
    await loadAll();
    await onChanged?.();
  }

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
              <StatusPill status={status} competitor={competitor} />
              {pendingTasks.length > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 text-warning text-[11px] font-semibold px-2 py-0.5">
                  {pendingTasks.length} {pendingTasks.length === 1 ? "tarefa pendente" : "tarefas pendentes"}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="inline-flex items-center justify-center h-11 w-11 rounded hover:bg-surface shrink-0"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <section className="rounded-lg border border-border p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Score de saúde</div>
            {loading && score === null ? (
              <div className="text-sm text-muted-foreground">A carregar…</div>
            ) : (
              <div className="flex items-center gap-3 flex-wrap">
                <div className="text-3xl font-bold tabular-nums">{score ?? 0}</div>
                <HealthBadge score={score ?? 0} showScore={false} />
                {lastActivity ? (
                  <span className={`text-[11px] font-medium ${activityColorClass(lastActivity)}`} title={absoluteLabel(lastActivity)}>
                    última actividade {relativeLabelPT(lastActivity)}
                  </span>
                ) : (
                  <span className="text-[11px] font-medium text-danger">sem actividade registada</span>
                )}
              </div>
            )}
          </section>

          {history.length > 0 && <YoYSection history={history} />}

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
                        <span className={relativeColorClass(t.week_start)} title={absoluteLabel(t.week_start)}>
                          {relativeLabelPT(t.week_start)}
                        </span>
                        <span
                          className={`text-[10px] uppercase font-semibold rounded-full px-1.5 py-0.5 ${
                            t.priority >= 80
                              ? "bg-danger/15 text-danger"
                              : t.priority >= 50
                              ? "bg-warning/15 text-warning"
                              : "bg-surface text-muted-foreground"
                          }`}
                        >
                          {t.priority >= 80 ? "Alta" : t.priority >= 50 ? "Média" : "Baixa"}
                        </span>
                      </div>
                      <div className="mt-1 font-medium whitespace-pre-line">{t.reason}</div>
                      <div className="text-muted-foreground mt-0.5 whitespace-pre-line">CTA: {t.cta}</div>
                      <div className="mt-2">
                        <TaskQuickActions task={t} onChanged={handleChanged} />
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
              onClick={onClose}
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
        onCreated={handleChanged}
      />
      <AdjustScoreDialog
        open={scoreOpen}
        mode="single"
        tenant={tenant}
        currentScore={score ?? 0}
        onClose={() => setScoreOpen(false)}
        onApplied={handleChanged}
      />
    </div>
  );
}
