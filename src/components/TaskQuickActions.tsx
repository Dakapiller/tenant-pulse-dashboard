import { useState } from "react";
import { CheckCircle2, Clock, X } from "lucide-react";
import {
  completeCSTask,
  postponeCSTask,
  currentWeekStart,
  OUTCOME_OPTIONS,
  COMPETITOR_OPTIONS,
  type CSTask,
} from "@/lib/cs";

interface Props {
  task: CSTask;
  onChanged?: () => void | Promise<void>;
  /** Visual variant — "compact" used in inline lists. */
  size?: "compact" | "default";
}

export function TaskQuickActions({ task, onChanged, size = "compact" }: Props) {
  const [mode, setMode] = useState<"idle" | "complete" | "postpone">("idle");
  const [outcome, setOutcome] = useState(OUTCOME_OPTIONS[0].value);
  const [competitor, setCompetitor] = useState(COMPETITOR_OPTIONS[0].value);
  const [note, setNote] = useState("");
  const [target, setTarget] = useState<string>(() => {
    // default: next Monday
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 7);
    return currentWeekStart(d);
  });
  const [busy, setBusy] = useState(false);

  const btn =
    size === "compact"
      ? "inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium hover:bg-surface"
      : "inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-surface";

  async function doComplete() {
    setBusy(true);
    try {
      await completeCSTask(task.id, task.tenant_name, outcome, note.trim() || null);
      setMode("idle");
      setNote("");
      await onChanged?.();
    } finally {
      setBusy(false);
    }
  }

  async function doPostpone() {
    setBusy(true);
    try {
      await postponeCSTask(task.id, target);
      setMode("idle");
      await onChanged?.();
    } finally {
      setBusy(false);
    }
  }

  if (mode === "idle") {
    return (
      <div
        className="flex items-center gap-1.5"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => setMode("complete")}
          className={`${btn} text-success`}
          title="Marcar como concluída"
        >
          <CheckCircle2 className="h-3 w-3" /> Concluir
        </button>
        <button
          type="button"
          onClick={() => setMode("postpone")}
          className={`${btn} text-muted-foreground`}
          title="Adiar para outra semana"
        >
          <Clock className="h-3 w-3" /> Adiar
        </button>
      </div>
    );
  }

  if (mode === "complete") {
    return (
      <div
        className="rounded-md border border-border bg-background p-2 space-y-2"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Resultado</label>
          <select
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            className="px-2 py-1 rounded-md border border-border bg-background text-xs"
            autoFocus
          >
            {OUTCOME_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Comentário opcional…"
          className="w-full px-2 py-1 rounded-md border border-border bg-background text-xs"
        />
        <div className="flex items-center justify-end gap-1.5">
          <button
            type="button"
            onClick={() => setMode("idle")}
            className="px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <X className="h-3 w-3 inline" /> Cancelar
          </button>
          <button
            type="button"
            onClick={doComplete}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-md bg-foreground text-background px-2.5 py-1 text-[11px] font-medium disabled:opacity-50 hover:opacity-90"
          >
            <CheckCircle2 className="h-3 w-3" /> {busy ? "A guardar…" : "Confirmar"}
          </button>
        </div>
      </div>
    );
  }

  // postpone
  return (
    <div
      className="rounded-md border border-border bg-background p-2 space-y-2"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Adiar para</label>
        <input
          type="date"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className="px-2 py-1 rounded-md border border-border bg-background text-xs"
          autoFocus
        />
        <span className="text-[10px] text-muted-foreground">
          → semana de {currentWeekStart(new Date(target))}
        </span>
      </div>
      <div className="flex items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={() => setMode("idle")}
          className="px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <X className="h-3 w-3 inline" /> Cancelar
        </button>
        <button
          type="button"
          onClick={doPostpone}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-md bg-foreground text-background px-2.5 py-1 text-[11px] font-medium disabled:opacity-50 hover:opacity-90"
        >
          <Clock className="h-3 w-3" /> {busy ? "A guardar…" : "Adiar"}
        </button>
      </div>
    </div>
  );
}
