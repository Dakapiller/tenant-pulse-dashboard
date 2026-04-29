import { Link, useLocation } from "@tanstack/react-router";
import { Upload, LayoutDashboard, AlertTriangle, Activity, Users, Building2 } from "lucide-react";

const items = [
  { to: "/", label: "Visão geral", icon: LayoutDashboard },
  { to: "/clubs", label: "Clubes", icon: Building2 },
  { to: "/upload", label: "Carregar", icon: Upload },
  { to: "/at-risk", label: "Em risco", icon: AlertTriangle },
  { to: "/cs/tasks", label: "CS", icon: Users, matchPrefix: "/cs" },
] as const;

function isActive(pathname: string, item: (typeof items)[number]): boolean {
  if ("matchPrefix" in item && item.matchPrefix) return pathname.startsWith(item.matchPrefix);
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

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-60 shrink-0 border-r border-border bg-sidebar-bg flex-col">
        <div className="px-5 py-5 border-b border-border">
          <Brand />
        </div>
        <nav className="flex-1 p-3 space-y-1">
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
        <div className="p-4 text-[11px] text-muted-foreground border-t border-border">
          v1.0 · Processamento local
        </div>
      </aside>

      {/* Mobile bottom nav — fixed, no hamburger */}
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
      </nav>
    </>
  );
}
