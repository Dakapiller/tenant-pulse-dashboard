import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllPaged } from "@/lib/data";
import { applyBugSolvedBonus } from "@/lib/health";

export type BugStatus = "open" | "in_progress" | "solved" | "wont_fix";
export type BugSeverity = "blocker" | "major" | "minor";

export const BUG_STATUS_OPTIONS: {
  value: BugStatus;
  label: string;
  tooltip: string;
}[] = [
  { value: "open", label: "Aberto", tooltip: "Bug reportado, ainda por triar/atribuir." },
  { value: "in_progress", label: "Em curso", tooltip: "Engenharia está a tratar do bug." },
  { value: "solved", label: "Resolvido", tooltip: "Bug corrigido e validado. Adiciona +5 ao health score do clube." },
  { value: "wont_fix", label: "Não será corrigido", tooltip: "Descartado (duplicado, fora de escopo, comportamento esperado). Sem impacto no score." },
];

export const BUG_STATUS_LABEL: Record<BugStatus, string> = {
  open: "Aberto",
  in_progress: "Em curso",
  solved: "Resolvido",
  wont_fix: "Não será corrigido",
};

export const BUG_SEVERITY_OPTIONS: {
  value: BugSeverity;
  label: string;
  tooltip: string;
}[] = [
  { value: "blocker", label: "Blocker", tooltip: "Impede a operação do clube ou causa perda de dados." },
  { value: "major", label: "Major", tooltip: "Funcionalidade importante afetada; existe workaround." },
  { value: "minor", label: "Minor", tooltip: "Problema cosmético ou de baixo impacto." },
];

export const BUG_SEVERITY_LABEL: Record<BugSeverity, string> = {
  blocker: "Blocker",
  major: "Major",
  minor: "Minor",
};

export interface BugReport {
  id: string;
  tenant_name: string;
  title: string;
  link: string;
  severity: BugSeverity;
  status: BugStatus;
  note: string | null;
  reported_at: string;
  solved_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface InsertBugInput {
  tenant: string;
  title: string;
  link: string;
  severity: BugSeverity;
  status: BugStatus;
  reportedAt: string; // YYYY-MM-DD
  note?: string | null;
}

const URL_RE = /^https?:\/\/.+/i;

function validateBugInput(input: InsertBugInput): { title: string; link: string; note: string | null } {
  const title = input.title.trim();
  const link = input.link.trim();
  const note = input.note?.trim() || null;
  if (!input.tenant) throw new Error("Clube obrigatório.");
  if (title.length === 0 || title.length > 200) throw new Error("Título entre 1 e 200 caracteres.");
  if (!URL_RE.test(link)) throw new Error("Link inválido — tem de começar por http:// ou https://.");
  if (link.length > 2000) throw new Error("Link demasiado longo (máx. 2000 caracteres).");
  if (note && note.length > 1000) throw new Error("Nota até 1000 caracteres.");
  if (!BUG_SEVERITY_OPTIONS.some((s) => s.value === input.severity)) throw new Error("Severidade inválida.");
  // Initial status: open or in_progress only.
  if (input.status !== "open" && input.status !== "in_progress") {
    throw new Error("Estado inicial deve ser Aberto ou Em curso.");
  }
  return { title, link, note };
}

export async function insertBugReport(input: InsertBugInput): Promise<void> {
  const { title, link, note } = validateBugInput(input);
  const { data: userData } = await supabase.auth.getUser();
  const { error } = await supabase.from("bug_reports" as never).insert({
    tenant_name: input.tenant,
    title,
    link,
    severity: input.severity,
    status: input.status,
    reported_at: input.reportedAt,
    note,
    created_by: userData.user?.id ?? null,
  } as never);
  if (error) throw error;
}

export async function fetchAllBugs(): Promise<BugReport[]> {
  return fetchAllPaged<BugReport>((from, to) =>
    supabase
      .from("bug_reports" as never)
      .select("*")
      .order("reported_at", { ascending: false })
      .range(from, to) as never,
  );
}

export async function fetchBugsForTenant(tenant: string): Promise<BugReport[]> {
  const { data, error } = await supabase
    .from("bug_reports" as never)
    .select("*")
    .eq("tenant_name", tenant)
    .order("reported_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as BugReport[];
}

export async function fetchBugsByStatuses(statuses: BugStatus[]): Promise<BugReport[]> {
  if (statuses.length === 0) return [];
  return fetchAllPaged<BugReport>((from, to) =>
    supabase
      .from("bug_reports" as never)
      .select("*")
      .in("status", statuses)
      .order("solved_at", { ascending: false, nullsFirst: false })
      .order("reported_at", { ascending: false })
      .range(from, to) as never,
  );
}

/**
 * Allowed transitions:
 *   open ↔ in_progress
 *   open/in_progress → solved
 *   open/in_progress → wont_fix
 *   solved → open   (reopen)
 *   wont_fix → open (reopen)
 *
 * Direct solved↔wont_fix is blocked — must go via open first.
 */
function isAllowedTransition(prev: BugStatus, next: BugStatus): boolean {
  if (prev === next) return true;
  const allowed: Record<BugStatus, BugStatus[]> = {
    open: ["in_progress", "solved", "wont_fix"],
    in_progress: ["open", "solved", "wont_fix"],
    solved: ["open"],
    wont_fix: ["open"],
  };
  return allowed[prev].includes(next);
}

/**
 * Update a bug's status. When moving to `solved` for the first time we:
 *   1) set `solved_at = now()`
 *   2) credit +5 to the club's health score via `applyBugSolvedBonus`.
 *
 * Reopening (solved → open) clears `solved_at` but does NOT revert the +5 —
 * the bonus was earned for the resolution; double-penalising would be unfair.
 */
export async function updateBugStatus(
  bug: Pick<BugReport, "id" | "tenant_name" | "title" | "status">,
  next: BugStatus,
): Promise<void> {
  if (!isAllowedTransition(bug.status, next)) {
    throw new Error(`Transição inválida: ${BUG_STATUS_LABEL[bug.status]} → ${BUG_STATUS_LABEL[next]}.`);
  }
  if (bug.status === next) return;

  const patch: Record<string, unknown> = { status: next };
  if (next === "solved") {
    patch.solved_at = new Date().toISOString();
  } else if (bug.status === "solved") {
    // reopened
    patch.solved_at = null;
  }

  const { error } = await supabase
    .from("bug_reports" as never)
    .update(patch as never)
    .eq("id", bug.id);
  if (error) throw error;

  // Health score bonus — only on the first transition INTO solved.
  if (next === "solved" && bug.status !== "solved") {
    try {
      await applyBugSolvedBonus(bug.tenant_name, bug.title);
    } catch (e) {
      // Bonus failure shouldn't roll back the status change — log only.
      console.error("Falha a aplicar bónus de health score:", e);
    }
  }
}

export interface UpdateBugFieldsInput {
  title?: string;
  link?: string;
  severity?: BugSeverity;
  note?: string | null;
}

export async function updateBugFields(id: string, patch: UpdateBugFieldsInput): Promise<void> {
  const out: Record<string, unknown> = {};
  if (patch.title !== undefined) {
    const t = patch.title.trim();
    if (t.length === 0 || t.length > 200) throw new Error("Título entre 1 e 200 caracteres.");
    out.title = t;
  }
  if (patch.link !== undefined) {
    const l = patch.link.trim();
    if (!URL_RE.test(l)) throw new Error("Link inválido — tem de começar por http:// ou https://.");
    if (l.length > 2000) throw new Error("Link demasiado longo.");
    out.link = l;
  }
  if (patch.severity !== undefined) {
    if (!BUG_SEVERITY_OPTIONS.some((s) => s.value === patch.severity)) throw new Error("Severidade inválida.");
    out.severity = patch.severity;
  }
  if (patch.note !== undefined) {
    const n = patch.note?.trim() || null;
    if (n && n.length > 1000) throw new Error("Nota até 1000 caracteres.");
    out.note = n;
  }
  if (Object.keys(out).length === 0) return;
  const { error } = await supabase.from("bug_reports" as never).update(out as never).eq("id", id);
  if (error) throw error;
}

// ----------------- XLSX export -----------------

function downloadXLSX(filename: string, sheets: { name: string; rows: (string | number)[][] }[]): void {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.rows);
    XLSX.utils.book_append_sheet(wb, ws, s.name);
  }
  XLSX.writeFile(wb, filename);
}

export function exportBugsXLSX(items: BugReport[]): void {
  const detailed: (string | number)[][] = [
    ["Clube", "Título", "Link", "Severidade", "Estado", "Data report", "Resolvido em", "Nota"],
  ];
  for (const b of items) {
    detailed.push([
      b.tenant_name,
      b.title,
      b.link,
      BUG_SEVERITY_LABEL[b.severity],
      BUG_STATUS_LABEL[b.status],
      b.reported_at,
      b.solved_at ? b.solved_at.slice(0, 10) : "",
      b.note ?? "",
    ]);
  }

  // Aggregated per club
  const byClub = new Map<string, { total: number; open: number; in_progress: number; solved: number; wont_fix: number; blocker: number }>();
  for (const b of items) {
    let g = byClub.get(b.tenant_name);
    if (!g) {
      g = { total: 0, open: 0, in_progress: 0, solved: 0, wont_fix: 0, blocker: 0 };
      byClub.set(b.tenant_name, g);
    }
    g.total += 1;
    g[b.status] += 1;
    if (b.severity === "blocker") g.blocker += 1;
  }
  const agg: (string | number)[][] = [
    ["Clube", "Total", "Aberto", "Em curso", "Resolvido", "Não corrigido", "Blocker"],
  ];
  for (const [tenant, g] of Array.from(byClub.entries()).sort((a, b) => b[1].total - a[1].total)) {
    agg.push([tenant, g.total, g.open, g.in_progress, g.solved, g.wont_fix, g.blocker]);
  }

  downloadXLSX(`bug-reports-${new Date().toISOString().slice(0, 10)}.xlsx`, [
    { name: "Detalhado", rows: detailed },
    { name: "Por clube", rows: agg },
  ]);
}
