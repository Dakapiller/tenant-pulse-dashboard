import { Activity, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";

export function PendingApprovalScreen() {
  const { user, signOut } = useAuth();
  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-background">
      <div className="w-full max-w-md text-center space-y-6">
        <div className="mx-auto h-12 w-12 rounded-xl bg-primary text-primary-foreground flex items-center justify-center">
          <Activity className="h-6 w-6" />
        </div>
        <div className="space-y-2">
          <div className="mx-auto h-16 w-16 rounded-full bg-muted flex items-center justify-center">
            <Clock className="h-8 w-8 text-muted-foreground" />
          </div>
          <h1 className="text-2xl font-semibold">Aguarda aprovação</h1>
          <p className="text-muted-foreground">
            A tua conta <span className="font-medium text-foreground">{user?.email}</span> foi criada
            e está a aguardar aprovação do administrador.
          </p>
        </div>
        <Button variant="outline" onClick={() => void signOut()}>
          Terminar sessão
        </Button>
      </div>
    </div>
  );
}
