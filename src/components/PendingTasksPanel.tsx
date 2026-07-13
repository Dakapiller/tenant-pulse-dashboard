import { useMemo, useState } from "react";
import { Ban, CheckCircle2, Clock } from "lucide-react";
import { ClubLink } from "@/components/ClubLink";
import { DataTable } from "@/components/DataTable";
import { OUTCOME_OPTIONS, currentWeekStart, type CSTask } from "@/lib/cs";
import { FLAG_META, type RiskFlag } from "@/lib/risk";
import { relativeLabelPT, relativeColorClass, absoluteLabel } from "@/lib/relativeTime";

export type PendingTaskFilter = "all" | "thisWeek" | "overdue" | "manual" | "auto";

/** Flat per-task view of pending tasks with chip filters and per-task selection. */
export function PendingTasksFlatView({
  tasks, excluded, showInactive, weekStart, filter, onFilterChange,
  selectedIds, onSelectionChange,
}: {
  tasks: CSTask[];
  excluded: Set<string>;
  showInactive: boolean;
  weekStart: string;
  filter: PendingTaskFilter;
  onFilterChange: (f: PendingTaskFilter) => void;
  selectedIds: Set<string>;
  onSelectionChange: (next: Set<string>) => void;
}) {
  type TaskRow = CSTask & { ageDays: number; isOverdue: boolean; isManual: boolean };

  const rows: TaskRow[] = useMemo(() => {
    const now = Date.now();
    return tasks
      .filter((t) => showInactive || !excluded.has(t.tenant_name))
      .map((t) => {
        const ageDays = Math.max(0, Math.floor((now - new Date(t.created_at).getTime()) / 86_400_000));
        const isOverdue = t.week_start < weekStart;
        const isManual = (t.flags ?? []).includes("manual");
        return { ...t, ageDays, isOverdue, isManual };
      })
      .filter((r) => {
        if (filter === "thisWeek") return r.week_start === weekStart;
        if (filter === "overdue") return r.isOverdue;
        if (filter === "manual") return r.isManual;
        if (filter === "auto") return !r.isManual;
        return true;
      });
  }, [tasks, excluded, showInactive, weekStart, filter]);

  const chips: { value: PendingTaskFilter; label: string; count: number }[] = useMemo(() => {
    const base = tasks.filter((t) => showInactive || !excluded.has(t.tenant_name));
    return [
      { value: "all", label: "Todas", count: base.length },
      { value: "thisWeek", label: "Esta semana", count: base.filter((t) => t.week_start === weekStart).length },
      { value: "overdue", label: "Atrasadas", count: base.filter((t) => t.week_start < weekStart).length },
      { value: "manual", label: "Manuais", count: base.filter((t) => (t.flags ?? []).includes("manual")).length },
      { value: "auto", label: "Automáticas", count: base.filter((t) => !(t.flags ?? []).includes("manual")).length },
    ];
  }, [tasks, excluded, showInactive, weekStart]);

  return (
    <div className="p-5 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        {chips.map((c) => (
          <button
            key={c.value}
            onClick={() => onFilterChange(c.value)}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              filter === c.value
                ? "bg-foreground text-background border-foreground"
                : "bg-background text-foreground border-border hover:bg-surface"
            }`}
          >
            {c.label}
            <span className={`text-[10px] ${filter === c.value ? "opacity-80" : "text-muted-foreground"}`}>{c.count}</span>
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="text-sm text-muted-foreground text-center py-8">Sem tarefas neste filtro.</div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <DataTable<TaskRow>
            rows={rows}
            rowKey={(r) => r.id}
            pageSize={100}
            selectable
            selectedKeys={selectedIds}
            onSelectionChange={onSelectionChange}
            defaultSort={{ key: "ageDays", dir: "desc" }}
            columns={[
              {
                key: "tenant", header: "Clube",
                sortValue: (r) => r.tenant_name,
                filterValue: (r) => r.tenant_name, filter: { kind: "text" },
                render: (r) => (<ClubLink name={r.tenant_name} className="font-medium hover:underline" />),
              },
              {
                key: "reason", header: "Motivo",
                sortValue: (r) => r.reason ?? "",
                render: (r) => {
                  const first = (r.reason ?? "").split("\n")[0] || "—";
                  return (
                    <div className="max-w-[420px]">
                      <div className="text-sm truncate" title={r.reason ?? ""}>{first}</div>
                      {r.flags && r.flags.length > 0 && (
                        <div className="mt-0.5 flex flex-wrap gap-1">
                          {r.flags.map((f, i) => (
                            <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                              {FLAG_META[f as RiskFlag]?.label ?? f}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                },
              },
              {
                key: "week", header: "Semana",
                sortValue: (r) => r.week_start,
                render: (r) => (
                  <span
                    className={`text-xs ${r.isOverdue ? "text-danger font-medium" : relativeColorClass(r.week_start)}`}
                    title={absoluteLabel(r.week_start)}
                  >
                    {relativeLabelPT(r.week_start)}{r.isOverdue ? " · atrasada" : ""}
                  </span>
                ),
              },
              {
                key: "ageDays", header: "Idade",
                sortValue: (r) => r.ageDays,
                render: (r) => (<span className="text-xs text-muted-foreground">{r.ageDays}d</span>),
              },
              {
                key: "source", header: "Origem",
                sortValue: (r) => (r.isManual ? "manual" : "auto"),
                filter: { kind: "select", options: [
                  { value: "manual", label: "Manual" }, { value: "auto", label: "Automática" },
                ]},
                filterValue: (r) => (r.isManual ? "manual" : "auto"),
                render: (r) => (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${r.isManual ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                    {r.isManual ? "Manual" : "Auto"}
                  </span>
                ),
              },
            ]}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Barra fixa de ações em massa, com 3 modos: Concluir, Anular, Adiar.
 * O modo "Concluir" está sempre disponível; "Anular" e "Adiar" só aparecem
 * quando o caller os passa (no modo de seleção por clube só faz sentido
 * concluir; no modo por tarefa estão todos disponíveis).
 */
export function BulkActionBar({
  count, label, allowCancel, allowPostpone,
  onComplete, onCancelTasks, onPostponeTasks, onCancel,
}: {
  count: number;
  label: string;
  allowCancel: boolean;
  allowPostpone: boolean;
  onComplete: (outcome: string, note: string) => Promise<void>;
  onCancelTasks?: (note: string) => Promise<void>;
  onPostponeTasks?: (target: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<"complete" | "cancel" | "postpone">("complete");
  const [outcome, setOutcome] = useState(OUTCOME_OPTIONS[0].value);
  const [note, setNote] = useState("");
  const [cancelNote, setCancelNote] = useState("");
  const [target, setTarget] = useState<string>(() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 7);
    return currentWeekStart(d);
  });
  const [busy, setBusy] = useState(false);

  void count;
  const cancelValid = cancelNote.trim().length >= 1 && cancelNote.trim().length <= 200;

  return (
    <div
      className="fixed left-0 right-0 bottom-0 z-40 lg:left-60 border-t border-border bg-background/95 backdrop-blur shadow-lg"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-auto max-w-[1400px] px-4 py-3 space-y-2">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm font-medium">{label}</span>
          {(allowCancel || allowPostpone) && (
            <div className="inline-flex rounded-md border border-border bg-background p-0.5">
              <button
                onClick={() => setMode("complete")}
                className={`px-2.5 py-1 text-xs rounded ${mode === "complete" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
              >Concluir</button>
              {allowCancel && (
                <button
                  onClick={() => setMode("cancel")}
                  className={`px-2.5 py-1 text-xs rounded ${mode === "cancel" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
                >Anular</button>
              )}
              {allowPostpone && (
                <button
                  onClick={() => setMode("postpone")}
                  className={`px-2.5 py-1 text-xs rounded ${mode === "postpone" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
                >Adiar</button>
              )}
            </div>
          )}
          <button onClick={onCancel} className="text-sm text-muted-foreground hover:text-foreground px-2 py-2 ml-auto">Cancelar</button>
        </div>

        {mode === "complete" && (
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
              className="px-2 py-1.5 text-base sm:text-sm rounded-md border border-border bg-background"
            >
              {OUTCOME_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Nota opcional…"
              className="px-2 py-1.5 text-base sm:text-sm rounded-md border border-border bg-background min-w-[180px] flex-1"
            />
            <button
              onClick={async () => {
                setBusy(true);
                try { await onComplete(outcome, note); setNote(""); } finally { setBusy(false); }
              }}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-md bg-foreground text-background px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
            >
              <CheckCircle2 className="h-4 w-4" /> {busy ? "A guardar…" : "Concluir"}
            </button>
          </div>
        )}

        {mode === "cancel" && allowCancel && onCancelTasks && (
          <div className="flex items-center gap-2 flex-wrap">
            <input
              value={cancelNote}
              onChange={(e) => setCancelNote(e.target.value)}
              placeholder="Motivo da anulação (obrigatório, 1–200 chars)…"
              maxLength={200}
              className="px-2 py-1.5 text-base sm:text-sm rounded-md border border-border bg-background min-w-[260px] flex-1"
            />
            <span className="text-[11px] text-muted-foreground">{cancelNote.trim().length}/200</span>
            <button
              onClick={async () => {
                if (!cancelValid) return;
                setBusy(true);
                try { await onCancelTasks(cancelNote); setCancelNote(""); } finally { setBusy(false); }
              }}
              disabled={busy || !cancelValid}
              className="inline-flex items-center gap-1.5 rounded-md bg-danger text-background px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
            >
              <Ban className="h-4 w-4" /> {busy ? "A guardar…" : "Anular"}
            </button>
          </div>
        )}

        {mode === "postpone" && allowPostpone && onPostponeTasks && (
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Adiar para</label>
            <input
              type="date"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="px-2 py-1.5 text-sm rounded-md border border-border bg-background"
            />
            <span className="text-[11px] text-muted-foreground">
              → semana de {currentWeekStart(new Date(target))}
            </span>
            <button
              onClick={async () => {
                setBusy(true);
                try { await onPostponeTasks(target); } finally { setBusy(false); }
              }}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-md bg-foreground text-background px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50 ml-auto"
            >
              <Clock className="h-4 w-4" /> {busy ? "A guardar…" : "Adiar"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
