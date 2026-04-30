import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, Sparkles, Wrench, Bug } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ChangelogEntryDialog } from "@/components/ChangelogEntryDialog";
import { useAuth } from "@/contexts/AuthContext";
import {
  type ChangelogEntry,
  type ChangelogItemType,
  ITEM_TYPE_GROUP_LABEL,
  deleteChangelogEntry,
  fetchChangelog,
} from "@/lib/changelog";

export const Route = createFileRoute("/help/changelog")({
  head: () => ({
    meta: [
      { title: "Novidades por versão — Tenant Pulse" },
      { name: "description", content: "Acompanha o que mudou em cada nova versão do Tenant Pulse." },
    ],
  }),
  component: ChangelogPage,
});

function formatDate(iso: string): string {
  try {
    return new Date(`${iso}T00:00:00`).toLocaleDateString("pt-PT", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

const ICONS: Record<ChangelogItemType, typeof Sparkles> = {
  feature: Sparkles,
  improvement: Wrench,
  fix: Bug,
};

const TYPE_ORDER: ChangelogItemType[] = ["feature", "improvement", "fix"];

function ChangelogPage() {
  const { profile } = useAuth();
  const isSuperuser = profile?.role === "superuser";
  const [entries, setEntries] = useState<ChangelogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ChangelogEntry | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState<ChangelogEntry | null>(null);

  async function load() {
    try {
      const data = await fetchChangelog();
      setEntries(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar changelog.");
    }
  }

  useEffect(() => { void load(); }, []);

  async function handleDelete() {
    if (!deleting) return;
    try {
      await deleteChangelogEntry(deleting.id);
      toast.success("Entrada eliminada.");
      setDeleting(null);
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao eliminar.");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">Novidades por versão</h1>
          <p className="mt-2 text-muted-foreground text-sm">
            O que mudou em cada nova versão do Tenant Pulse, da mais recente para a mais antiga.
          </p>
        </div>
        {isSuperuser && (
          <Button onClick={() => { setEditing(null); setDialogOpen(true); }}>
            <Plus className="h-4 w-4 mr-1" /> Nova entrada
          </Button>
        )}
      </div>

      {error && (
        <Card>
          <CardContent className="p-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {entries === null ? (
        <p className="text-sm text-muted-foreground">A carregar…</p>
      ) : entries.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground text-sm">
            Ainda não há entradas no changelog.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {entries.map((e) => {
            const grouped: Record<ChangelogItemType, string[]> = { feature: [], improvement: [], fix: [] };
            for (const it of e.entries) grouped[it.type].push(it.text);
            return (
              <Card key={e.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className="font-mono">v{e.version}</Badge>
                        <span className="text-xs text-muted-foreground">{formatDate(e.released_at)}</span>
                      </div>
                      <h2 className="text-lg font-semibold text-foreground">{e.title}</h2>
                      {e.summary && <p className="text-sm text-muted-foreground">{e.summary}</p>}
                    </div>
                    {isSuperuser && (
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => { setEditing(e); setDialogOpen(true); }}
                          aria-label="Editar"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleting(e)}
                          aria-label="Eliminar"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4 pt-0">
                  {TYPE_ORDER.map((t) => {
                    if (grouped[t].length === 0) return null;
                    const Icon = ICONS[t];
                    return (
                      <div key={t}>
                        <div className="flex items-center gap-2 mb-2 text-xs uppercase tracking-wide text-muted-foreground font-semibold">
                          <Icon className="h-3.5 w-3.5" />
                          {ITEM_TYPE_GROUP_LABEL[t]}
                        </div>
                        <ul className="space-y-1.5 text-sm text-foreground/90">
                          {grouped[t].map((text, i) => (
                            <li key={i} className="flex gap-2">
                              <span className="text-muted-foreground mt-0.5">•</span>
                              <span>{text}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <ChangelogEntryDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initial={editing}
        onSaved={() => void load()}
      />

      <AlertDialog open={!!deleting} onOpenChange={(o) => { if (!o) setDeleting(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar entrada?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação é permanente e remove a entrada da versão {deleting?.version} para todos os utilizadores.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
