import { Link, useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Upload, LayoutDashboard, AlertTriangle, Activity, Users, Building2, Menu, X } from "lucide-react";

const items = [
  { to: "/", label: "Visão geral", icon: LayoutDashboard },
  { to: "/clubs", label: "Clubes", icon: Building2 },
  { to: "/upload", label: "Carregar", icon: Upload },
  { to: "/at-risk", label: "Em risco", icon: AlertTriangle },
  { to: "/cs", label: "Customer Success", icon: Users },
];

function NavList({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav className="flex-1 p-3 space-y-1">
      {items.map((item) => {
        const active = pathname === item.to;
        const Icon = item.icon;
        return (
          <Link
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            className={
              "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors min-h-10 " +
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
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2">
      <div className="h-8 w-8 rounded-md bg-foreground text-background flex items-center justify-center">
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
  const [open, setOpen] = useState(false);

  // Close drawer on route change
  useEffect(() => {
    setOpen(false);
  }, [loc.pathname]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // Lock body scroll when drawer open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  return (
    <>
      {/* Mobile top bar */}
      <header
        className="md:hidden sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-border bg-background px-3 py-2"
        style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}
      >
        <button
          onClick={() => setOpen(true)}
          className="p-2 rounded-md hover:bg-accent min-h-10 min-w-10 flex items-center justify-center"
          aria-label="Abrir menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <Brand />
        <div className="w-10" />
      </header>

      {/* Mobile drawer */}
      {open && (
        <div className="md:hidden fixed inset-0 z-40 flex">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <aside
            className="relative w-72 max-w-[85vw] bg-sidebar-bg border-r border-border flex flex-col shadow-xl animate-in slide-in-from-left"
            style={{ paddingTop: "env(safe-area-inset-top)" }}
          >
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <Brand />
              <button
                onClick={() => setOpen(false)}
                className="p-1.5 rounded hover:bg-accent"
                aria-label="Fechar menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <NavList pathname={loc.pathname} onNavigate={() => setOpen(false)} />
            <div className="p-4 text-[11px] text-muted-foreground border-t border-border">
              v1.0 · Processamento local
            </div>
          </aside>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-60 shrink-0 border-r border-border bg-sidebar-bg flex-col">
        <div className="px-5 py-5 border-b border-border">
          <Brand />
        </div>
        <NavList pathname={loc.pathname} />
        <div className="p-4 text-[11px] text-muted-foreground border-t border-border">
          v1.0 · Processamento local
        </div>
      </aside>
    </>
  );
}
