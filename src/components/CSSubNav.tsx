import { Link, useLocation } from "@tanstack/react-router";
import { ListChecks, History } from "lucide-react";

const items = [
  { to: "/cs/tasks", label: "Tarefas", icon: ListChecks },
  { to: "/cs/history", label: "Histórico", icon: History },
] as const;

export function CSSubNav() {
  const loc = useLocation();
  return (
    <div className="px-4 sm:px-6 lg:px-8 pt-4 sm:pt-6 lg:pt-8 max-w-[1400px] mx-auto">
      <nav className="inline-flex rounded-md border border-border bg-background p-0.5">
        {items.map((it) => {
          const active = loc.pathname.startsWith(it.to);
          const Icon = it.icon;
          return (
            <Link
              key={it.to}
              to={it.to}
              className={
                "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded transition-colors " +
                (active
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground")
              }
            >
              <Icon className="h-3.5 w-3.5" />
              {it.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
