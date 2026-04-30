import { Link, useLocation } from "@tanstack/react-router";
import { Upload, LayoutDashboard, AlertTriangle, Activity, Users, Building2, Shield, LogOut, UserCircle, HelpCircle, Menu, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { VersionBadge } from "@/components/VersionBadge";
import { useEffect, useState } from "react";

type NavItem = {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  matchPrefix?: string;
  superuserOnly?: boolean;
};

const allItems: readonly NavItem[] = [
  { to: "/", label: "Visão geral", icon: LayoutDashboard },
  { to: "/clubs", label: "Clubes", icon: Building2 },
  { to: "/upload", label: "Carregar", icon: Upload, superuserOnly: true },
  { to: "/at-risk", label: "Em risco", icon: AlertTriangle },
  { to: "/cs/tasks", label: "CS", icon: Users, matchPrefix: "/cs" },
  { to: "/admin", label: "Admin", icon: Shield, superuserOnly: true },
];

const helpItem: NavItem = { to: "/help", label: "Ajuda", icon: HelpCircle, matchPrefix: "/help" };

function isActive(pathname: string, item: NavItem): boolean {
  if (item.matchPrefix) return pathname.startsWith(item.matchPrefix);
  return pathname === item.to;
}

function Brand() {
  return (
    <div className="flex items-center gap-2">
      <div className="h-8 w-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center">
        <Activity className="h-4 w-4" />
      </div>
      <div>
        <div className="font-semibold text-sm leading-tight">Tenant Pulse</div>
        <div className="text-xs text-muted-foreground">Monitorização de tenants</div>
      </div>
    </div>
  );
}

export function Sidebar() {
  const loc = useLocation();
  const { profile, user, signOut } = useAuth();
  const isSuperuser = profile?.role === "superuser";
  const items = allItems.filter((i) => !i.superuserOnly || isSuperuser);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Fechar drawer ao navegar
  useEffect(() => {
    setMobileOpen(false);
  }, [loc.pathname]);

  // Bloquear scroll quando o drawer está aberto
  useEffect(() => {
    if (mobileOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = prev; };
    }
  }, [mobileOpen]);

  const navContent = (
    <>
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto min-h-0">
        {items.map((item) => {
          const active = isActive(loc.pathname, item);
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors duration-150 min-h-10 " +
                (active
                  ? "bg-primary text-primary-foreground"
                  : "text-foreground hover:bg-muted")
              }
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="p-3 border-t border-border space-y-1">
        <Link
          to={helpItem.to}
          className={
            "w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap text-center rounded-lg " +
            (isActive(loc.pathname, helpItem)
              ? "bg-primary text-primary-foreground"
              : "text-foreground hover:bg-muted")
          }
        >
          <HelpCircle className="h-4 w-4" />
          Ajuda
        </Link>
        <Link
          to="/profile"
          className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap text-center rounded-lg text-foreground hover:bg-muted"
        >
          <UserCircle className="h-4 w-4 shrink-0" />
          <div className="min-w-0">
            <div className="truncate">{profile?.display_name ?? user?.email ?? "Perfil"}</div>
            <div className="text-xs text-muted-foreground truncate" title={user?.email ?? ""}>
              {user?.email}
            </div>
          </div>
        </Link>
        <button
          onClick={() => void signOut()}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap text-center rounded-lg text-foreground hover:bg-muted"
        >
          <LogOut className="h-4 w-4" />
          Sair
        </button>
      </div>
    </>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-60 shrink-0 border-r border-border bg-sidebar-bg flex-col sticky top-0 h-screen">
        <div className="px-5 py-5 border-b border-border flex items-center justify-between gap-2">
          <Brand />
          <VersionBadge />
        </div>
        {navContent}
      </aside>

      {/* Mobile top bar */}
      <header
        className="md:hidden sticky top-0 z-40 flex items-center justify-between gap-2 px-3 py-2 bg-sidebar-bg border-b border-border"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.5rem)" }}
      >
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="inline-flex items-center justify-center h-10 w-10 rounded-lg text-foreground hover:bg-muted"
          aria-label="Abrir menu"
          aria-expanded={mobileOpen}
        >
          <Menu className="h-5 w-5" />
        </button>
        <Brand />
        <VersionBadge />
      </header>

      {/* Mobile drawer overlay */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-50 bg-black/50"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Mobile vertical sidebar (drawer) */}
      <aside
        className={
          "md:hidden fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] bg-sidebar-bg border-r border-border flex flex-col transition-transform duration-200 ease-out " +
          (mobileOpen ? "translate-x-0" : "-translate-x-full")
        }
        aria-hidden={!mobileOpen}
        aria-label="Navegação principal"
      >
        <div
          className="px-4 py-3 border-b border-border flex items-center justify-between gap-2"
          style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.75rem)" }}
        >
          <Brand />
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="inline-flex items-center justify-center h-9 w-9 rounded-lg text-foreground hover:bg-muted"
            aria-label="Fechar menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {navContent}
      </aside>
    </>
  );
}
