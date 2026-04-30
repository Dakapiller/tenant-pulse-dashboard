import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type ChangelogEntry,
  type ChangelogItem,
  type ChangelogItemType,
  ITEM_TYPE_LABEL,
  createChangelogEntry,
  updateChangelogEntry,
} from "@/lib/changelog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: ChangelogEntry | null;
  onSaved: () => void;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function ChangelogEntryDialog({ open, onOpenChange, initial, onSaved }: Props) {
  const [version, setVersion] = useState("");
  const [releasedAt, setReleasedAt] = useState(todayIso());
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [items, setItems] = useState<ChangelogItem[]>([{ type: "feature", text: "" }]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setVersion(initial.version);
      setReleasedAt(initial.released_at);
      setTitle(initial.title);
      setSummary(initial.summary ?? "");
      setItems(initial.entries.length > 0 ? initial.entries : [{ type: "feature", text: "" }]);
    } else {
      setVersion("");
      setReleasedAt(todayIso());
      setTitle("");
      setSummary("");
      setItems([{ type: "feature", text: "" }]);
    }
  }, [open, initial]);

  function updateItem(idx: number, patch: Partial<ChangelogItem>) {
    setItems((cur) => cur.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  async function handleSubmit() {
    setSaving(true);
    try {
      const payload = {
        version,
        released_at: releasedAt,
        title,
        summary: summary.trim() || null,
        entries: items.filter((i) => i.text.trim().length > 0),
      };
      if (initial) {
        await updateChangelogEntry(initial.id, payload);
        toast.success("Entrada atualizada.");
      } else {
        await createChangelogEntry(payload);
        toast.success("Entrada criada.");
      }
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao guardar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? "Editar entrada" : "Nova entrada de changelog"}</DialogTitle>
          <DialogDescription>
            Documenta o que mudou nesta versão. Os utilizadores autenticados verão estas notas no Centro
            de ajuda.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="version">Versão</Label>
              <Input
                id="version"
                placeholder="ex.: 1.2.0"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="released_at">Data</Label>
              <Input
                id="released_at"
                type="date"
                value={releasedAt}
                onChange={(e) => setReleasedAt(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="title">Título</Label>
            <Input
              id="title"
              placeholder="Resumo da versão num título"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="summary">Descrição (opcional)</Label>
            <Textarea
              id="summary"
              placeholder="Contexto adicional sobre esta versão"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <Label>Itens</Label>
            <div className="space-y-2">
              {items.map((it, idx) => (
                <div key={idx} className="flex gap-2 items-start">
                  <Select
                    value={it.type}
                    onValueChange={(v) => updateItem(idx, { type: v as ChangelogItemType })}
                  >
                    <SelectTrigger className="w-[160px] shrink-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="feature">{ITEM_TYPE_LABEL.feature}</SelectItem>
                      <SelectItem value="improvement">{ITEM_TYPE_LABEL.improvement}</SelectItem>
                      <SelectItem value="fix">{ITEM_TYPE_LABEL.fix}</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    placeholder="Descreve a alteração"
                    value={it.text}
                    onChange={(e) => updateItem(idx, { text: e.target.value })}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setItems((cur) => cur.filter((_, i) => i !== idx))}
                    disabled={items.length === 1}
                    aria-label="Remover item"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setItems((cur) => [...cur, { type: "feature", text: "" }])}
            >
              <Plus className="h-4 w-4 mr-1" /> Adicionar item
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? "A guardar…" : initial ? "Guardar alterações" : "Criar entrada"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
