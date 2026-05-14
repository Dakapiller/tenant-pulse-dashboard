import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useDropzone } from "react-dropzone";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2, FileSpreadsheet, UploadCloud, XCircle } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { applyUploadScoreChanges, fetchHealthScores } from "@/lib/health";
import { currentWeekStart } from "@/lib/cs";
import { fetchAllPaged, type Snapshot } from "@/lib/data";

export const Route = createFileRoute("/upload")({
  component: UploadPage,
});

const COLUMN_MAP: Record<string, string> = {
  "Tenant Name": "tenant_name",
  "Games Online": "games_online",
  "GMV - Games Online": "gmv_games",
  "GMV (EUR) - All Products": "gmv_all",
  "Transacted Amount": "transacted_amount",
  "B2C Commissions (EUR|Net)": "b2c_commissions",
  "B2B Com. (Net)": "b2b_commissions",
  "Saas": "saas",
  "Revenue": "revenue",
  "Transacted Rate (%)": "transacted_rate",
};

const NUMERIC_FIELDS = new Set([
  "games_online", "gmv_games", "gmv_all", "transacted_amount",
  "b2c_commissions", "b2b_commissions", "saas", "revenue", "transacted_rate",
]);

function toNumber(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return isFinite(v) ? v : 0;
  const s = String(v).replace(/[€$,\s%]/g, "").replace(/,/g, "");
  const n = Number(s);
  return isFinite(n) ? n : 0;
}

function findKey(row: Record<string, unknown>, target: string): string | undefined {
  // Try exact, then case-insensitive trim match
  if (target in row) return target;
  const norm = target.toLowerCase().replace(/\s+/g, " ").trim();
  return Object.keys(row).find((k) => k.toLowerCase().replace(/\s+/g, " ").trim() === norm);
}

function UploadPage() {
  const { profile, loading } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (loading) return;
    if (profile?.role !== "superuser") {
      toast.error("Acesso restrito a administradores.");
      void navigate({ to: "/" });
    }
  }, [profile, loading, navigate]);

  const now = new Date();
  const [year, setYear] = useState(now.getUTCFullYear());
  const [month, setMonth] = useState(now.getUTCMonth() + 1); // 1-12
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [history, setHistory] = useState<{ period: string; club_count: number; uploaded_at: string }[]>([]);
  const [result, setResult] = useState<{
    success: number;
    errors: { tenant: string; message: string }[];
    newClubs?: string[];
    missingClubs?: string[];
    scoring?: { newScored: number; downs: number; ups: number; skipped: number };
  } | null>(null);

  async function loadHistory() {
    const { data } = await supabase
      .from("tenant_snapshots")
      .select("period, created_at")
      .order("period", { ascending: false });
    if (!data) return;
    const map = new Map<string, { count: number; latest: string }>();
    (data as { period: string; created_at: string }[]).forEach((r) => {
      const cur = map.get(r.period) ?? { count: 0, latest: r.created_at };
      cur.count += 1;
      if (r.created_at > cur.latest) cur.latest = r.created_at;
      map.set(r.period, cur);
    });
    setHistory(
      Array.from(map.entries())
        .map(([period, v]) => ({ period, club_count: v.count, uploaded_at: v.latest }))
        .sort((a, b) => b.period.localeCompare(a.period)),
    );
  }

  useEffect(() => { loadHistory(); }, []);

  const periodIso = useMemo(() => {
    const m = String(month).padStart(2, "0");
    return `${year}-${m}-01`;
  }, [year, month]);

  const periodLabel = useMemo(() => {
    return new Date(`${periodIso}T00:00:00Z`).toLocaleString("pt-PT", { month: "long", year: "numeric", timeZone: "UTC" });
  }, [periodIso]);

  const onDrop = useCallback((accepted: File[]) => {
    if (accepted[0]) {
      setFile(accepted[0]);
      setResult(null);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: false,
    accept: {
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
      "application/vnd.ms-excel": [".xls"],
    },
  });

  async function handleUpload() {
    if (!file) return;
    setIsUploading(true);
    setProgress(0);
    setResult(null);
    const errors: { tenant: string; message: string }[] = [];
    let success = 0;

    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

      // Map rows to DB shape
      const records: Record<string, unknown>[] = [];
      rows.forEach((row, idx) => {
        const rec: Record<string, unknown> = { period: periodIso };
        let tenant = "";
        for (const [xlsxCol, dbField] of Object.entries(COLUMN_MAP)) {
          const k = findKey(row, xlsxCol);
          const raw = k ? row[k] : "";
          if (dbField === "tenant_name") {
            tenant = String(raw ?? "").trim();
            rec[dbField] = tenant;
          } else if (NUMERIC_FIELDS.has(dbField)) {
            rec[dbField] = toNumber(raw);
          } else {
            rec[dbField] = raw;
          }
        }
        if (!tenant) {
          errors.push({ tenant: `Linha ${idx + 2}`, message: "Tenant Name em falta" });
          return;
        }
        records.push(rec);
      });

      // Capture tenants that already have this period BEFORE upsert.
      // Used to skip Rule 2 scoring on re-uploads of the same month.
      const { data: existingThisPeriodRows } = await supabase
        .from("tenant_snapshots")
        .select("tenant_name")
        .eq("period", periodIso);
      const alreadyHadThisPeriod = new Set(
        (existingThisPeriodRows as { tenant_name: string }[] | null)?.map((r) => r.tenant_name) ?? [],
      );

      // Upsert in chunks for progress
      const CHUNK = 50;
      for (let i = 0; i < records.length; i += CHUNK) {
        const slice = records.slice(i, i + CHUNK);
        const { error } = await supabase
          .from("tenant_snapshots")
          .upsert(slice as never, { onConflict: "tenant_name,period" });
        if (error) {
          // Retry one-by-one to isolate failures
          for (const rec of slice) {
            const { error: e2 } = await supabase
              .from("tenant_snapshots")
              .upsert(rec as never, { onConflict: "tenant_name,period" });
            if (e2) {
              const friendly = /row-level security|permission denied|42501/i.test(e2.message)
                ? `${e2.message} — sessão sem permissões de superuser. Sair e voltar a entrar pode resolver.`
                : e2.message;
              errors.push({ tenant: String(rec.tenant_name), message: friendly });
            } else {
              success += 1;
            }
          }
        } else {
          success += slice.length;
        }
        setProgress(Math.round(((i + slice.length) / Math.max(1, records.length)) * 100));
      }

      // After successful upload — churn detection
      let newClubs: string[] = [];
      let missingClubs: string[] = [];
      try {
        const uploadedNames = new Set(records.map((r) => String(r.tenant_name)));
        // Paginate: a single .select() is capped at 1000 rows, but we have
        // ~290 clubs × many months = thousands of rows. Without pagination,
        // many tenants from older months are missed → falsely flagged as new.
        const priorRows = await fetchAllPaged<{ tenant_name: string }>((from, to) =>
          supabase.from("tenant_snapshots").select("tenant_name").neq("period", periodIso).range(from, to),
        );
        {
          const priorNames = new Set<string>();
          priorRows.forEach((r) => priorNames.add(r.tenant_name));
          newClubs = [...uploadedNames].filter((n) => !priorNames.has(n));
          missingClubs = [...priorNames].filter((n) => !uploadedNames.has(n));

          if (missingClubs.length > 0) {
            // Fetch latest status to skip already-churned/candidates
            const { data: latestStatusRows } = await supabase
              .from("cs_tenant_status")
              .select("tenant_name, club_status, recorded_at")
              .in("tenant_name", missingClubs)
              .order("recorded_at", { ascending: false });
            const currentByTenant = new Map<string, string>();
            (latestStatusRows ?? []).forEach((r) => {
              if (!currentByTenant.has(r.tenant_name)) currentByTenant.set(r.tenant_name, r.club_status ?? "active");
            });

            const toFlag = missingClubs.filter((n) => (currentByTenant.get(n) ?? "active") === "active");
            if (toFlag.length > 0) {
              await supabase.from("cs_tenant_status").insert(
                toFlag.map((n) => ({
                  tenant_name: n,
                  relationship_status: "status_possible_churn",
                  club_status: "possible_churn",
                  note: `Em falta no carregamento de ${periodLabel}`,
                })) as never,
              );
              await supabase.from("club_status_log" as never).insert(
                toFlag.map((n) => ({
                  tenant_name: n,
                  previous_status: "active",
                  new_status: "possible_churn",
                  note: `Em falta no carregamento de ${periodLabel}`,
                  changed_by: "upload",
                })) as never,
              );
            }
          }
        }
      } catch {
        // Best-effort; ignore churn detection errors
      }

      // Apply Health Score Rules 1 + 2 (src/lib/health.ts) for tenants whose
      // snapshot for this period is being inserted for the first time. Re-uploads
      // of the same month are skipped to avoid double-counting deltas.
      let scoring: { newScored: number; downs: number; ups: number; skipped: number } | undefined;
      if (success > 0) {
        try {
          const { data: prevPeriodRow } = await supabase
            .from("tenant_snapshots")
            .select("period")
            .lt("period", periodIso)
            .order("period", { ascending: false })
            .limit(1);
          const prevPeriod = (prevPeriodRow as { period: string }[] | null)?.[0]?.period;
          const prevByTenant = new Map<string, Snapshot>();
          if (prevPeriod) {
            const prevSnaps = await fetchAllPaged<Snapshot>((from, to) =>
              supabase.from("tenant_snapshots").select("*").eq("period", prevPeriod).range(from, to),
            );
            prevSnaps.forEach((s) => prevByTenant.set(s.tenant_name, s));
          }
          const currentScores = await fetchHealthScores();
          const toScore = (records as unknown as Snapshot[]).filter(
            (r) => !alreadyHadThisPeriod.has(String(r.tenant_name)),
          );
          const skipped = records.length - toScore.length;
          const scoreResults = await applyUploadScoreChanges(
            periodIso,
            currentWeekStart(),
            toScore,
            prevByTenant,
            currentScores,
          );
          scoring = {
            newScored: scoreResults.filter((r) => r.isNew).length,
            downs: scoreResults.filter((r) => !r.isNew && r.delta < 0).length,
            ups: scoreResults.filter((r) => !r.isNew && r.delta > 0).length,
            skipped,
          };
        } catch (e) {
          errors.push({ tenant: "—", message: `Falha ao aplicar regras de score: ${e instanceof Error ? e.message : "erro desconhecido"}` });
        }
      }

      setResult({ success, errors, newClubs, missingClubs, scoring });
      await loadHistory();
    } catch (e) {
      errors.push({ tenant: "—", message: e instanceof Error ? e.message : "Erro desconhecido" });
      setResult({ success, errors });
    } finally {
      setIsUploading(false);
    }
  }

  const years = useMemo(() => {
    const cur = now.getUTCFullYear();
    return [cur - 2, cur - 1, cur, cur + 1];
  }, [now]);
  const months = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
  ];

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Carregar snapshot mensal</h1>
        <p className="text-sm text-muted-foreground mt-1">Arraste um ficheiro .xlsx exportado para registar os KPIs dos tenants para um mês. Voltar a carregar substitui esse mês em segurança.</p>
      </header>

      <section className="rounded-xl border border-border bg-background p-6">
        <div className="grid grid-cols-2 gap-3 mb-5">
          <div>
            <label className="text-xs uppercase tracking-wide text-muted-foreground">Mês</label>
            <select
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
              className="mt-1 w-full px-3 py-2 rounded-md border border-border bg-background text-sm"
            >
              {months.map((m, i) => (<option key={m} value={i + 1}>{m}</option>))}
            </select>
          </div>
          <div>
            <label className="text-xs uppercase tracking-wide text-muted-foreground">Ano</label>
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="mt-1 w-full px-3 py-2 rounded-md border border-border bg-background text-sm"
            >
              {years.map((y) => (<option key={y} value={y}>{y}</option>))}
            </select>
          </div>
        </div>

        <div
          {...getRootProps()}
          className={
            "rounded-lg border-2 border-dashed p-10 text-center cursor-pointer transition-colors " +
            (isDragActive ? "border-foreground bg-surface" : "border-border hover:border-foreground/40 hover:bg-surface")
          }
        >
          <input {...getInputProps()} />
          <UploadCloud className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
          {file ? (
            <div className="flex items-center justify-center gap-2 text-sm">
              <FileSpreadsheet className="h-4 w-4" />
              <span className="font-medium">{file.name}</span>
              <span className="text-muted-foreground">({(file.size / 1024).toFixed(1)} KB)</span>
            </div>
          ) : (
            <>
              <p className="text-sm font-medium">Largue aqui o ficheiro .xlsx</p>
              <p className="text-xs text-muted-foreground mt-1">ou clique para procurar</p>
            </>
          )}
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button
            onClick={handleUpload}
            disabled={!file || isUploading}
            className="inline-flex items-center gap-2 rounded-md bg-foreground text-background px-4 py-2 text-sm font-medium disabled:opacity-40 hover:opacity-90"
          >
            {isUploading ? "A carregar…" : `Carregar para ${periodLabel}`}
          </button>
          {file && !isUploading && (
            <button onClick={() => { setFile(null); setResult(null); }} className="text-sm text-muted-foreground hover:text-foreground">
              Limpar
            </button>
          )}
        </div>

        {isUploading && (
          <div className="mt-5">
            <div className="h-2 rounded-full bg-surface overflow-hidden">
              <div className="h-full bg-foreground transition-all" style={{ width: `${progress}%` }} />
            </div>
            <div className="mt-2 text-xs text-muted-foreground">{progress}%</div>
          </div>
        )}

        {result && (
          <div className="mt-6 space-y-3">
            <div className="flex items-center gap-2 rounded-md bg-success/10 text-success px-3 py-2 text-sm">
              <CheckCircle2 className="h-4 w-4" />
              {result.success} tenants registados para {periodLabel}
            </div>
            {(result.newClubs || result.missingClubs) && (
              <div className="rounded-md border border-border p-3 text-sm space-y-2">
                <div className="flex flex-wrap gap-3 text-xs">
                  <span><span className="font-medium">{result.newClubs?.length ?? 0}</span> novos clubes adicionados</span>
                  <span>·</span>
                  <span><span className="font-medium">{result.missingClubs?.length ?? 0}</span> clubes em falta neste carregamento (sinalizados como candidatos a churn)</span>
                </div>
                {result.missingClubs && result.missingClubs.length > 0 && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Ver clubes em falta</summary>
                    <ul className="mt-2 grid grid-cols-2 gap-1 max-h-40 overflow-auto">
                      {result.missingClubs.map((n) => <li key={n} className="text-muted-foreground">• {n}</li>)}
                    </ul>
                  </details>
                )}
              </div>
            )}
            {result.scoring && (
              <div className="rounded-md border border-border p-3 text-sm space-y-1">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Health Score (Regras 1 e 2)</div>
                <div className="flex flex-wrap gap-3 text-xs">
                  <span><span className="font-medium">{result.scoring.newScored}</span> novos clubes — score inicial 100</span>
                  <span>·</span>
                  <span><span className="font-medium">{result.scoring.downs}</span> com queda &gt;10% — −10 e tarefa criada</span>
                  <span>·</span>
                  <span><span className="font-medium">{result.scoring.ups}</span> com subida &gt;10% — +10 e tarefa criada</span>
                  {result.scoring.skipped > 0 && (
                    <>
                      <span>·</span>
                      <span className="text-muted-foreground">{result.scoring.skipped} ignorados (re-upload do mesmo mês)</span>
                    </>
                  )}
                </div>
              </div>
            )}
            {result.errors.length > 0 && (
              <div className="rounded-md border border-danger/30 bg-danger/5 p-3">
                <div className="flex items-center gap-2 text-sm text-danger font-medium mb-2">
                  <XCircle className="h-4 w-4" /> {result.errors.length} {result.errors.length === 1 ? "linha com erro" : "linhas com erro"}
                </div>
                <ul className="text-xs space-y-1 max-h-48 overflow-auto">
                  {result.errors.map((e, i) => (
                    <li key={i}><span className="font-medium">{e.tenant}:</span> <span className="text-muted-foreground">{e.message}</span></li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>

      {history.length > 0 && (
        <section className="rounded-xl border border-border bg-background overflow-hidden mt-6">
          <div className="px-5 py-4 border-b border-border">
            <h2 className="text-sm font-semibold">Histórico de carregamentos</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Re-carregar este mês substitui os dados existentes.</p>
          </div>
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 text-left">Período</th>
                  <th className="px-4 py-2.5 text-right">Nº de clubes</th>
                  <th className="px-4 py-2.5 text-left">Data de carregamento</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.period} className="border-t border-border hover:bg-surface">
                    <td className="px-4 py-2 font-medium capitalize">
                      {new Date(`${h.period}T00:00:00Z`).toLocaleString("pt-PT", { month: "long", year: "numeric", timeZone: "UTC" })}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{h.club_count}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {new Date(h.uploaded_at).toLocaleString("pt-PT")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
