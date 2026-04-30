import { Outlet, Link, createRootRoute, HeadContent, Scripts, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Sidebar } from "@/components/Sidebar";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { PendingApprovalScreen } from "@/components/PendingApprovalScreen";
import { DeniedAccessScreen } from "@/components/DeniedAccessScreen";
import { Toaster } from "@/components/ui/sonner";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Página não encontrada</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          A página que procura não existe ou foi movida.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Voltar ao início
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Tenant Pulse - Monitorização de Saúde de Tenants" },
      { name: "description", content: "Monitorize a saúde dos tenants, GMV, receita e sinais de risco em todo o portfólio." },
      { property: "og:title", content: "Tenant Pulse - Monitorização de Saúde de Tenants" },
      { name: "twitter:title", content: "Tenant Pulse - Monitorização de Saúde de Tenants" },
      { property: "og:description", content: "Monitorize a saúde dos tenants, GMV, receita e sinais de risco em todo o portfólio." },
      { name: "twitter:description", content: "Monitorize a saúde dos tenants, GMV, receita e sinais de risco em todo o portfólio." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/38949921-1381-496f-bcc9-4493fa360ad7/id-preview-bac0bebc--6d17d3a3-b220-43bd-b6ea-663ad4a72476.lovable.app-1777304117145.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/38949921-1381-496f-bcc9-4493fa360ad7/id-preview-bac0bebc--6d17d3a3-b220-43bd-b6ea-663ad4a72476.lovable.app-1777304117145.png" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:type", content: "website" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap",
      },
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-PT">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  return (
    <AuthProvider>
      <AuthGate />
      <Toaster />
    </AuthProvider>
  );
}

function AuthGate() {
  const { user, profile, loading, profileError, refreshProfile, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const isLoginRoute = location.pathname === "/login";
  const [profileSlow, setProfileSlow] = useState(false);

  useEffect(() => {
    if (!user || profile) {
      setProfileSlow(false);
      return;
    }
    const t = setTimeout(() => setProfileSlow(true), 3000);
    return () => clearTimeout(t);
  }, [user, profile]);

  useEffect(() => {
    if (loading) return;
    if (!user && !isLoginRoute) {
      void navigate({ to: "/login" });
    } else if (user && profile && profile.role !== "pending" && profile.role !== "denied" && isLoginRoute) {
      void navigate({ to: "/" });
    }
  }, [user, profile, loading, isLoginRoute, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground">
        A carregar…
      </div>
    );
  }

  if (isLoginRoute) {
    return <Outlet />;
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground">
        A redirecionar…
      </div>
    );
  }

  // user is authenticated; profile may still be loading on first frame
  if (!profile) {
    if (profileSlow) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background px-4">
          <div className="max-w-md text-center space-y-4">
            <h2 className="text-lg font-semibold text-foreground">Não foi possível carregar o teu perfil</h2>
            <p className="text-sm text-muted-foreground">
              {profileError ?? "A ligação à base de dados está lenta ou indisponível."}
            </p>
            <div className="flex gap-2 justify-center">
              <button
                onClick={() => { setProfileSlow(false); void refreshProfile(); }}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                Tentar novamente
              </button>
              <button
                onClick={() => void signOut()}
                className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
              >
                Terminar sessão
              </button>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground">
        A carregar perfil…
      </div>
    );
  }

  if (profile.role === "pending") {
    return <PendingApprovalScreen />;
  }

  if (profile.role === "denied") {
    return <DeniedAccessScreen />;
  }

  return (
    <div className="flex flex-col md:flex-row md:h-screen md:overflow-hidden bg-background text-foreground">
      <Sidebar />
      <main className="flex-1 min-w-0 md:overflow-y-auto overflow-x-hidden">
        <Outlet />
      </main>
    </div>
  );
}
