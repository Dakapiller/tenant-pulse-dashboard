import { Fragment, useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Filter as FilterIcon, X } from "lucide-react";

export type SortDir = "asc" | "desc" | null;

export type FilterType =
  | { kind: "text" }
  | { kind: "select"; options: { value: string; label: string }[] };

export interface ColumnDef<T> {
  key: string;
  header: string;
  align?: "left" | "right" | "center";
  render: (row: T) => ReactNode;
  /** Value used for sorting (return null to sort last) */
  sortValue?: (row: T) => string | number | null;
  /** Value used for filtering (string match) */
  filterValue?: (row: T) => string;
  filter?: FilterType;
  /** Whether sorting is enabled (default true if sortValue provided) */
  sortable?: boolean;
  className?: string;
  thClassName?: string;
}

export interface DataTableProps<T> {
  rows: T[];
  columns: ColumnDef<T>[];
  rowKey: (row: T) => string;
  defaultSort?: { key: string; dir: SortDir };
  rowClassName?: (row: T) => string;
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
  stickyHeader?: boolean;
  containerClassName?: string;
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  defaultSort,
  rowClassName,
  onRowClick,
  emptyMessage = "Sem dados.",
  stickyHeader = false,
  containerClassName = "",
}: DataTableProps<T>) {
  const [sort, setSort] = useState<{ key: string; dir: SortDir }>(
    defaultSort ?? { key: "", dir: null },
  );
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [openFilter, setOpenFilter] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let r = rows;
    for (const col of columns) {
      const f = filters[col.key];
      if (!f) continue;
      const norm = f.toLowerCase();
      r = r.filter((row) => {
        const v = col.filterValue ? col.filterValue(row) : "";
        if (col.filter?.kind === "select") return v === f;
        return v.toLowerCase().includes(norm);
      });
    }
    if (sort.key && sort.dir) {
      const col = columns.find((c) => c.key === sort.key);
      if (col?.sortValue) {
        const dir = sort.dir === "asc" ? 1 : -1;
        r = [...r].sort((a, b) => {
          const va = col.sortValue!(a);
          const vb = col.sortValue!(b);
          if (va === null && vb === null) return 0;
          if (va === null) return 1;
          if (vb === null) return -1;
          if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
          return String(va).localeCompare(String(vb), "pt-PT") * dir;
        });
      }
    }
    return r;
  }, [rows, columns, filters, sort]);

  function toggleSort(key: string) {
    setSort((cur) => {
      if (cur.key !== key) return { key, dir: "asc" };
      if (cur.dir === "asc") return { key, dir: "desc" };
      if (cur.dir === "desc") return { key: "", dir: null };
      return { key, dir: "asc" };
    });
  }

  return (
    <div className={`overflow-auto ${containerClassName}`}>
      <table className="w-full text-sm">
        <thead className={`bg-surface text-xs uppercase tracking-wide text-muted-foreground ${stickyHeader ? "sticky top-0 z-10" : ""}`}>
          <tr>
            {columns.map((col) => {
              const align = col.align ?? "left";
              const sortable = col.sortable !== false && !!col.sortValue;
              const isSorted = sort.key === col.key && sort.dir;
              const filterActive = !!filters[col.key];
              return (
                <th
                  key={col.key}
                  className={`px-4 py-3 ${align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left"} ${col.thClassName ?? ""}`}
                >
                  <div className={`inline-flex items-center gap-1 ${align === "right" ? "flex-row-reverse" : ""}`}>
                    {sortable ? (
                      <button
                        onClick={() => toggleSort(col.key)}
                        className="inline-flex items-center gap-1 hover:text-foreground"
                        type="button"
                      >
                        <span>{col.header}</span>
                        {isSorted ? (
                          sort.dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                        ) : (
                          <ArrowUpDown className="h-3 w-3 opacity-40" />
                        )}
                      </button>
                    ) : (
                      <span>{col.header}</span>
                    )}
                    {col.filter && (
                      <div className="relative">
                        <button
                          onClick={() => setOpenFilter(openFilter === col.key ? null : col.key)}
                          className={`p-0.5 rounded hover:bg-background ${filterActive ? "text-foreground" : "opacity-40 hover:opacity-100"}`}
                          type="button"
                          aria-label="Filtrar"
                        >
                          <FilterIcon className="h-3 w-3" />
                        </button>
                        {openFilter === col.key && (
                          <div className="absolute z-20 top-full mt-1 right-0 bg-background border border-border rounded-md shadow-lg p-2 min-w-44 normal-case tracking-normal">
                            {col.filter.kind === "text" ? (
                              <input
                                autoFocus
                                value={filters[col.key] ?? ""}
                                onChange={(e) => setFilters({ ...filters, [col.key]: e.target.value })}
                                placeholder="Filtrar…"
                                className="w-full px-2 py-1 rounded border border-border bg-background text-xs"
                              />
                            ) : (
                              <select
                                autoFocus
                                value={filters[col.key] ?? ""}
                                onChange={(e) => setFilters({ ...filters, [col.key]: e.target.value })}
                                className="w-full px-2 py-1 rounded border border-border bg-background text-xs"
                              >
                                <option value="">Todos</option>
                                {col.filter.options.map((o) => (
                                  <option key={o.value} value={o.value}>{o.label}</option>
                                ))}
                              </select>
                            )}
                            {filters[col.key] && (
                              <button
                                onClick={() => {
                                  const next = { ...filters };
                                  delete next[col.key];
                                  setFilters(next);
                                  setOpenFilter(null);
                                }}
                                className="mt-1 inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
                                type="button"
                              >
                                <X className="h-2.5 w-2.5" /> Limpar
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {filtered.map((row) => (
            <tr
              key={rowKey(row)}
              className={`border-t border-border hover:bg-surface ${onRowClick ? "cursor-pointer" : ""} ${rowClassName?.(row) ?? ""}`}
              onClick={() => onRowClick?.(row)}
            >
              {columns.map((col) => {
                const align = col.align ?? "left";
                return (
                  <td
                    key={col.key}
                    className={`px-4 py-2.5 ${align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left"} ${col.className ?? ""}`}
                  >
                    {col.render(row)}
                  </td>
                );
              })}
            </tr>
          ))}
          {filtered.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-4 py-10 text-center text-muted-foreground text-sm">
                {emptyMessage}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Small ▲/▼ delta indicator for health-score MoM comparison. Negative = improvement. */
export function ScoreDelta({ delta }: { delta: number | null }) {
  if (delta === null) return <span className="text-muted-foreground text-xs">—</span>;
  if (delta === 0) return <span className="text-muted-foreground text-xs">—</span>;
  const improving = delta < 0;
  return (
    <span className={`inline-flex items-center text-[11px] font-semibold tabular-nums ${improving ? "text-success" : "text-danger"}`}>
      {improving ? "▼" : "▲"} {Math.abs(delta)}
    </span>
  );
}
