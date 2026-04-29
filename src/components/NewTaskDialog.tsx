import { useEffect, useMemo, useState } from "react";
import { X, Search } from "lucide-react";
import { insertManualCSTask, currentWeekStart } from "@/lib/cs";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated?: () => void | Promise<void>;
  /** Pre-selected club. When provided, the club picker is hidden. */
  tenant?: string;
  /** All active club names — used when the picker is shown. */
  activeClubs?: string[];
}

const PRIORITY_OPTIONS = [
  { value: 30, label: "Baixa" },
  { value: 60, label: "Média" },
  { value: 90, label: "Alta" },
];

function nextWeekStart(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 7);
  return currentWeekStart(d);
}

export function NewTaskDialog({ open, onClose, onCreated, tenant, activeClubs = [] }: Props) {
  const thisWeek = useMemo(() => currentWeekStart(), []);
  const nextWeek = useMemo(() => nextWeekStart(), []);

  const [selectedTenant, setSelectedTenant] = useState<string>(tenant ?? "");
  const [tenantQuery, setTenantQuery] = useState("");
  const [reason, setReason] = useState("");
  const [cta, setCta] = useState("");
  const [priority, setPriority] = useState<number>(60);
  const [weekStart, setWeekStart] = useState<string>(thisWeek);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSelectedTenant(tenant ?? "");
      setTenantQuery("");
      setReason("");
      setCta("");
      setPriority(60);
      setWeekStart(thisWeek);
      setError(null);
    }
  }, [open, tenant, thisWeek]);

  if (!open) return null;

  const filteredClubs = activeClubs
    .filter((n) => !tenantQuery || n.toLowerCase().includes(tenantQuery.toLowerCase()))
    .slice(0, 30);

  async function submit() {
    setError(null);
    if (!selectedTenant) { setError("Escolhe um clube."); return; }
    if (reason.trim().length === 0) { setError("Razão obrigatória."); return; }
    if (cta.trim().length === 0) { setError("CTA obrigatório."); return; }
    setBusy(true);
    try {
      await insertManualCSTask({ tenant: selectedTenant, reason, cta, priority, weekStart });
      await onCreated?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao criar tarefa.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end md:items-center md:justify-center"
      onMouseDown={onClose}
    >
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-full md:max-w-lg bg-background border-t md:border border-border md:rounded-xl shadow-xl rounded-t-2xl max-h-[90vh] overflow-y-auto"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-background border-b border-border px-5 py-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Nova tarefa</h2>
          <button onClick={onClose} className="h-9 w-9 inline-flex items-center justify-center rounded hover:bg-surface" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Tenant picker */}
          <div>
            <label className="block text-xs uppercase tracking-wide text-muted-foreground mb-1.5">Clube</label>
            {tenant ? (
              <div className="px-3 py-2.5 rounded-md border border-border bg-surface text-sm">{tenant}</div>
            ) : selectedTenant ? (
              <div className="flex items-center gap-2">
                <div className="flex-1 px-3 py-2.5 rounded-md border border-border bg-surface text-sm">{selectedTenant}</div>
                <button
                  type="button"
                  onClick={() => setSelectedTenant("")}
                  className="text-xs text-muted-foreground hover:text-foreground px-2 py-1"
                >Mudar</button>
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
                      <li className="px-3 py-2 text-xs text-muted-foreground">Sem resultados.</li>
                    ) : filteredClubs.map((n) => (
                      <li key={n}>
                        <button
                          type="button"
                          onClick={() => { setSelectedTenant(n); setTenantQuery(""); }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-surface"
                        >{n}</button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs uppercase tracking-wide text-muted-foreground mb-1.5">
              Razão <span className="text-muted-foreground/60 normal-case">({reason.length}/500)</span>
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
              CTA <span className="text-muted-foreground/60 normal-case">({cta.length}/200)</span>
            </label>
            <input
              type="text"
              value={cta}
              onChange={(e) => setCta(e.target.value.slice(0, 200))}
              placeholder="O que fazer? (ex.: Ligar ao gestor)"
              className="w-full px-3 py-2.5 rounded-md border border-border bg-background text-sm min-h-11 focus:outline-none focus:ring-2 focus:ring-foreground/20"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs uppercase tracking-wide text-muted-foreground mb-1.5">Prioridade</label>
              <select
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value))}
                className="w-full px-3 py-2.5 rounded-md border border-border bg-background text-sm min-h-11"
              >
                {PRIORITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs uppercase tracking-wide text-muted-foreground mb-1.5">Semana</label>
              <select
                value={weekStart}
                onChange={(e) => setWeekStart(e.target.value)}
                className="w-full px-3 py-2.5 rounded-md border border-border bg-background text-sm min-h-11"
              >
                <option value={thisWeek}>Esta semana</option>
                <option value={nextWeek}>Próxima semana</option>
              </select>
            </div>
          </div>

          {error && (
            <div className="rounded-md border border-danger/30 bg-danger/10 text-danger text-sm px-3 py-2">{error}</div>
          )}
        </div>

        <div className="sticky bottom-0 bg-background border-t border-border px-5 py-3 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="px-4 min-h-11 text-sm rounded-md hover:bg-surface text-muted-foreground"
          >Cancelar</button>
          <button
            onClick={submit}
            disabled={busy}
            className="inline-flex items-center justify-center px-4 min-h-11 rounded-md bg-foreground text-background text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >{busy ? "A criar…" : "Criar tarefa"}</button>
        </div>
      </div>
    </div>
  );
}
