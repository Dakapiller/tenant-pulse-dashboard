import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { applyManualScoreChange, clampScore } from "@/lib/health";

interface SingleProps {
  open: boolean;
  mode: "single";
  tenant: string;
  currentScore: number;
  onClose: () => void;
  onApplied?: () => void | Promise<void>;
}

interface BulkProps {
  open: boolean;
  mode: "bulk";
  tenants: { name: string; score: number }[];
  onClose: () => void;
  onApplied?: () => void | Promise<void>;
}

type Props = SingleProps | BulkProps;

export function AdjustScoreDialog(props: Props) {
  const { open, onClose } = props;

  const [absolute, setAbsolute] = useState<number>(50);
  const [delta, setDelta] = useState<number>(0);
  const [adjustMode, setAdjustMode] = useState<"absolute" | "delta">("absolute");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    if (open) {
      if (props.mode === "single") {
        setAbsolute(props.currentScore);
        setAdjustMode("absolute");
      } else {
        setAdjustMode("delta");
        setDelta(0);
      }
      setComment("");
      setError(null);
      setProgress(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const isSingle = props.mode === "single";
  const targets = isSingle
    ? [{ name: props.tenant, score: props.currentScore }]
    : props.tenants;

  function previewFor(score: number): number {
    if (adjustMode === "absolute") return clampScore(absolute);
    return clampScore(score + delta);
  }

  async function submit() {
    setError(null);
    if (comment.trim().length < 5) { setError("Comentário obrigatório (mín. 5 caracteres)."); return; }
    if (adjustMode === "absolute" && (absolute < 0 || absolute > 100)) { setError("Score deve estar entre 0 e 100."); return; }
    if (adjustMode === "delta" && (delta < -100 || delta > 100)) { setError("Delta deve estar entre -100 e 100."); return; }

    setBusy(true);
    setProgress({ done: 0, total: targets.length });
    let errors = 0;
    try {
      for (let i = 0; i < targets.length; i++) {
        const t = targets[i];
        const next = previewFor(t.score);
        if (next === t.score) {
          setProgress({ done: i + 1, total: targets.length });
          continue;
        }
        try {
          await applyManualScoreChange(
            t.name,
            next,
            comment,
            isSingle ? "manual" : "manual_bulk",
          );
        } catch (e) {
          errors++;
          console.error("Failed to adjust score for", t.name, e);
        }
        setProgress({ done: i + 1, total: targets.length });
      }
      await props.onApplied?.();
      if (errors > 0) setError(`${errors} de ${targets.length} ajustes falharam. Os restantes foram aplicados.`);
      else onClose();
    } finally {
      setBusy(false);
    }
  }

  const examplePreview = targets.length > 0 ? previewFor(targets[0].score) : 0;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end md:items-center md:justify-center"
      onMouseDown={busy ? undefined : onClose}
    >
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-full md:max-w-lg bg-background border-t md:border border-border md:rounded-xl shadow-xl rounded-t-2xl max-h-[90vh] overflow-y-auto"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-background border-b border-border px-5 py-4 flex items-center justify-between">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">Ajustar health score</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {isSingle ? props.tenant : `${targets.length} ${targets.length === 1 ? "clube" : "clubes"} selecionados`}
            </p>
          </div>
          <button onClick={onClose} disabled={busy} className="h-9 w-9 inline-flex items-center justify-center rounded hover:bg-surface" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {!isSingle && (
            <div>
              <label className="block text-xs uppercase tracking-wide text-muted-foreground mb-1.5">Tipo de ajuste</label>
              <div className="inline-flex rounded-md border border-border bg-background p-0.5">
                <button
                  type="button"
                  onClick={() => setAdjustMode("absolute")}
                  className={`px-3 py-1.5 text-sm rounded ${adjustMode === "absolute" ? "bg-foreground text-background" : "text-muted-foreground"}`}
                >Definir valor</button>
                <button
                  type="button"
                  onClick={() => setAdjustMode("delta")}
                  className={`px-3 py-1.5 text-sm rounded ${adjustMode === "delta" ? "bg-foreground text-background" : "text-muted-foreground"}`}
                >Somar/subtrair</button>
              </div>
            </div>
          )}

          {adjustMode === "absolute" ? (
            <div>
              <label className="block text-xs uppercase tracking-wide text-muted-foreground mb-1.5">Novo score (0–100)</label>
              <input
                type="number"
                min={0}
                max={100}
                value={absolute}
                onChange={(e) => setAbsolute(Number(e.target.value))}
                className="w-full px-3 py-2.5 rounded-md border border-border bg-background text-sm min-h-11"
              />
            </div>
          ) : (
            <div>
              <label className="block text-xs uppercase tracking-wide text-muted-foreground mb-1.5">Delta (-100 a +100)</label>
              <input
                type="number"
                min={-100}
                max={100}
                value={delta}
                onChange={(e) => setDelta(Number(e.target.value))}
                className="w-full px-3 py-2.5 rounded-md border border-border bg-background text-sm min-h-11"
              />
            </div>
          )}

          <div>
            <label className="block text-xs uppercase tracking-wide text-muted-foreground mb-1.5">
              Comentário <span className="text-muted-foreground/60 normal-case">({comment.length}/300)</span>
            </label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value.slice(0, 300))}
              rows={3}
              placeholder="Porque é que estás a ajustar manualmente? (obrigatório)"
              className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-foreground/20"
            />
          </div>

          {/* Preview */}
          <div className="rounded-lg border border-border bg-surface/40 p-3 text-sm">
            {isSingle ? (
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Score</span>
                <span className="tabular-nums">
                  <span className="text-muted-foreground">{targets[0].score}</span>
                  <span className="mx-2 text-muted-foreground">→</span>
                  <span className="font-semibold">{examplePreview}</span>
                </span>
              </div>
            ) : (
              <>
                <div className="text-xs text-muted-foreground mb-2">Pré-visualização (primeiros 5)</div>
                <ul className="space-y-1 text-xs">
                  {targets.slice(0, 5).map((t) => (
                    <li key={t.name} className="flex items-center justify-between gap-3">
                      <span className="truncate">{t.name}</span>
                      <span className="tabular-nums shrink-0">
                        <span className="text-muted-foreground">{t.score}</span>
                        <span className="mx-1.5 text-muted-foreground">→</span>
                        <span className="font-semibold">{previewFor(t.score)}</span>
                      </span>
                    </li>
                  ))}
                  {targets.length > 5 && (
                    <li className="text-muted-foreground italic">+ {targets.length - 5} mais…</li>
                  )}
                </ul>
              </>
            )}
          </div>

          {progress && (
            <div className="text-xs text-muted-foreground">
              Progresso: {progress.done}/{progress.total}
            </div>
          )}

          {error && (
            <div className="rounded-md border border-danger/30 bg-danger/10 text-danger text-sm px-3 py-2">{error}</div>
          )}

          <p className="text-[11px] text-muted-foreground italic">
            Ajustes manuais ignoram o floor dinâmico (mantêm-se mesmo que existam outcomes positivos recentes). Ficam registados no histórico do clube.
          </p>
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
          >{busy ? "A aplicar…" : isSingle ? "Aplicar" : `Aplicar a ${targets.length}`}</button>
        </div>
      </div>
    </div>
  );
}
