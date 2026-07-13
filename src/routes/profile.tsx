import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { UserCircle, LogOut } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { updateMyName } from "@/lib/auth.functions";

export const Route = createFileRoute("/profile")({
  component: ProfilePage,
});

function roleLabel(role: string) {
  if (role === "superuser") return "Administrador";
  if (role === "cs") return "Customer Success";
  return "Pendente de aprovação";
}

function ProfilePage() {
  const { profile, user, signOut, refreshProfile } = useAuth();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(profile?.display_name ?? "");
  }, [profile?.display_name]);

  if (!profile || !user) {
    return <div className="p-6 text-muted-foreground">A carregar…</div>;
  }

  const onSave = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length < 1) { toast.error("Indica um nome"); return; }
    setBusy(true);
    try {
      await updateMyName({ data: { display_name: trimmed } });
      toast.success("Nome atualizado");
      await refreshProfile();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-8 pb-24 md:pb-6">
      <header className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
          <UserCircle className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold">O meu perfil</h1>
          <p className="text-sm text-muted-foreground">Definições da tua conta</p>
        </div>
      </header>

      <section className="rounded-xl border border-border bg-card p-6 space-y-4">
        <form onSubmit={onSave} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="display_name">Nome</Label>
            <Input
              id="display_name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              required
            />
          </div>

          <div className="space-y-2">
            <Label>Email</Label>
            <Input value={profile.email} disabled />
          </div>

          <div className="space-y-2">
            <Label>Tipo de acesso</Label>
            <div className="flex items-center gap-2">
              <Badge variant={profile.role === "superuser" ? "default" : "secondary"}>
                {roleLabel(profile.role)}
              </Badge>
              <span className="text-xs text-muted-foreground">
                Apenas alterável por um administrador.
              </span>
            </div>
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled={busy || name.trim() === (profile.display_name ?? "").trim()}>
              Guardar alterações
            </Button>
          </div>
        </form>
      </section>

      <section className="rounded-xl border border-border bg-card p-6 flex items-center justify-between">
        <div>
          <div className="font-medium">Terminar sessão</div>
          <div className="text-sm text-muted-foreground">Sai da tua conta neste dispositivo.</div>
        </div>
        <Button variant="outline" onClick={() => void signOut()}>
          <LogOut className="h-4 w-4" /> Sair
        </Button>
      </section>
    </div>
  );
}
