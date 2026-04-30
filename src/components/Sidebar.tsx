import { Link, useLocation } from "@tanstack/react-router";
import { Upload, LayoutDashboard, AlertTriangle, Activity, Users, Building2, Shield, LogOut, UserCircle, HelpCircle } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

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

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-60 shrink-0 border-r border-border bg-sidebar-bg flex-col sticky top-0 h-screen">
        <div className="px-5 py-5 border-b border-border">
          <Brand />
        </div>
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
            className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors"
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
            className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors"
          >
            <LogOut className="h-4 w-4" />
            Sair
          </button>
        </div>
      </aside>

      {/* Mobile bottom nav */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-surface border-t border-border flex shadow-sm"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-label="Navegação principal"
      >
        {items.map((item) => {
          const active = isActive(loc.pathname, item);
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              data-active={active}
              className="bottom-nav-item"
            >
              <Icon className="h-6 w-6" />
              <span>{item.label}</span>
            </Link>
          );
        })}
        <Link
          to={helpItem.to}
          data-active={isActive(loc.pathname, helpItem)}
          className="bottom-nav-item"
          aria-label="Ajuda"
        >
          <HelpCircle className="h-6 w-6" />
          <span>Ajuda</span>
        </Link>
        <Link
          to="/profile"
          data-active={loc.pathname === "/profile"}
          className="bottom-nav-item"
          aria-label="Perfil"
        >
          <UserCircle className="h-6 w-6" />
          <span>Perfil</span>
        </Link>
      </nav>
    </>
  );
}
