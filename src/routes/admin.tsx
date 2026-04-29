import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Shield, Check, X, RotateCcw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, type UserProfile } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { approveUser, revokeUser, rejectUser } from "@/server/admin-users.functions";

export const Route = createFileRoute("/admin")({
  component: AdminPage,
});

function AdminPage() {
  const { profile, loading } = useAuth();
  const navigate = useNavigate();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (loading) return;
    if (profile?.role !== "superuser") {
      toast.error("Acesso restrito a administradores.");
      void navigate({ to: "/" });
    }
  }, [profile, loading, navigate]);

  useEffect(() => {
    void (async () => {
      const { data, error } = await supabase
        .from("user_profiles")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) {
        toast.error(error.message);
        return;
      }
      setUsers((data as UserProfile[] | null) ?? []);
    })();
  }, [refreshKey]);

  const refresh = () => setRefreshKey((k) => k + 1);

  const onApprove = async (id: string) => {
    setBusy(id);
    try {
      await approveUser({ data: { userId: id } });
      toast.success("Utilizador aprovado");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    } finally { setBusy(null); }
  };

  const onReject = async (id: string) => {
    if (!confirm("Rejeitar este utilizador? Esta ação elimina a conta.")) return;
    setBusy(id);
    try {
      await rejectUser({ data: { userId: id } });
      toast.success("Utilizador rejeitado");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    } finally { setBusy(null); }
  };

  const onRevoke = async (id: string) => {
    if (!confirm("Revogar acesso deste utilizador?")) return;
    setBusy(id);
    try {
      await revokeUser({ data: { userId: id } });
      toast.success("Acesso revogado");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    } finally { setBusy(null); }
  };

  if (loading || profile?.role !== "superuser") {
    return <div className="p-6 text-muted-foreground">A carregar…</div>;
  }

  const pending = users.filter((u) => u.role === "pending");
  const active = users.filter((u) => u.role !== "pending");

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8 pb-24 md:pb-6">
      <header className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
          <Shield className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold">Administração</h1>
          <p className="text-sm text-muted-foreground">Gerir aprovações e acessos</p>
        </div>
      </header>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Pedidos pendentes ({pending.length})</h2>
        {pending.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sem pedidos pendentes.</p>
        ) : (
          <div className="rounded-lg border border-border divide-y divide-border">
            {pending.map((u) => (
              <div key={u.id} className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-4">
                <div>
                  <div className="font-medium">{u.email}</div>
                  <div className="text-xs text-muted-foreground">
                    Registado em {new Date(u.created_at).toLocaleString("pt-PT")}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => onApprove(u.id)} disabled={busy === u.id}>
                    <Check className="h-4 w-4" /> Aprovar
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => onReject(u.id)} disabled={busy === u.id}>
                    <X className="h-4 w-4" /> Rejeitar
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Utilizadores ativos ({active.length})</h2>
        <div className="rounded-lg border border-border divide-y divide-border">
          {active.map((u) => (
            <div key={u.id} className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{u.email}</span>
                  <Badge variant={u.role === "superuser" ? "default" : "secondary"}>
                    {u.role}
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground">
                  {u.approved_at ? `Aprovado em ${new Date(u.approved_at).toLocaleString("pt-PT")}` : "—"}
                </div>
              </div>
              {u.role !== "superuser" && (
                <Button size="sm" variant="outline" onClick={() => onRevoke(u.id)} disabled={busy === u.id}>
                  <RotateCcw className="h-4 w-4" /> Revogar acesso
                </Button>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
