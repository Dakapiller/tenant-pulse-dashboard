import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Activity } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [signupDone, setSignupDone] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        // sign out so they can't access the app while pending
        await supabase.auth.signOut();
        setSignupDone(true);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const handleOAuth = async (provider: "google" | "apple") => {
    setBusy(true);
    try {
      const result = await lovable.auth.signInWithOAuth(provider, {
        redirect_uri: window.location.origin,
      });
      if (result.error) {
        toast.error(result.error instanceof Error ? result.error.message : "Erro OAuth");
        setBusy(false);
        return;
      }
      if (result.redirected) return;
      // session set, root will route
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro OAuth");
      setBusy(false);
    }
  };

  if (signupDone) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 bg-background">
        <div className="w-full max-w-md text-center space-y-4">
          <div className="mx-auto h-12 w-12 rounded-xl bg-primary text-primary-foreground flex items-center justify-center">
            <Activity className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-semibold">Conta criada</h1>
          <p className="text-muted-foreground">
            Aguarda aprovação do administrador. Receberás acesso assim que a tua conta for aprovada.
          </p>
          <Button variant="outline" onClick={() => { setSignupDone(false); setMode("signin"); }}>
            Voltar ao login
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-background">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="mx-auto h-12 w-12 rounded-xl bg-primary text-primary-foreground flex items-center justify-center">
            <Activity className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-semibold">Tenant Pulse</h1>
          <p className="text-sm text-muted-foreground">Monitorização de tenants</p>
        </div>

        <div className="rounded-xl border border-border bg-card p-6 space-y-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Palavra-passe</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {mode === "signin" ? "Entrar" : "Criar conta"}
            </Button>
          </form>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">ou</span>
            </div>
          </div>

          <div className="space-y-2">
            <Button variant="outline" className="w-full" onClick={() => handleOAuth("google")} disabled={busy}>
              Continuar com Google
            </Button>
            <Button variant="outline" className="w-full" onClick={() => handleOAuth("apple")} disabled={busy}>
              Continuar com Apple
            </Button>
          </div>

          <div className="text-center text-sm">
            {mode === "signin" ? (
              <button type="button" className="text-primary hover:underline" onClick={() => setMode("signup")}>
                Criar conta
              </button>
            ) : (
              <button type="button" className="text-primary hover:underline" onClick={() => setMode("signin")}>
                Já tenho conta
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
