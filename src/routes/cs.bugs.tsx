import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Bug, Download, ExternalLink, Search } from "lucide-react";
import { format } from "date-fns";
import { pt } from "date-fns/locale";
import { toast } from "sonner";
import { ClubLink } from "@/components/ClubLink";
import {
  BUG_SEVERITY_LABEL,
  BUG_SEVERITY_OPTIONS,
  BUG_STATUS_LABEL,
  BUG_STATUS_OPTIONS,
  exportBugsXLSX,
  fetchAllBugs,
  updateBugStatus,
  type BugReport,
  type BugSeverity,
  type BugStatus,
} from "@/lib/bugs";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/cs/bugs")({
  component: BugsPage,
});

const STATUS_BADGE: Record<BugStatus, string> = {
  open: "bg-warning/15 text-warning border border-warning/30",
  in_progress: "bg-primary/15 text-primary border border-primary/30",
  solved: "bg-success/15 text-success border border-success/30",
  wont_fix: "bg-muted text-muted-foreground border border-border",
};

const SEVERITY_BADGE: Record<BugSeverity, string> = {
  blocker: "bg-danger/15 text-danger border border-danger/30",
  major: "bg-warning/15 text-warning border border-warning/30",
  minor: "bg-muted text-muted-foreground border border-border",
};

function BugsPage() {
  const [items, setItems] = useState<BugReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | BugStatus>("");
  const [severityFilter, setSeverityFilter] = useState<"" | BugSeverity>("");
  const [busyId, setBusyId] = useState<string | null>(null);

  async function reload() {
    setLoading(true);
    try {
      setItems(await fetchAllBugs());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((b) => {
      if (statusFilter && b.status !== statusFilter) return false;
      if (severityFilter && b.severity !== severityFilter) return false;
      if (q) {
        const hay = `${b.title} ${b.tenant_name} ${b.note ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, query, statusFilter, severityFilter]);

  const counters = useMemo(() => {
    const c = { open: 0, in_progress: 0, solved: 0, wont_fix: 0 };
    for (const b of items) c[b.status] += 1;
    return c;
  }, [items]);

  async function changeStatus(bug: BugReport, next: BugStatus) {
    if (next === bug.status) return;
    if (next === "solved") {
      const ok = window.confirm(
        `Marcar como Resolvido?\n\nIsto regista a data de resolução e adiciona +5 ao health score de "${bug.tenant_name}".`,
      );
      if (!ok) return;
    }
    setBusyId(bug.id);
    try {
      await updateBugStatus(bug, next);
      if (next === "solved") {
        toast.success(`Bug resolvido — health score de ${bug.tenant_name} +5`);
      } else {
        toast.success(`Estado atualizado: ${BUG_STATUS_LABEL[next]}`);
      }
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro a atualizar estado.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-4 sm:py-6 max-w-[1400px] mx-auto space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Bug className="h-5 w-5" />
            Bug Reports
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Bugs reportados por clube. Resolver um bug adiciona +5 ao health score.
          </p>
        </div>
        <button
          type="button"
          onClick={() => exportBugsXLSX(filtered)}
          disabled={filtered.length === 0}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-border bg-background text-sm hover:bg-surface disabled:opacity-50"
        >
          <Download className="h-4 w-4" />
          Exportar Excel
        </button>
      </div>

      {/* Counters */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {([
          { k: "open", label: "Abertos" },
          { k: "in_progress", label: "Em curso" },
          { k: "solved", label: "Resolvidos" },
          { k: "wont_fix", label: "Não corrigidos" },
        ] as { k: BugStatus; label: string }[]).map((c) => (
          <button
            key={c.k}
            type="button"
            onClick={() => setStatusFilter(statusFilter === c.k ? "" : c.k)}
            className={cn(
              "rounded-lg border bg-surface p-3 text-left transition-colors",
              statusFilter === c.k ? "border-foreground" : "border-border hover:bg-muted/40",
            )}
          >
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{c.label}</div>
            <div className="text-2xl font-semibold mt-1">{counters[c.k]}</div>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="rounded-lg border border-border bg-background p-3 grid grid-cols-1 md:grid-cols-4 gap-2">
        <div className="relative md:col-span-2">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Pesquisar clube, título ou nota…"
            className="w-full pl-9 pr-3 py-2 rounded-md border border-border bg-background text-sm"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as "" | BugStatus)}
          className="px-2 py-2 rounded-md border border-border bg-background text-sm"
        >
          <option value="">Todos os estados</option>
          {BUG_STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select
          value={severityFilter}
          onChange={(e) => setSeverityFilter(e.target.value as "" | BugSeverity)}
          className="px-2 py-2 rounded-md border border-border bg-background text-sm"
        >
          <option value="">Todas as severidades</option>
          {BUG_SEVERITY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border bg-surface overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">A carregar…</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Sem bugs nos filtros selecionados.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/30">
                <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="text-left font-medium px-3 py-2">Clube</th>
                  <th className="text-left font-medium px-3 py-2">Título</th>
                  <th className="text-left font-medium px-3 py-2 whitespace-nowrap">Severidade</th>
                  <th className="text-left font-medium px-3 py-2 whitespace-nowrap">Estado</th>
                  <th className="text-left font-medium px-3 py-2 whitespace-nowrap">Data</th>
                  <th className="text-left font-medium px-3 py-2 whitespace-nowrap">Resolvido</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((b) => (
                  <tr key={b.id} className="border-t border-border align-top">
                    <td className="px-3 py-2 whitespace-nowrap">
                      <ClubLink name={b.tenant_name} className="hover:underline" />
                    </td>
                    <td className="px-3 py-2">
                      <a
                        href={b.link}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-1 hover:underline"
                        title={b.link}
                      >
                        <span className="line-clamp-2">{b.title}</span>
                        <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
                      </a>
                      {b.note && (
                        <div className="text-xs text-muted-foreground italic mt-1 line-clamp-2">"{b.note}"</div>
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", SEVERITY_BADGE[b.severity])}>
                        {BUG_SEVERITY_LABEL[b.severity]}
                      </span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", STATUS_BADGE[b.status])}>
                          {BUG_STATUS_LABEL[b.status]}
                        </span>
                        <select
                          value={b.status}
                          disabled={busyId === b.id}
                          onChange={(e) => changeStatus(b, e.target.value as BugStatus)}
                          className="text-xs px-2 py-1 rounded border border-border bg-background disabled:opacity-50"
                          aria-label="Mudar estado"
                        >
                          {BUG_STATUS_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      </div>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                      {format(new Date(b.reported_at), "dd MMM yyyy", { locale: pt })}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                      {b.solved_at ? format(new Date(b.solved_at), "dd MMM yyyy", { locale: pt }) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
