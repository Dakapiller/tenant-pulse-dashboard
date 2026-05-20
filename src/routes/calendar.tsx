import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, ListChecks } from "lucide-react";
import { ClubLink } from "@/components/ClubLink";
import { TaskQuickActions } from "@/components/TaskQuickActions";
import {
  fetchPendingCSTasks,
  currentWeekStart,
  type CSTask,
} from "@/lib/cs";

export const Route = createFileRoute("/calendar")({
  component: CalendarPage,
});

type ViewMode = "day" | "week" | "month";

const WEEKDAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const MONTH_NAMES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

function isoDay(d: Date): string {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
    .toISOString()
    .slice(0, 10);
}

function parseISO(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function startOfWeekMonday(d: Date): Date {
  const day = d.getDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(d, diff);
}

function priorityBadge(p: number): { label: string; cls: string } {
  if (p >= 90) return { label: "Alta", cls: "bg-danger/15 text-danger border-danger/30" };
  if (p >= 60) return { label: "Média", cls: "bg-warning/15 text-warning border-warning/30" };
  return { label: "Baixa", cls: "bg-muted text-muted-foreground border-border" };
}

function CalendarPage() {
  const [tasks, setTasks] = useState<CSTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ViewMode>("month");
  const [cursor, setCursor] = useState<Date>(() => new Date());
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  const today = isoDay(new Date());

  async function load() {
    setLoading(true);
    try {
      const rows = await fetchPendingCSTasks();
      setTasks(rows);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);

  // Group tasks by their planned day (week_start)
  const tasksByDay = useMemo(() => {
    const map = new Map<string, CSTask[]>();
    for (const t of tasks) {
      const key = t.week_start;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    for (const list of map.values()) {
      list.sort((a, b) => b.priority - a.priority);
    }
    return map;
  }, [tasks]);

  function shift(direction: -1 | 1) {
    if (view === "day") setCursor((d) => addDays(d, direction));
    else if (view === "week") setCursor((d) => addDays(d, direction * 7));
    else setCursor((d) => new Date(d.getFullYear(), d.getMonth() + direction, 1));
  }

  function goToday() {
    setCursor(new Date());
  }

  const headerLabel = useMemo(() => {
    if (view === "day") {
      return `${cursor.getDate()} de ${MONTH_NAMES[cursor.getMonth()]} ${cursor.getFullYear()}`;
    }
    if (view === "week") {
      const start = startOfWeekMonday(cursor);
      const end = addDays(start, 6);
      return `${start.getDate()} ${MONTH_NAMES[start.getMonth()].slice(0, 3)} – ${end.getDate()} ${MONTH_NAMES[end.getMonth()].slice(0, 3)} ${end.getFullYear()}`;
    }
    return `${MONTH_NAMES[cursor.getMonth()]} ${cursor.getFullYear()}`;
  }, [cursor, view]);

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-4 sm:py-6 max-w-[1400px] mx-auto space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <CalendarDays className="h-5 w-5" />
            Calendário
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Todas as tarefas planeadas — clique numa tarefa para a acionar.
          </p>
        </div>
        <Link
          to="/cs/tasks"
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-border bg-background text-sm hover:bg-surface"
        >
          <ListChecks className="h-4 w-4" />
          Ver lista de tarefas
        </Link>
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap rounded-lg border border-border bg-background p-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => shift(-1)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-surface"
            aria-label="Anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={goToday}
            className="px-3 h-8 rounded-md text-xs border border-border hover:bg-surface"
          >
            Hoje
          </button>
          <button
            type="button"
            onClick={() => shift(1)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-surface"
            aria-label="Seguinte"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <span className="ml-2 text-sm font-medium capitalize">{headerLabel}</span>
        </div>
        <div className="inline-flex rounded-md border border-border bg-background p-0.5">
          {(["day", "week", "month"] as ViewMode[]).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={
                "px-3 py-1 text-xs rounded transition-colors " +
                (view === v
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground")
              }
            >
              {v === "day" ? "Dia" : v === "week" ? "Semana" : "Mês"}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground py-12 text-center">A carregar…</div>
      ) : view === "month" ? (
        <MonthView
          cursor={cursor}
          today={today}
          tasksByDay={tasksByDay}
          openTaskId={openTaskId}
          setOpenTaskId={setOpenTaskId}
          reload={load}
        />
      ) : view === "week" ? (
        <WeekView
          cursor={cursor}
          today={today}
          tasksByDay={tasksByDay}
          openTaskId={openTaskId}
          setOpenTaskId={setOpenTaskId}
          reload={load}
        />
      ) : (
        <DayView
          cursor={cursor}
          today={today}
          tasksByDay={tasksByDay}
          openTaskId={openTaskId}
          setOpenTaskId={setOpenTaskId}
          reload={load}
        />
      )}

      <div className="text-[11px] text-muted-foreground">
        Tarefas atuais aparecem na semana de {currentWeekStart()} · tarefas com data passada são consideradas atrasadas.
      </div>
    </div>
  );
}

interface ViewProps {
  cursor: Date;
  today: string;
  tasksByDay: Map<string, CSTask[]>;
  openTaskId: string | null;
  setOpenTaskId: (id: string | null) => void;
  reload: () => Promise<void>;
}

function TaskPill({
  task,
  open,
  onToggle,
  onChanged,
  overdue,
}: {
  task: CSTask;
  open: boolean;
  onToggle: () => void;
  onChanged: () => Promise<void>;
  overdue: boolean;
}) {
  const p = priorityBadge(task.priority);
  return (
    <div className="rounded-md border border-border bg-background overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left px-2 py-1.5 hover:bg-surface flex items-start gap-1.5"
      >
        <span
          className={`inline-flex items-center px-1 py-0 rounded border text-[10px] font-medium shrink-0 ${p.cls}`}
        >
          {p.label}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-medium truncate">{task.tenant_name}</div>
          <div className="text-[11px] text-muted-foreground truncate">{task.reason}</div>
        </div>
        {overdue && (
          <span className="text-[10px] text-danger font-semibold shrink-0">Atrasada</span>
        )}
      </button>
      {open && (
        <div className="border-t border-border bg-surface/40 p-2 space-y-2">
          <div className="text-[11px]">
            <ClubLink name={task.tenant_name} />
            <span className="text-muted-foreground"> · {task.cta}</span>
          </div>
          <TaskQuickActions task={task} onChanged={onChanged} size="compact" />
        </div>
      )}
    </div>
  );
}

function MonthView({ cursor, today, tasksByDay, openTaskId, setOpenTaskId, reload }: ViewProps) {
  const firstOfMonth = startOfMonth(cursor);
  const gridStart = startOfWeekMonday(firstOfMonth);
  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) cells.push(addDays(gridStart, i));

  return (
    <div className="rounded-lg border border-border bg-background overflow-hidden">
      <div className="grid grid-cols-7 border-b border-border bg-surface/40">
        {WEEKDAYS.map((d) => (
          <div key={d} className="px-2 py-1.5 text-[11px] uppercase tracking-wide text-muted-foreground text-center">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 grid-rows-6">
        {cells.map((d, i) => {
          const key = isoDay(d);
          const inMonth = d.getMonth() === cursor.getMonth();
          const isToday = key === today;
          const list = tasksByDay.get(key) ?? [];
          const overdue = key < today;
          const show = list.slice(0, 3);
          const extra = list.length - show.length;
          return (
            <div
              key={i}
              className={
                "min-h-[110px] border-b border-r border-border p-1.5 space-y-1 " +
                (inMonth ? "bg-background" : "bg-surface/30") +
                (isToday ? " ring-1 ring-inset ring-primary/40" : "")
              }
            >
              <div className="flex items-center justify-between">
                <span className={"text-[11px] font-medium " + (inMonth ? "" : "text-muted-foreground")}>
                  {d.getDate()}
                </span>
                {list.length > 0 && (
                  <span className="text-[10px] text-muted-foreground">{list.length}</span>
                )}
              </div>
              {show.map((t) => (
                <TaskPill
                  key={t.id}
                  task={t}
                  open={openTaskId === t.id}
                  onToggle={() => setOpenTaskId(openTaskId === t.id ? null : t.id)}
                  onChanged={reload}
                  overdue={overdue}
                />
              ))}
              {extra > 0 && (
                <div className="text-[10px] text-muted-foreground px-1">+{extra} mais</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WeekView({ cursor, today, tasksByDay, openTaskId, setOpenTaskId, reload }: ViewProps) {
  const start = startOfWeekMonday(cursor);
  const days: Date[] = [];
  for (let i = 0; i < 7; i++) days.push(addDays(start, i));

  return (
    <div className="rounded-lg border border-border bg-background overflow-hidden">
      <div className="grid grid-cols-7 border-b border-border bg-surface/40">
        {days.map((d) => {
          const key = isoDay(d);
          const isToday = key === today;
          return (
            <div
              key={key}
              className={
                "px-2 py-1.5 text-center text-[11px] " +
                (isToday ? "text-primary font-semibold" : "text-muted-foreground")
              }
            >
              <div className="uppercase">{WEEKDAYS[(d.getDay() + 6) % 7]}</div>
              <div className="text-sm text-foreground font-medium">{d.getDate()}</div>
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-7 min-h-[400px]">
        {days.map((d) => {
          const key = isoDay(d);
          const list = tasksByDay.get(key) ?? [];
          const overdue = key < today;
          return (
            <div key={key} className="border-r border-border p-2 space-y-1.5">
              {list.length === 0 ? (
                <div className="text-[11px] text-muted-foreground italic">—</div>
              ) : (
                list.map((t) => (
                  <TaskPill
                    key={t.id}
                    task={t}
                    open={openTaskId === t.id}
                    onToggle={() => setOpenTaskId(openTaskId === t.id ? null : t.id)}
                    onChanged={reload}
                    overdue={overdue}
                  />
                ))
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DayView({ cursor, today, tasksByDay, openTaskId, setOpenTaskId, reload }: ViewProps) {
  const key = isoDay(cursor);
  const list = tasksByDay.get(key) ?? [];
  const overdue = key < today;

  // Also show overdue tasks when looking at today, so CS sees them at a glance
  const overdueExtra: CSTask[] = [];
  if (key === today) {
    for (const [k, ts] of tasksByDay) {
      if (k < today) overdueExtra.push(...ts);
    }
    overdueExtra.sort((a, b) => (a.week_start === b.week_start ? b.priority - a.priority : a.week_start.localeCompare(b.week_start)));
  }

  return (
    <div className="rounded-lg border border-border bg-background p-4 space-y-3">
      <div className="text-sm text-muted-foreground">
        {list.length} {list.length === 1 ? "tarefa" : "tarefas"} para este dia
      </div>
      {list.length === 0 ? (
        <div className="text-sm text-muted-foreground italic">Sem tarefas planeadas.</div>
      ) : (
        <div className="space-y-2">
          {list.map((t) => (
            <TaskPill
              key={t.id}
              task={t}
              open={openTaskId === t.id}
              onToggle={() => setOpenTaskId(openTaskId === t.id ? null : t.id)}
              onChanged={reload}
              overdue={overdue}
            />
          ))}
        </div>
      )}

      {overdueExtra.length > 0 && (
        <div className="pt-3 border-t border-border space-y-2">
          <div className="text-xs uppercase tracking-wide text-danger font-semibold">
            Atrasadas ({overdueExtra.length})
          </div>
          {overdueExtra.map((t) => (
            <TaskPill
              key={t.id}
              task={t}
              open={openTaskId === t.id}
              onToggle={() => setOpenTaskId(openTaskId === t.id ? null : t.id)}
              onChanged={reload}
              overdue
            />
          ))}
        </div>
      )}
    </div>
  );
}
