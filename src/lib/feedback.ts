import { supabase } from "@/integrations/supabase/client";
import { fetchAllPaged } from "@/lib/data";

export const FEEDBACK_CATEGORIES = [
  "Calendário",
  "Clientes",
  "Recompensas e Ofertas",
  "Pagamentos",
  "Marcações",
  "Jogos",
  "Academia",
  "Torneios",
  "Ligas",
  "Loja",
  "Faturação",
  "Relatórios",
  "Outro",
] as const;

export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

export type FeedbackStatus = "good_to_have" | "must_have" | "blocker";

export const FEEDBACK_STATUS_OPTIONS: {
  value: FeedbackStatus;
  label: string;
  tooltip: string;
}[] = [
  {
    value: "good_to_have",
    label: "Good to have",
    tooltip: "Melhoria desejável; não bloqueia operação nem decisão de churn.",
  },
  {
    value: "must_have",
    label: "Must have",
    tooltip:
      "Funcionalidade necessária; ausência afeta operação ou satisfação significativamente.",
  },
  {
    value: "blocker",
    label: "Blocker",
    tooltip:
      "Está a impedir o uso da plataforma ou é a razão direta apontada para churn / possível churn.",
  },
];

export const STATUS_LABEL: Record<FeedbackStatus, string> = {
  good_to_have: "Good to have",
  must_have: "Must have",
  blocker: "Blocker",
};

export interface ProductFeedback {
  id: string;
  tenant_name: string;
  reported_at: string;
  category: string;
  feature_name: string;
  status_tag: FeedbackStatus;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

export interface InsertFeedbackInput {
  tenant: string;
  reportedAt: string; // YYYY-MM-DD
  category: FeedbackCategory | string;
  featureName: string;
  statusTag: FeedbackStatus;
  note?: string | null;
}

export async function insertProductFeedback(input: InsertFeedbackInput): Promise<void> {
  const featureName = input.featureName.trim();
  const note = input.note?.trim() || null;
  if (!input.tenant) throw new Error("Clube obrigatório.");
  if (!input.category) throw new Error("Categoria obrigatória.");
  if (featureName.length === 0 || featureName.length > 200)
    throw new Error("Funcionalidade entre 1 e 200 caracteres.");
  if (note && note.length > 500) throw new Error("Nota até 500 caracteres.");

  const { data: userData } = await supabase.auth.getUser();
  const { error } = await supabase.from("product_feedback" as never).insert({
    tenant_name: input.tenant,
    reported_at: input.reportedAt,
    category: input.category,
    feature_name: featureName,
    status_tag: input.statusTag,
    note,
    created_by: userData.user?.id ?? null,
  } as never);
  if (error) throw error;
}

export async function fetchAllFeedback(): Promise<ProductFeedback[]> {
  return fetchAllPaged<ProductFeedback>((from, to) =>
    supabase
      .from("product_feedback" as never)
      .select("*")
      .order("reported_at", { ascending: false })
      .range(from, to) as never,
  );
}

/** Distinct feature names within a category (case-insensitive de-dup, ordered alphabetically). */
export async function fetchFeatureNamesByCategory(category: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("product_feedback" as never)
    .select("feature_name")
    .eq("category", category)
    .limit(1000);
  if (error) throw error;
  const seen = new Map<string, string>();
  for (const r of (data ?? []) as { feature_name: string }[]) {
    const key = r.feature_name.trim().toLowerCase();
    if (!seen.has(key)) seen.set(key, r.feature_name.trim());
  }
  return Array.from(seen.values()).sort((a, b) =>
    a.localeCompare(b, "pt", { sensitivity: "base" }),
  );
}

// ----------------- CSV export -----------------

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadCSV(filename: string, rows: string[][]): void {
  const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportFeedbackDetailedCSV(items: ProductFeedback[]): void {
  const rows: string[][] = [
    ["Clube", "Data do report", "Categoria", "Funcionalidade", "Status", "Nota"],
  ];
  for (const f of items) {
    rows.push([
      f.tenant_name,
      f.reported_at,
      f.category,
      f.feature_name,
      STATUS_LABEL[f.status_tag],
      f.note ?? "",
    ]);
  }
  downloadCSV(`product-feedback-detalhado-${new Date().toISOString().slice(0, 10)}.csv`, rows);
}

export interface FeedbackGroup {
  category: string;
  featureName: string;
  items: ProductFeedback[];
  clubs: Set<string>;
  blocker: number;
  must: number;
  good: number;
}

export function groupFeedback(items: ProductFeedback[]): FeedbackGroup[] {
  const map = new Map<string, FeedbackGroup>();
  for (const f of items) {
    const key = `${f.category}::${f.feature_name.toLowerCase()}`;
    let g = map.get(key);
    if (!g) {
      g = {
        category: f.category,
        featureName: f.feature_name,
        items: [],
        clubs: new Set(),
        blocker: 0,
        must: 0,
        good: 0,
      };
      map.set(key, g);
    }
    g.items.push(f);
    g.clubs.add(f.tenant_name);
    if (f.status_tag === "blocker") g.blocker += 1;
    else if (f.status_tag === "must_have") g.must += 1;
    else g.good += 1;
  }
  return Array.from(map.values()).sort((a, b) => {
    if (b.clubs.size !== a.clubs.size) return b.clubs.size - a.clubs.size;
    if (b.blocker !== a.blocker) return b.blocker - a.blocker;
    return a.featureName.localeCompare(b.featureName, "pt", { sensitivity: "base" });
  });
}

export function exportFeedbackAggregatedCSV(groups: FeedbackGroup[]): void {
  const rows: string[][] = [
    [
      "Categoria",
      "Funcionalidade",
      "Nº clubes",
      "Blocker",
      "Must have",
      "Good to have",
      "Clubes",
    ],
  ];
  for (const g of groups) {
    rows.push([
      g.category,
      g.featureName,
      String(g.clubs.size),
      String(g.blocker),
      String(g.must),
      String(g.good),
      Array.from(g.clubs).sort().join("; "),
    ]);
  }
  downloadCSV(`product-feedback-agregado-${new Date().toISOString().slice(0, 10)}.csv`, rows);
}
