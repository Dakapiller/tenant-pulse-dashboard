import { useMemo, useRef, useState } from "react";
import { toPng, toJpeg } from "html-to-image";
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts";
import { Download, X, ImageIcon, Loader2 } from "lucide-react";
import type { Snapshot } from "@/lib/data";
import { formatEuro, formatNumber, formatPercent, periodLabel, periodShort } from "@/lib/format";
import { computeYoY } from "@/lib/yoy";

type ExportFormat = "png" | "jpeg";
type RangePreset = "single" | "6m" | "12m" | "24m" | "all";

interface ExportClubCardDialogProps {
  open: boolean;
  onClose: () => void;
  tenant: string;
  history: Snapshot[];
  realScore: number;
}

const PRESETS: { value: RangePreset; label: string; months: number | null }[] = [
  { value: "single", label: "Apenas um mês", months: 1 },
  { value: "6m", label: "Últimos 6 meses", months: 6 },
  { value: "12m", label: "Últimos 12 meses", months: 12 },
  { value: "24m", label: "Últimos 24 meses", months: 24 },
  { value: "all", label: "Histórico completo", months: null },
];

// Score mostrado ao cliente nunca pode ser inferior a 65.
const DISPLAY_FLOOR = 65;

function buildInsights(history: Snapshot[]): string[] {
  if (history.length === 0) return [];
  const sorted = [...history].sort((a, b) => a.period.localeCompare(b.period));
  const latest = sorted[sorted.length - 1];
  const insights: string[] = [];

  // YoY
  const yoy = computeYoY(sorted, latest.period);
  if (yoy) {
    const wins = yoy.filter((m) => m.pctChange !== null && m.pctChange > 5);
    const losses = yoy.filter((m) => m.pctChange !== null && m.pctChange < -5);
    wins.forEach((m) => {
      insights.push(`${m.label} cresceu ${m.pctChange!.toFixed(1).replace(".", ",")}% face ao mesmo mês do ano anterior.`);
    });
    losses.forEach((m) => {
      insights.push(`${m.label} caiu ${Math.abs(m.pctChange!).toFixed(1).replace(".", ",")}% vs ano anterior — oportunidade para ativar campanhas.`);
    });
  }

  // Pico de GMV
  const peakGmv = sorted.reduce((p, s) => (s.gmv_all > p.gmv_all ? s : p), sorted[0]);
  if (peakGmv && peakGmv.period !== latest.period) {
    insights.push(`Pico de GMV registado em ${periodLabel(peakGmv.period)} (${formatEuro(peakGmv.gmv_all)}).`);
  }

  // Tendência últimos 3m vs 3m anteriores
  if (sorted.length >= 6) {
    const last3 = sorted.slice(-3);
    const prev3 = sorted.slice(-6, -3);
    const sum = (arr: Snapshot[], k: keyof Snapshot) => arr.reduce((s, x) => s + Number(x[k] ?? 0), 0);
    const gmvLast = sum(last3, "gmv_all");
    const gmvPrev = sum(prev3, "gmv_all");
    if (gmvPrev > 0) {
      const trend = ((gmvLast - gmvPrev) / gmvPrev) * 100;
      if (Math.abs(trend) > 3) {
        insights.push(
          `Tendência trimestral: GMV ${trend > 0 ? "subiu" : "desceu"} ${Math.abs(trend).toFixed(1).replace(".", ",")}% nos últimos 3 meses face aos 3 anteriores.`,
        );
      }
    }
  }

  // Taxa de conversão atual
  if (latest.transacted_rate > 0) {
    insights.push(`Taxa de conversão atual: ${formatPercent(latest.transacted_rate)}.`);
  }

  return insights.slice(0, 5);
}

export function ExportClubCardDialog({ open, onClose, tenant, history, realScore }: ExportClubCardDialogProps) {
  const [preset, setPreset] = useState<RangePreset>("12m");
  const [format, setFormat] = useState<ExportFormat>("png");
  const [busy, setBusy] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const sorted = [...history].sort((a, b) => a.period.localeCompare(b.period));
    const months = PRESETS.find((p) => p.value === preset)?.months;
    if (!months) return sorted;
    return sorted.slice(-months);
  }, [history, preset]);

  const displayScore = Math.max(realScore, DISPLAY_FLOOR);
  const insights = useMemo(() => buildInsights(filtered), [filtered]);
  const latest = filtered[filtered.length - 1];

  async function handleDownload() {
    if (!cardRef.current) return;
    setBusy(true);
    try {
      const opts = {
        pixelRatio: 2,
        backgroundColor: "#0b1020",
        cacheBust: true,
      };
      const dataUrl = format === "png"
        ? await toPng(cardRef.current, opts)
        : await toJpeg(cardRef.current, { ...opts, quality: 0.95 });
      const a = document.createElement("a");
      a.download = `${tenant.replace(/[^a-z0-9-_]/gi, "_")}-club-card.${format}`;
      a.href = dataUrl;
      a.click();
    } catch (err) {
      console.error("Falha a exportar club card", err);
      alert("Não foi possível exportar a imagem.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  const chartData = filtered.map((s) => ({
    period: periodShort(s.period),
    gmv: Number(s.gmv_all ?? 0),
    games: Number(s.games_online ?? 0),
    revenue: Number(s.revenue ?? 0),
  }));

  const scoreColor = displayScore >= 85 ? "#22c55e" : displayScore >= 70 ? "#3b82f6" : "#eab308";

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60" onMouseDown={onClose}>
      <div
        className="relative w-full max-w-5xl max-h-[95vh] overflow-y-auto bg-background rounded-xl shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Toolbar */}
        <div className="sticky top-0 z-10 bg-background border-b border-border px-5 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <ImageIcon className="h-4 w-4" />
            <h3 className="font-semibold">Exportar club card — {tenant}</h3>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={preset}
              onChange={(e) => setPreset(e.target.value as RangePreset)}
              className="px-2.5 py-1.5 rounded-md border border-border bg-background text-xs"
            >
              {PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as ExportFormat)}
              className="px-2.5 py-1.5 rounded-md border border-border bg-background text-xs"
            >
              <option value="png">PNG</option>
              <option value="jpeg">JPEG</option>
            </select>
            <button
              onClick={handleDownload}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-md bg-foreground text-background px-3 py-1.5 text-xs font-medium hover:opacity-90 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              Descarregar
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded hover:bg-surface"
              aria-label="Fechar"
            ><X className="h-4 w-4" /></button>
          </div>
        </div>

        {/* Preview */}
        <div className="p-5 bg-surface/40">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">Pré-visualização</div>
          <div className="overflow-auto">
            {/* The actual card to be exported */}
            <div
              ref={cardRef}
              className="mx-auto"
              style={{
                width: 900,
                background: "linear-gradient(135deg, #0b1020 0%, #1a1f3a 50%, #0b1020 100%)",
                color: "#f4f4f5",
                padding: 32,
                borderRadius: 16,
                fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
              }}
            >
              {/* Header */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 20 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: "#a1a1aa", marginBottom: 6 }}>
                    Club performance card
                  </div>
                  <div style={{ fontSize: 28, fontWeight: 700, lineHeight: 1.1 }}>{tenant}</div>
                  <div style={{ fontSize: 12, color: "#a1a1aa", marginTop: 4 }}>
                    {filtered.length > 0
                      ? `${periodLabel(filtered[0].period)} → ${periodLabel(filtered[filtered.length - 1].period)} · ${filtered.length} ${filtered.length === 1 ? "mês" : "meses"}`
                      : "Sem dados no período selecionado"}
                  </div>
                </div>
                {/* Score badge — FIFA style */}
                <div style={{ textAlign: "center", minWidth: 120 }}>
                  <div
                    style={{
                      width: 110,
                      height: 110,
                      borderRadius: 55,
                      background: `radial-gradient(circle at 30% 30%, ${scoreColor} 0%, rgba(0,0,0,0.4) 100%)`,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      border: `3px solid ${scoreColor}`,
                      boxShadow: `0 0 30px ${scoreColor}40`,
                    }}
                  >
                    <div style={{ fontSize: 38, fontWeight: 800, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{displayScore}</div>
                    <div style={{ fontSize: 9, letterSpacing: 1.5, marginTop: 2, color: "#e4e4e7" }}>SCORE</div>
                  </div>
                </div>
              </div>

              {/* Latest KPIs */}
              {latest && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
                  {[
                    { label: "GMV", value: formatEuro(latest.gmv_all) },
                    { label: "Jogos online", value: formatNumber(latest.games_online) },
                    { label: "Receita", value: formatEuro(latest.revenue) },
                    { label: "Taxa de conversão", value: formatPercent(latest.transacted_rate) },
                  ].map((k) => (
                    <div key={k.label} style={{ background: "rgba(255,255,255,0.05)", borderRadius: 8, padding: 12, border: "1px solid rgba(255,255,255,0.08)" }}>
                      <div style={{ fontSize: 9, letterSpacing: 1, textTransform: "uppercase", color: "#a1a1aa" }}>{k.label}</div>
                      <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{k.value}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Chart */}
              {chartData.length > 1 && (
                <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: 16, marginBottom: 20, border: "1px solid rgba(255,255,255,0.08)" }}>
                  <div style={{ fontSize: 10, letterSpacing: 1, textTransform: "uppercase", color: "#a1a1aa", marginBottom: 8 }}>
                    Evolução de GMV
                  </div>
                  <div style={{ width: "100%", height: 140 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                        <XAxis dataKey="period" tick={{ fill: "#a1a1aa", fontSize: 10 }} stroke="#3f3f46" />
                        <YAxis hide />
                        <Tooltip contentStyle={{ background: "#1a1f3a", border: "1px solid #3f3f46", color: "#f4f4f5", fontSize: 11 }} />
                        <Line type="monotone" dataKey="gmv" stroke={scoreColor} strokeWidth={2.5} dot={false} isAnimationActive={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* History table */}
              <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: 12, marginBottom: 20, border: "1px solid rgba(255,255,255,0.08)" }}>
                <div style={{ fontSize: 10, letterSpacing: 1, textTransform: "uppercase", color: "#a1a1aa", marginBottom: 8, padding: "0 4px" }}>
                  Histórico de métricas — {filtered.length} {filtered.length === 1 ? "mês" : "meses"}
                </div>
                <div style={{ maxHeight: 220, overflow: "hidden" }}>
                  <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ color: "#a1a1aa", textAlign: "left" }}>
                        <th style={{ padding: "6px 8px" }}>Mês</th>
                        <th style={{ padding: "6px 8px", textAlign: "right" }}>GMV</th>
                        <th style={{ padding: "6px 8px", textAlign: "right" }}>Jogos</th>
                        <th style={{ padding: "6px 8px", textAlign: "right" }}>Receita</th>
                        <th style={{ padding: "6px 8px", textAlign: "right" }}>Taxa</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...filtered].reverse().slice(0, 14).map((s) => (
                        <tr key={s.period} style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                          <td style={{ padding: "5px 8px" }}>{periodLabel(s.period)}</td>
                          <td style={{ padding: "5px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formatEuro(s.gmv_all)}</td>
                          <td style={{ padding: "5px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formatNumber(s.games_online)}</td>
                          <td style={{ padding: "5px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formatEuro(s.revenue)}</td>
                          <td style={{ padding: "5px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formatPercent(s.transacted_rate)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {filtered.length > 14 && (
                    <div style={{ fontSize: 10, color: "#a1a1aa", textAlign: "center", padding: "6px 0 0" }}>
                      + {filtered.length - 14} {filtered.length - 14 === 1 ? "mês" : "meses"} adicionais no período
                    </div>
                  )}
                </div>
              </div>

              {/* Insights */}
              {insights.length > 0 && (
                <div>
                  <div style={{ fontSize: 10, letterSpacing: 1, textTransform: "uppercase", color: "#a1a1aa", marginBottom: 8 }}>
                    Insights
                  </div>
                  <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                    {insights.map((i, idx) => (
                      <li key={idx} style={{ fontSize: 12, lineHeight: 1.4, paddingLeft: 14, position: "relative", color: "#e4e4e7" }}>
                        <span style={{ position: "absolute", left: 0, top: 6, width: 6, height: 6, borderRadius: 3, background: scoreColor }} />
                        {i}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div style={{ marginTop: 20, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.08)", fontSize: 9, color: "#71717a", textAlign: "right" }}>
                Tenant Pulse · Gerado em {new Date().toLocaleDateString("pt-PT")}
              </div>
            </div>
          </div>

          <p className="text-[11px] text-muted-foreground mt-3 text-center">
            O score apresentado é o valor partilhável (mínimo 65 para preservar a relação com o clube). Score real interno: {realScore}.
          </p>
        </div>
      </div>
    </div>
  );
}
