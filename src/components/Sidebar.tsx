import { Link, useLocation } from "@tanstack/react-router";
import { Upload, LayoutDashboard, AlertTriangle, Activity, Users } from "lucide-react";

const items = [
  { to: "/", label: "Overview", icon: LayoutDashboard },
  { to: "/upload", label: "Upload", icon: Upload },
  { to: "/at-risk", label: "At-risk", icon: AlertTriangle },
  { to: "/cs", label: "Customer Success", icon: Users },
];

export function Sidebar() {
  const loc = useLocation();
  return (
    <aside className="w-60 shrink-0 border-r border-border bg-sidebar-bg flex flex-col">
      <div className="px-5 py-5 border-b border-border flex items-center gap-2">
        <div className="h-8 w-8 rounded-md bg-foreground text-background flex items-center justify-center">
          <Activity className="h-4 w-4" />
        </div>
        <div>
          <div className="font-semibold text-sm leading-tight">Tenant Pulse</div>
          <div className="text-xs text-muted-foreground">Health monitoring</div>
        </div>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {items.map((item) => {
          const active = loc.pathname === item.to;
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors " +
                (active
                  ? "bg-foreground text-background"
                  : "text-foreground hover:bg-accent")
              }
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="p-4 text-[11px] text-muted-foreground border-t border-border">
        v1.0 · Local-only parsing
      </div>
    </aside>
  );
}
