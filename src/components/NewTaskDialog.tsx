import { useEffect, useMemo, useState } from "react";
import { X, Search, Info, ListChecks, Calendar as CalendarIcon, Lightbulb, Bug } from "lucide-react";
import {
  insertManualCSTask,
  insertManualCSTaskCompleted,
  currentWeekStart,
  OUTCOME_OPTIONS,
} from "@/lib/cs";
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_STATUS_OPTIONS,
  fetchFeatureNamesByCategory,
  insertProductFeedback,
  type FeedbackCategory,
  type FeedbackStatus,
} from "@/lib/feedback";
import {
  BUG_SEVERITY_OPTIONS,
  BUG_STATUS_OPTIONS,
  insertBugReport,
  type BugSeverity,
  type BugStatus,
} from "@/lib/bugs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated?: () => void | Promise<void>;
  /** Pre-selected club. When provided, the club picker is hidden. */
  tenant?: string;
  /** All active club names — used when the picker is shown. */
  activeClubs?: string[];
}

type DialogTab = "task" | "future" | "feedback" | "bug";
type FutureMode = "1w" | "1m" | "custom";


const PRIORITY_OPTIONS = [
  { value: 30, label: "Baixa" },
  { value: 60, label: "Média" },
  { value: 90, label: "Alta" },
];

function addDaysISO(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function addMonthsISO(months: number): string {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function NewTaskDialog({ open, onClose, onCreated, tenant, activeClubs = [] }: Props) {
  const thisWeek = useMemo(() => currentWeekStart(), []);

  const [tab, setTab] = useState<DialogTab>("task");

  // ---- shared tenant picker ----
  const [selectedTenant, setSelectedTenant] = useState<string>(tenant ?? "");
  const [tenantQuery, setTenantQuery] = useState("");

  // ---- task fields (shared between "task" and "future") ----
  const [reason, setReason] = useState("");
  const [cta, setCta] = useState("");
  const [priority, setPriority] = useState<number>(60);

  // ---- "task" — mark as already completed ----
  const [markCompleted, setMarkCompleted] = useState(false);
  const [outcome, setOutcome] = useState(OUTCOME_OPTIONS[0].value);
  const [completedNote, setCompletedNote] = useState("");

  // ---- "future" ----
  const [futureMode, setFutureMode] = useState<FutureMode>("1w");
  const [customDate, setCustomDate] = useState<string>(addDaysISO(7));

  // ---- "feedback" ----
  const [reportedAt, setReportedAt] = useState<string>(todayISO());
  const [category, setCategory] = useState<FeedbackCategory | "">("");
  const [featureName, setFeatureName] = useState("");
  const [featureSuggestions, setFeatureSuggestions] = useState<string[]>([]);
  const [statusTag, setStatusTag] = useState<FeedbackStatus>("must_have");
  const [feedbackNote, setFeedbackNote] = useState("");

  // ---- "bug" ----
  const [bugTitle, setBugTitle] = useState("");
  const [bugLink, setBugLink] = useState("");
  const [bugSeverity, setBugSeverity] = useState<BugSeverity>("major");
  const [bugStatus, setBugStatus] = useState<BugStatus>("open");
  const [bugReportedAt, setBugReportedAt] = useState<string>(todayISO());
  const [bugNote, setBugNote] = useState("");


  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTab("task");
      setSelectedTenant(tenant ?? "");
      setTenantQuery("");
      setReason("");
      setCta("");
      setPriority(60);
      setMarkCompleted(false);
      setOutcome(OUTCOME_OPTIONS[0].value);
      setCompletedNote("");
      setFutureMode("1w");
      setCustomDate(addDaysISO(7));
      setReportedAt(todayISO());
      setCategory("");
      setFeatureName("");
      setFeatureSuggestions([]);
      setStatusTag("must_have");
      setFeedbackNote("");
      setBugTitle("");
      setBugLink("");
      setBugSeverity("major");
      setBugStatus("open");
      setBugReportedAt(todayISO());
      setBugNote("");
      setError(null);
    }
  }, [open, tenant]);

  // Load feature suggestions when category changes.
  useEffect(() => {
    if (!open || tab !== "feedback" || !category) {
      setFeatureSuggestions([]);
      return;
    }
    let cancelled = false;
    fetchFeatureNamesByCategory(category)
      .then((names) => {
        if (!cancelled) setFeatureSuggestions(names);
      })
      .catch(() => {
        if (!cancelled) setFeatureSuggestions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, tab, category]);

  if (!open) return null;

  const filteredClubs = activeClubs
    .filter((n) => !tenantQuery || n.toLowerCase().includes(tenantQuery.toLowerCase()))
    .slice(0, 30);

  function computeWeekStart(): string {
    if (tab === "task") return thisWeek;
    // "future"
    const iso =
      futureMode === "1w" ? addDaysISO(7) : futureMode === "1m" ? addMonthsISO(1) : customDate;
    return currentWeekStart(new Date(iso));
  }

  async function submit() {
    setError(null);
    if (!selectedTenant) {
      setError("Escolhe um clube.");
      return;
    }

    setBusy(true);
    try {
      if (tab === "feedback") {
        if (!category) throw new Error("Escolhe uma categoria.");
        if (!featureName.trim()) throw new Error("Indica a funcionalidade.");
        await insertProductFeedback({
          tenant: selectedTenant,
          reportedAt,
          category,
          featureName,
          statusTag,
          note: feedbackNote,
        });
      } else if (tab === "bug") {
        await insertBugReport({
          tenant: selectedTenant,
          title: bugTitle,
          link: bugLink,
          severity: bugSeverity,
          status: bugStatus,
          reportedAt: bugReportedAt,
          note: bugNote,
        });
      } else {
        if (reason.trim().length === 0) throw new Error("Razão obrigatória.");
        if (cta.trim().length === 0) throw new Error("CTA obrigatório.");
        const weekStart = computeWeekStart();
        if (tab === "task" && markCompleted) {
          await insertManualCSTaskCompleted({
            tenant: selectedTenant,
            reason,
            cta,
            priority,
            weekStart,
            outcome,
            note: completedNote,
          });
        } else {
          await insertManualCSTask({
            tenant: selectedTenant,
            reason,
            cta,
            priority,
            weekStart,
          });
        }
      }
      await onCreated?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao guardar.");
    } finally {
      setBusy(false);
    }
  }

  const tabs: { value: DialogTab; label: string; icon: typeof ListChecks }[] = [
    { value: "task", label: "Tarefa", icon: ListChecks },
    { value: "future", label: "Tarefa futura", icon: CalendarIcon },
    { value: "bug", label: "Bug Report", icon: Bug },
    { value: "feedback", label: "Product Feedback", icon: Lightbulb },
  ];

  const titleByTab: Record<DialogTab, string> = {
    task: "Nova tarefa",
    future: "Nova tarefa futura",
    feedback: "Novo product feedback",
    bug: "Novo bug report",
  };

  const submitLabelByTab: Record<DialogTab, string> = {
    task: markCompleted ? "Registar concluída" : "Criar tarefa",
    future: "Agendar tarefa",
    feedback: "Registar feedback",
    bug: "Registar bug",
  };

  return (
    <TooltipProvider delayDuration={150}>
      <div
        className="fixed inset-0 z-[60] flex items-end md:items-center md:justify-center"
        onMouseDown={onClose}
      >
        <div className="absolute inset-0 bg-black/40" />
        <div
          className="relative w-full md:max-w-lg bg-background border-t md:border border-border md:rounded-xl shadow-xl rounded-t-2xl max-h-[90vh] overflow-y-auto"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="sticky top-0 bg-background border-b border-border px-5 py-4 flex items-center justify-between z-10">
            <h2 className="text-lg font-semibold">{titleByTab[tab]}</h2>
            <button
              onClick={onClose}
              className="h-9 w-9 inline-flex items-center justify-center rounded hover:bg-surface"
              aria-label="Fechar"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Tabs */}
          <div className="px-5 pt-4">
            <div className="inline-flex rounded-md border border-border p-0.5 w-full">
              {tabs.map((t) => {
                const Icon = t.icon;
                const active = tab === t.value;
                return (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => {
                      setTab(t.value);
                      setError(null);
                    }}
                    className={
                      "flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs rounded transition-colors " +
                      (active
                        ? "bg-foreground text-background"
                        : "text-muted-foreground hover:text-foreground")
                    }
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span className="truncate">{t.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="p-5 space-y-4">
            {/* Tenant picker — shared by all tabs */}
            <div>
              <label className="block text-xs uppercase tracking-wide text-muted-foreground mb-1.5">
                Clube
              </label>
              {tenant ? (
                <div className="px-3 py-2.5 rounded-md border border-border bg-surface text-sm">
                  {tenant}
                </div>
              ) : selectedTenant ? (
                <div className="flex items-center gap-2">
                  <div className="flex-1 px-3 py-2.5 rounded-md border border-border bg-surface text-sm">
                    {selectedTenant}
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedTenant("")}
                    className="text-xs text-muted-foreground hover:text-foreground px-2 py-1"
                  >
                    Mudar
                  </button>
                </div>
              ) : (
                <div>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <input
                      type="text"
                      autoFocus
                      value={tenantQuery}
                      onChange={(e) => setTenantQuery(e.target.value)}
                      placeholder="Pesquisar clube ativo…"
                      className="w-full pl-9 pr-3 py-2.5 rounded-md border border-border bg-background text-sm min-h-11"
                    />
                  </div>
                  {tenantQuery && (
                    <ul className="mt-1 max-h-48 overflow-y-auto rounded-md border border-border bg-background divide-y divide-border">
                      {filteredClubs.length === 0 ? (
                        <li className="px-3 py-2 text-xs text-muted-foreground">
                          Sem resultados.
                        </li>
                      ) : (
                        filteredClubs.map((n) => (
                          <li key={n}>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedTenant(n);
                                setTenantQuery("");
                              }}
                              className="w-full text-left px-3 py-2 text-sm hover:bg-surface"
                            >
                              {n}
                            </button>
                          </li>
                        ))
                      )}
                    </ul>
                  )}
                </div>
              )}
            </div>

            {/* ============ TASK / FUTURE TASK ============ */}
            {tab !== "feedback" && (
              <>
                <div>
                  <label className="block text-xs uppercase tracking-wide text-muted-foreground mb-1.5">
                    Razão{" "}
                    <span className="text-muted-foreground/60 normal-case">
                      ({reason.length}/500)
                    </span>
                  </label>
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value.slice(0, 500))}
                    rows={3}
                    placeholder="Porque é que esta tarefa existe?"
                    className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-foreground/20"
                  />
                </div>

                <div>
                  <label className="block text-xs uppercase tracking-wide text-muted-foreground mb-1.5">
                    CTA{" "}
                    <span className="text-muted-foreground/60 normal-case">
                      ({cta.length}/200)
                    </span>
                  </label>
                  <input
                    type="text"
                    value={cta}
                    onChange={(e) => setCta(e.target.value.slice(0, 200))}
                    placeholder="O que fazer? (ex.: Ligar ao gestor)"
                    className="w-full px-3 py-2.5 rounded-md border border-border bg-background text-sm min-h-11 focus:outline-none focus:ring-2 focus:ring-foreground/20"
                  />
                </div>

                <div>
                  <label className="block text-xs uppercase tracking-wide text-muted-foreground mb-1.5">
                    Prioridade
                  </label>
                  <select
                    value={priority}
                    onChange={(e) => setPriority(Number(e.target.value))}
                    className="w-full px-3 py-2.5 rounded-md border border-border bg-background text-sm min-h-11"
                  >
                    {PRIORITY_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>

                {tab === "future" && (
                  <div className="space-y-2">
                    <label className="block text-xs uppercase tracking-wide text-muted-foreground">
                      Quando
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {(
                        [
                          { v: "1w", label: "Daqui a 1 semana" },
                          { v: "1m", label: "Daqui a 1 mês" },
                          { v: "custom", label: "Data específica" },
                        ] as { v: FutureMode; label: string }[]
                      ).map((o) => (
                        <button
                          key={o.v}
                          type="button"
                          onClick={() => setFutureMode(o.v)}
                          className={
                            "px-2 py-2 rounded-md border text-xs transition-colors " +
                            (futureMode === o.v
                              ? "border-foreground bg-foreground text-background"
                              : "border-border hover:bg-surface")
                          }
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                    {futureMode === "custom" && (
                      <input
                        type="date"
                        value={customDate}
                        min={todayISO()}
                        onChange={(e) => setCustomDate(e.target.value)}
                        className="w-full px-3 py-2.5 rounded-md border border-border bg-background text-sm min-h-11"
                      />
                    )}
                    <p className="text-[11px] text-muted-foreground">
                      Tarefa será criada na semana de{" "}
                      <span className="font-medium text-foreground">{computeWeekStart()}</span>.
                    </p>
                  </div>
                )}

                {tab === "task" && (
                  <div className="rounded-md border border-border bg-surface/40 p-3 space-y-3">
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={markCompleted}
                        onChange={(e) => setMarkCompleted(e.target.checked)}
                      />
                      <span>Marcar como já concluída (só para registo histórico)</span>
                    </label>
                    {markCompleted && (
                      <div className="space-y-2">
                        <div>
                          <label className="block text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                            Resultado
                          </label>
                          <select
                            value={outcome}
                            onChange={(e) => setOutcome(e.target.value)}
                            className="w-full px-2 py-2 rounded-md border border-border bg-background text-xs"
                          >
                            {OUTCOME_OPTIONS.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <input
                          value={completedNote}
                          onChange={(e) => setCompletedNote(e.target.value.slice(0, 500))}
                          placeholder="Comentário (opcional)…"
                          className="w-full px-2 py-2 rounded-md border border-border bg-background text-xs"
                        />
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {/* ============ FEEDBACK ============ */}
            {tab === "feedback" && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs uppercase tracking-wide text-muted-foreground mb-1.5">
                      Data do report
                    </label>
                    <input
                      type="date"
                      value={reportedAt}
                      max={todayISO()}
                      onChange={(e) => setReportedAt(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-md border border-border bg-background text-sm min-h-11"
                    />
                  </div>
                  <div>
                    <label className="block text-xs uppercase tracking-wide text-muted-foreground mb-1.5">
                      Categoria
                    </label>
                    <select
                      value={category}
                      onChange={(e) => {
                        setCategory(e.target.value as FeedbackCategory);
                        setFeatureName("");
                      }}
                      className="w-full px-3 py-2.5 rounded-md border border-border bg-background text-sm min-h-11"
                    >
                      <option value="">Escolher…</option>
                      {FEEDBACK_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs uppercase tracking-wide text-muted-foreground mb-1.5">
                    Funcionalidade
                  </label>
                  <input
                    type="text"
                    list="feature-suggestions"
                    value={featureName}
                    onChange={(e) => setFeatureName(e.target.value.slice(0, 200))}
                    placeholder={
                      category
                        ? featureSuggestions.length
                          ? "Escolher existente ou escrever nova…"
                          : "Nome da funcionalidade…"
                        : "Escolhe a categoria primeiro"
                    }
                    disabled={!category}
                    className="w-full px-3 py-2.5 rounded-md border border-border bg-background text-sm min-h-11 disabled:opacity-50"
                  />
                  <datalist id="feature-suggestions">
                    {featureSuggestions.map((f) => (
                      <option key={f} value={f} />
                    ))}
                  </datalist>
                  {featureSuggestions.length > 0 && (
                    <p className="text-[11px] text-muted-foreground mt-1">
                      {featureSuggestions.length}{" "}
                      {featureSuggestions.length === 1
                        ? "funcionalidade já registada"
                        : "funcionalidades já registadas"}{" "}
                      nesta categoria.
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-xs uppercase tracking-wide text-muted-foreground mb-1.5">
                    Status
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {FEEDBACK_STATUS_OPTIONS.map((o) => {
                      const active = statusTag === o.value;
                      return (
                        <button
                          key={o.value}
                          type="button"
                          onClick={() => setStatusTag(o.value)}
                          className={
                            "relative px-2 py-2 rounded-md border text-xs transition-colors " +
                            (active
                              ? "border-foreground bg-foreground text-background"
                              : "border-border hover:bg-surface")
                          }
                        >
                          <span className="block">{o.label}</span>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span
                                role="button"
                                tabIndex={-1}
                                onClick={(e) => e.stopPropagation()}
                                className="absolute top-1 right-1 inline-flex h-4 w-4 items-center justify-center opacity-70 hover:opacity-100"
                              >
                                <Info className="h-3 w-3" />
                              </span>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-[240px] text-xs">
                              {o.tooltip}
                            </TooltipContent>
                          </Tooltip>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="block text-xs uppercase tracking-wide text-muted-foreground mb-1.5">
                    Nota{" "}
                    <span className="text-muted-foreground/60 normal-case">
                      ({feedbackNote.length}/500)
                    </span>
                  </label>
                  <textarea
                    value={feedbackNote}
                    onChange={(e) => setFeedbackNote(e.target.value.slice(0, 500))}
                    rows={3}
                    placeholder="Contexto adicional, citações do clube…"
                    className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-foreground/20"
                  />
                </div>
              </>
            )}

            {error && (
              <div className="rounded-md border border-danger/30 bg-danger/10 text-danger text-sm px-3 py-2">
                {error}
              </div>
            )}
          </div>

          <div className="sticky bottom-0 bg-background border-t border-border px-5 py-3 flex items-center justify-end gap-2">
            <button
              onClick={onClose}
              disabled={busy}
              className="px-4 min-h-11 text-sm rounded-md hover:bg-surface text-muted-foreground"
            >
              Cancelar
            </button>
            <button
              onClick={submit}
              disabled={busy}
              className="inline-flex items-center justify-center px-4 min-h-11 rounded-md bg-foreground text-background text-sm font-medium hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "A guardar…" : submitLabelByTab[tab]}
            </button>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
