import { supabase } from "@/integrations/supabase/client";

export type ChangelogItemType = "feature" | "improvement" | "fix";

export interface ChangelogItem {
  type: ChangelogItemType;
  text: string;
}

export interface ChangelogEntry {
  id: string;
  version: string;
  released_at: string; // YYYY-MM-DD
  title: string;
  summary: string | null;
  entries: ChangelogItem[];
  created_at: string;
  updated_at: string;
}

export const ITEM_TYPE_LABEL: Record<ChangelogItemType, string> = {
  feature: "Funcionalidade",
  improvement: "Melhoria",
  fix: "Correção",
};

export const ITEM_TYPE_GROUP_LABEL: Record<ChangelogItemType, string> = {
  feature: "Funcionalidades",
  improvement: "Melhorias",
  fix: "Correções",
};

function isItem(x: unknown): x is ChangelogItem {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.text === "string" &&
    (o.type === "feature" || o.type === "improvement" || o.type === "fix")
  );
}

function normalize(row: Record<string, unknown>): ChangelogEntry {
  const raw = Array.isArray(row.entries) ? (row.entries as unknown[]) : [];
  const entries = raw.filter(isItem);
  return {
    id: String(row.id),
    version: String(row.version),
    released_at: String(row.released_at),
    title: String(row.title),
    summary: (row.summary as string | null) ?? null,
    entries,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export async function fetchChangelog(): Promise<ChangelogEntry[]> {
  const { data, error } = await supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from("changelog_entries" as any)
    .select("*")
    .order("released_at", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map(normalize);
}

export interface ChangelogInput {
  version: string;
  released_at: string;
  title: string;
  summary: string | null;
  entries: ChangelogItem[];
}

function validate(input: ChangelogInput): void {
  if (!input.version.trim()) throw new Error("A versão é obrigatória.");
  if (!input.title.trim()) throw new Error("O título é obrigatório.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.released_at)) throw new Error("Data inválida.");
  if (input.entries.length === 0) throw new Error("Adiciona pelo menos um item.");
  for (const it of input.entries) {
    if (!it.text.trim()) throw new Error("Todos os itens precisam de texto.");
  }
}

export async function createChangelogEntry(input: ChangelogInput): Promise<void> {
  validate(input);
  const { data: userData } = await supabase.auth.getUser();
  const { error } = await supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from("changelog_entries" as any)
    .insert({
      version: input.version.trim(),
      released_at: input.released_at,
      title: input.title.trim(),
      summary: input.summary?.trim() || null,
      entries: input.entries.map((e) => ({ type: e.type, text: e.text.trim() })),
      created_by: userData.user?.id ?? null,
    } as never);
  if (error) throw error;
}

export async function updateChangelogEntry(id: string, input: ChangelogInput): Promise<void> {
  validate(input);
  const { error } = await supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from("changelog_entries" as any)
    .update({
      version: input.version.trim(),
      released_at: input.released_at,
      title: input.title.trim(),
      summary: input.summary?.trim() || null,
      entries: input.entries.map((e) => ({ type: e.type, text: e.text.trim() })),
    } as never)
    .eq("id", id);
  if (error) throw error;
}

export async function deleteChangelogEntry(id: string): Promise<void> {
  const { error } = await supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from("changelog_entries" as any)
    .delete()
    .eq("id", id);
  if (error) throw error;
}
