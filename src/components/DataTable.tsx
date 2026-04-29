import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Filter as FilterIcon, Search, X } from "lucide-react";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

export type SortDir = "asc" | "desc" | null;

export type FilterType =
  | { kind: "text" }
  | { kind: "select"; options: { value: string; label: string }[] };

export interface ColumnDef<T> {
  key: string;
  header: string;
  align?: "left" | "right" | "center";
  render: (row: T) => ReactNode;
  sortValue?: (row: T) => string | number | null;
  filterValue?: (row: T) => string;
  filter?: FilterType;
  sortable?: boolean;
  /** Include in global search (defaults to true when filterValue exists) */
  searchable?: boolean;
  className?: string;
  thClassName?: string;
  /** Hide on small screens */
  hideOnMobile?: boolean;
  /** Show as primary (title) on mobile card */
  mobilePrimary?: boolean;
  /** Show on mobile card body. At most 2 columns should be marked. */
  mobileSecondary?: boolean;
  /** Custom render for mobile card secondary slots (label + value). */
  mobileLabel?: string;
}

export interface DataTableProps<T> {
  rows: T[];
  columns: ColumnDef<T>[];
  rowKey: (row: T) => string;
  defaultSort?: { key: string; dir: SortDir };
  rowClassName?: (row: T) => string;
  onRowClick?: (row: T) => void;
  expandedRow?: (row: T) => ReactNode | null;
  emptyMessage?: string;
  stickyHeader?: boolean;
  containerClassName?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  toolbar?: ReactNode;
  /** Bulk selection */
  selectable?: boolean;
  selectedKeys?: Set<string>;
  onSelectionChange?: (next: Set<string>) => void;
  isRowSelectable?: (row: T) => boolean;
  /** When set, paginate the table client-side. Set to undefined for "show all". */
  pageSize?: number;
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  defaultSort,
  rowClassName,
  onRowClick,
  expandedRow,
  emptyMessage = "Sem dados.",
  stickyHeader = false,
  containerClassName = "",
  searchable = true,
  searchPlaceholder = "Pesquisar…",
  toolbar,
  selectable = false,
  selectedKeys,
  onSelectionChange,
  isRowSelectable,
  pageSize = 50,
}: DataTableProps<T>) {
  const [sort, setSort] = useState<{ key: string; dir: SortDir }>(
    defaultSort ?? { key: "", dir: null },
  );
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [openFilter, setOpenFilter] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const debouncedSearchInput = useDebouncedValue(searchInput, 300);
  const debouncedFilters = useDebouncedValue(filters, 300);
  const filterRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  useEffect(() => {
    setSearch(debouncedSearchInput);
  }, [debouncedSearchInput]);

  // Close any open filter dropdown when clicking outside
  useEffect(() => {
    if (!openFilter) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      const node = filterRefs.current.get(openFilter);
      if (node && !node.contains(e.target as Node)) {
        setOpenFilter(null);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [openFilter]);

  const filtered = useMemo(() => {
    let r = rows;
    for (const col of columns) {
      const f = debouncedFilters[col.key];
      if (!f) continue;
      const norm = f.toLowerCase();
      r = r.filter((row) => {
        const v = col.filterValue ? col.filterValue(row) : "";
        if (col.filter?.kind === "select") return v === f;
        return v.toLowerCase().includes(norm);
      });
    }
    const s = search.trim().toLowerCase();
    if (s) {
      r = r.filter((row) =>
        columns.some((col) => {
          if (col.searchable === false) return false;
          if (!col.filterValue) return false;
          return col.filterValue(row).toLowerCase().includes(s);
        }),
      );
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
  }, [rows, columns, debouncedFilters, sort, search]);

  function toggleSort(key: string) {
    setSort((cur) => {
      if (cur.key !== key) return { key, dir: "asc" };
      if (cur.dir === "asc") return { key, dir: "desc" };
      if (cur.dir === "desc") return { key: "", dir: null };
      return { key, dir: "asc" };
    });
  }

  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  // Pagination — only when pageSize is set. Reset to page 0 whenever the underlying
  // filtered/sorted result set changes (search committed, filter applied, sort toggled).
  const [page, setPage] = useState(0);
  const totalRows = filtered.length;
  const totalPages = pageSize ? Math.max(1, Math.ceil(totalRows / pageSize)) : 1;
  useEffect(() => {
    setPage(0);
  }, [search, debouncedFilters, sort, pageSize, totalRows]);
  const pageRows = useMemo(() => {
    if (!pageSize) return filtered;
    const start = page * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  function goToPage(next: number) {
    const clamped = Math.max(0, Math.min(totalPages - 1, next));
    setPage(clamped);
    // Scroll the table viewport to top so the user sees row 1 of the new page
    if (tableScrollRef.current) tableScrollRef.current.scrollTop = 0;
  }

  // Bulk-selection helpers (computed against the filtered, currently-visible rows)
  const visibleSelectableRows = useMemo(
    () => (selectable ? filtered.filter((r) => (isRowSelectable ? isRowSelectable(r) : true)) : []),
    [selectable, filtered, isRowSelectable],
  );
  
  const visibleSelectedCount = useMemo(() => {
    if (!selectable || !selectedKeys) return 0;
    let n = 0;
    for (const r of visibleSelectableRows) if (selectedKeys.has(rowKey(r))) n++;
    return n;
  }, [selectable, selectedKeys, visibleSelectableRows, rowKey]);
  const allVisibleSelected = visibleSelectableRows.length > 0 && visibleSelectedCount === visibleSelectableRows.length;
  const someVisibleSelected = visibleSelectedCount > 0 && !allVisibleSelected;
  const headerCheckRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (headerCheckRef.current) headerCheckRef.current.indeterminate = someVisibleSelected;
  }, [someVisibleSelected]);

  function toggleAllVisible() {
    if (!selectable || !onSelectionChange) return;
    const next = new Set(selectedKeys ?? []);
    if (allVisibleSelected) {
      for (const r of visibleSelectableRows) next.delete(rowKey(r));
    } else {
      for (const r of visibleSelectableRows) next.add(rowKey(r));
    }
    onSelectionChange(next);
  }

  function toggleRow(row: T) {
    if (!selectable || !onSelectionChange) return;
    const k = rowKey(row);
    const next = new Set(selectedKeys ?? []);
    if (next.has(k)) next.delete(k); else next.add(k);
    onSelectionChange(next);
  }

  return (
    <div className="flex flex-col">
      {(searchable || toolbar) && (
        <div className="flex items-center gap-2 px-3 sm:px-4 py-2.5 border-b border-border bg-surface flex-wrap">
          {searchable && (
            <form
              className="flex items-center gap-2 flex-1 min-w-[220px]"
              onSubmit={(e) => {
                e.preventDefault();
                setSearch(searchInput);
              }}
            >
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <input
                  type="search"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder={searchPlaceholder}
                  className="w-full pl-8 pr-8 py-2 text-base sm:text-sm rounded-lg border border-border bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
                />
                {searchInput && (
                  <button
                    onClick={() => { setSearchInput(""); setSearch(""); }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-muted text-muted-foreground"
                    aria-label="Limpar pesquisa"
                    type="button"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <button
                type="submit"
                className="shrink-0 inline-flex items-center gap-1.5 px-3.5 h-9 rounded-lg bg-primary text-primary-foreground text-sm font-medium transition-colors duration-150 hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <Search className="h-3.5 w-3.5" />
                Procurar
              </button>
            </form>
          )}
          {activeFilterCount > 0 && (
            <button
              onClick={() => setFilters({})}
              className="shrink-0 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 py-1.5 rounded border border-border min-h-9"
              type="button"
            >
              <X className="h-3 w-3" /> {activeFilterCount} filtro{activeFilterCount === 1 ? "" : "s"}
            </button>
          )}
          {toolbar}
        </div>
      )}
      <div ref={tableScrollRef} className={`overflow-auto ${containerClassName}`}>
        <table className="w-full text-sm">
          <thead className={`bg-surface text-xs uppercase tracking-wide text-muted-foreground shadow-sm ${stickyHeader ? "sticky top-0 z-10" : ""}`}>
            <tr>
              {selectable && (
                <th className="px-3 py-3 w-10 text-center">
                  <input
                    ref={headerCheckRef}
                    type="checkbox"
                    aria-label="Selecionar todos"
                    checked={allVisibleSelected}
                    onChange={toggleAllVisible}
                    className="h-4 w-4 align-middle accent-primary cursor-pointer"
                    disabled={visibleSelectableRows.length === 0}
                  />
                </th>
              )}
              {columns.map((col) => {
                const align = col.align ?? "left";
                const sortable = col.sortable !== false && !!col.sortValue;
                const isSorted = sort.key === col.key && sort.dir;
                const filterActive = !!filters[col.key];
                return (
                  <th
                    key={col.key}
                    className={`px-3 sm:px-4 py-3 ${align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left"} ${col.hideOnMobile ? "hidden sm:table-cell" : ""} ${isSorted ? "text-primary" : ""} ${col.thClassName ?? ""}`}
                  >
                    <div className={`inline-flex items-center gap-1 ${align === "right" ? "flex-row-reverse" : ""}`}>
                      {sortable ? (
                        <button
                          onClick={() => toggleSort(col.key)}
                          className={`inline-flex items-center gap-1 transition-colors duration-150 ${isSorted ? "text-primary" : "hover:text-foreground"}`}
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
                        <div
                          className="relative"
                          ref={(el) => {
                            if (el) filterRefs.current.set(col.key, el);
                            else filterRefs.current.delete(col.key);
                          }}
                        >
                          <button
                            onClick={() => setOpenFilter(openFilter === col.key ? null : col.key)}
                            className={`p-0.5 rounded transition-colors duration-150 hover:bg-muted ${filterActive ? "text-primary" : "opacity-40 hover:opacity-100"}`}
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
                                  className="w-full px-2 py-1 rounded border border-border bg-background text-base sm:text-xs"
                                />
                              ) : (
                                <select
                                  autoFocus
                                  value={filters[col.key] ?? ""}
                                  onChange={(e) => setFilters({ ...filters, [col.key]: e.target.value })}
                                  className="w-full px-2 py-1 rounded border border-border bg-background text-base sm:text-xs"
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
            {pageRows.map((row) => {
              const expandedContent = expandedRow?.(row);
              const k = rowKey(row);
              const isSelected = !!selectedKeys?.has(k);
              const canSelect = selectable && (isRowSelectable ? isRowSelectable(row) : true);
              const totalCols = columns.length + (selectable ? 1 : 0);
              return (
                <Fragment key={k}>
                  <tr
                    className={`border-t border-border even:bg-muted/40 hover:bg-primary/5 transition-colors duration-150 ${onRowClick ? "cursor-pointer" : ""} ${isSelected ? "bg-primary/10" : ""} ${rowClassName?.(row) ?? ""}`}
                    onClick={() => onRowClick?.(row)}
                  >
                    {selectable && (
                      <td className="px-3 py-2.5 w-10 text-center" onClick={(e) => e.stopPropagation()}>
                        {canSelect ? (
                          <input
                            type="checkbox"
                            aria-label="Selecionar linha"
                            checked={isSelected}
                            onChange={() => toggleRow(row)}
                            className="h-4 w-4 align-middle accent-primary cursor-pointer"
                          />
                        ) : null}
                      </td>
                    )}
                    {columns.map((col) => {
                      const align = col.align ?? "left";
                      return (
                        <td
                          key={col.key}
                          className={`px-3 sm:px-4 py-2.5 ${align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left"} ${col.hideOnMobile ? "hidden sm:table-cell" : ""} ${col.className ?? ""}`}
                        >
                          {col.render(row)}
                        </td>
                      );
                    })}
                  </tr>
                  {expandedContent && (
                    <tr className="bg-surface/40">
                      <td colSpan={totalCols} className="px-3 sm:px-4 py-4 border-t border-border">
                        {expandedContent}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={columns.length + (selectable ? 1 : 0)} className="px-4 py-10 text-center text-muted-foreground text-sm">
                  {search || activeFilterCount > 0 ? "Sem resultados para a pesquisa atual." : emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {pageSize && totalRows > 0 ? (
        <div className="flex items-center justify-between gap-3 px-3 sm:px-4 py-2.5 text-xs text-muted-foreground border-t border-border bg-surface flex-wrap">
          <span className="tabular-nums">
            {totalPages > 1 ? (
              <>
                {Math.min(page * pageSize + 1, totalRows)}–{Math.min((page + 1) * pageSize, totalRows)} de {totalRows} resultado{totalRows === 1 ? "" : "s"}
                {(search || activeFilterCount > 0) && rows.length !== totalRows && (
                  <> · filtrado de {rows.length}</>
                )}
              </>
            ) : (
              <>
                {totalRows} de {Math.max(rows.length, totalRows)} resultado{rows.length === 1 ? "" : "s"}
              </>
            )}
          </span>
          {totalPages > 1 && (
            <div className="inline-flex items-center gap-2">
              <button
                type="button"
                onClick={() => goToPage(page - 1)}
                disabled={page === 0}
                className="inline-flex items-center gap-1 px-3 h-8 rounded-lg border border-border bg-surface text-foreground transition-colors duration-150 hover:bg-primary/5 hover:border-primary/40 hover:text-primary disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-surface disabled:hover:text-foreground disabled:hover:border-border focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <ChevronLeft className="h-3.5 w-3.5" /> Anterior
              </button>
              <span className="tabular-nums">Página {page + 1} de {totalPages}</span>
              <button
                type="button"
                onClick={() => goToPage(page + 1)}
                disabled={page >= totalPages - 1}
                className="inline-flex items-center gap-1 px-3 h-8 rounded-lg border border-border bg-surface text-foreground transition-colors duration-150 hover:bg-primary/5 hover:border-primary/40 hover:text-primary disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-surface disabled:hover:text-foreground disabled:hover:border-border focus:outline-none focus:ring-2 focus:ring-primary"
              >
                Próximo <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      ) : (search || activeFilterCount > 0) && filtered.length > 0 ? (
        <div className="px-3 sm:px-4 py-2 text-[11px] text-muted-foreground border-t border-border bg-surface">
          {filtered.length} de {rows.length} resultado{rows.length === 1 ? "" : "s"}
        </div>
      ) : null}
    </div>
  );
}

/** Small ▲/▼ delta indicator for health-score MoM comparison. Negative = improvement. */
export function ScoreDelta({ delta, previous, current }: { delta: number | null; previous?: number | null; current?: number | null }) {
  if (delta === null) return <span className="text-muted-foreground text-xs">—</span>;
  if (delta === 0) return <span className="text-muted-foreground text-xs">—</span>;
  const improving = delta < 0;
  const scores = previous !== undefined && previous !== null && current !== undefined && current !== null
    ? ` · ${previous}→${current}`
    : "";
  return (
    <span className={`inline-flex items-center text-[11px] font-semibold tabular-nums ${improving ? "text-success" : "text-danger"}`}>
      {improving ? "▼" : "▲"} {Math.abs(delta)}{scores}
    </span>
  );
}
