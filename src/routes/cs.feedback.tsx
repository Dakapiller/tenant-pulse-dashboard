import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Download, Search, Filter, ChevronDown, Lightbulb } from "lucide-react";
import { ClubLink } from "@/components/ClubLink";
import {
  fetchAllFeedback,
  exportFeedbackDetailedCSV,
  exportFeedbackAggregatedCSV,
  groupFeedback,
  STATUS_LABEL,
  FEEDBACK_CATEGORIES,
  FEEDBACK_STATUS_OPTIONS,
  type ProductFeedback,
  type FeedbackStatus,
} from "@/lib/feedback";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export const Route = createFileRoute("/cs/feedback")({
  component: FeedbackPage,
});

const STATUS_BADGE_CLASS: Record<FeedbackStatus, string> = {
  blocker: "bg-danger/15 text-danger border-danger/30",
  must_have: "bg-warning/15 text-warning-foreground border-warning/30",
  good_to_have: "bg-muted text-muted-foreground border-border",
};

function FeedbackPage() {
  const [items, setItems] = useState<ProductFeedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<"" | FeedbackStatus>("");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [exportOpen, setExportOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchAllFeedback()
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Erro a carregar.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((f) => {
      if (categoryFilter && f.category !== categoryFilter) return false;
      if (statusFilter && f.status_tag !== statusFilter) return false;
      if (dateFrom && f.reported_at < dateFrom) return false;
      if (dateTo && f.reported_at > dateTo) return false;
      if (q) {
        const hay = `${f.feature_name} ${f.tenant_name} ${f.category} ${f.note ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, query, categoryFilter, statusFilter, dateFrom, dateTo]);

  const groups = useMemo(() => groupFeedback(filtered), [filtered]);

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <TooltipProvider delayDuration={150}>
      <div className="px-4 sm:px-6 lg:px-8 py-4 sm:py-6 max-w-[1400px] mx-auto space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-semibold flex items-center gap-2">
              <Lightbulb className="h-5 w-5" />
              Product Feedback
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Feedback de produto reportado pelos clubes, agrupado por funcionalidade.
            </p>
          </div>

          <div className="relative">
            <button
              type="button"
              onClick={() => setExportOpen((o) => !o)}
              disabled={filtered.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-border bg-background text-sm hover:bg-surface disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              Exportar
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
            {exportOpen && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setExportOpen(false)}
                />
                <div className="absolute right-0 mt-1 w-56 rounded-md border border-border bg-background shadow-lg z-20">
                  <button
                    type="button"
                    onClick={() => {
                      exportFeedbackDetailedCSV(filtered);
                      setExportOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-surface"
                  >
                    CSV — detalhado
                    <span className="block text-[11px] text-muted-foreground">
                      Uma linha por report
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      exportFeedbackAggregatedCSV(groups);
                      setExportOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-surface border-t border-border"
                  >
                    CSV — agregado
                    <span className="block text-[11px] text-muted-foreground">
                      Uma linha por funcionalidade
                    </span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Filters */}
        <div className="rounded-lg border border-border bg-background p-3 grid grid-cols-1 md:grid-cols-5 gap-2">
          <div className="relative md:col-span-2">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Pesquisar clube, funcionalidade ou nota…"
              className="w-full pl-9 pr-3 py-2 rounded-md border border-border bg-background text-sm"
            />
          </div>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-2 py-2 rounded-md border border-border bg-background text-sm"
          >
            <option value="">Todas as categorias</option>
            {FEEDBACK_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as "" | FeedbackStatus)}
            className="px-2 py-2 rounded-md border border-border bg-background text-sm"
          >
            <option value="">Todos os status</option>
            {FEEDBACK_STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-1">
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="flex-1 px-2 py-2 rounded-md border border-border bg-background text-xs"
              title="De"
            />
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="flex-1 px-2 py-2 rounded-md border border-border bg-background text-xs"
              title="Até"
            />
          </div>
        </div>

        {/* Summary */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Filter className="h-3 w-3" />
            {filtered.length} {filtered.length === 1 ? "report" : "reports"} · {groups.length}{" "}
            {groups.length === 1 ? "funcionalidade" : "funcionalidades"}
          </span>
        </div>

        {/* Body */}
        {loading ? (
          <div className="text-sm text-muted-foreground py-12 text-center">A carregar…</div>
        ) : error ? (
          <div className="rounded-md border border-danger/30 bg-danger/10 text-danger text-sm px-3 py-2">
            {error}
          </div>
        ) : groups.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
            Sem product feedback registado{items.length > 0 ? " para estes filtros" : ""}.
          </div>
        ) : (
          <div className="space-y-2">
            {groups.map((g) => {
              const key = `${g.category}::${g.featureName.toLowerCase()}`;
              const isOpen = expanded.has(key);
              return (
                <div
                  key={key}
                  className="rounded-lg border border-border bg-background overflow-hidden"
                >
                  <button
                    type="button"
                    onClick={() => toggle(key)}
                    className="w-full px-4 py-3 flex items-center gap-3 hover:bg-surface text-left"
                  >
                    <ChevronDown
                      className={
                        "h-4 w-4 text-muted-foreground transition-transform " +
                        (isOpen ? "" : "-rotate-90")
                      }
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        {g.category}
                      </div>
                      <div className="font-medium truncate">{g.featureName}</div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap justify-end">
                      <span className="text-xs text-muted-foreground">
                        {g.clubs.size} {g.clubs.size === 1 ? "clube" : "clubes"}
                      </span>
                      {g.blocker > 0 && (
                        <span
                          className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[11px] font-medium ${STATUS_BADGE_CLASS.blocker}`}
                        >
                          {g.blocker} blocker
                        </span>
                      )}
                      {g.must > 0 && (
                        <span
                          className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[11px] font-medium ${STATUS_BADGE_CLASS.must_have}`}
                        >
                          {g.must} must
                        </span>
                      )}
                      {g.good > 0 && (
                        <span
                          className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[11px] font-medium ${STATUS_BADGE_CLASS.good_to_have}`}
                        >
                          {g.good} good
                        </span>
                      )}
                    </div>
                  </button>

                  {isOpen && (
                    <div className="border-t border-border bg-surface/30">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-[11px] uppercase tracking-wide text-muted-foreground">
                            <th className="text-left font-medium px-4 py-2">Clube</th>
                            <th className="text-left font-medium px-4 py-2 w-28">Data</th>
                            <th className="text-left font-medium px-4 py-2 w-32">Status</th>
                            <th className="text-left font-medium px-4 py-2">Nota</th>
                          </tr>
                        </thead>
                        <tbody>
                          {g.items
                            .slice()
                            .sort((a, b) => b.reported_at.localeCompare(a.reported_at))
                            .map((f) => {
                              const opt = FEEDBACK_STATUS_OPTIONS.find(
                                (o) => o.value === f.status_tag,
                              );
                              return (
                                <tr key={f.id} className="border-t border-border">
                                  <td className="px-4 py-2">
                                    <ClubLink name={f.tenant_name} />
                                  </td>
                                  <td className="px-4 py-2 text-muted-foreground tabular-nums">
                                    {f.reported_at}
                                  </td>
                                  <td className="px-4 py-2">
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span
                                          className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[11px] font-medium cursor-help ${STATUS_BADGE_CLASS[f.status_tag]}`}
                                        >
                                          {STATUS_LABEL[f.status_tag]}
                                        </span>
                                      </TooltipTrigger>
                                      <TooltipContent className="max-w-[240px] text-xs">
                                        {opt?.tooltip}
                                      </TooltipContent>
                                    </Tooltip>
                                  </td>
                                  <td className="px-4 py-2 text-muted-foreground">
                                    {f.note || "—"}
                                  </td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
