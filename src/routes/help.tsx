import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import { BookOpen, Sparkles, Activity } from "lucide-react";

export const Route = createFileRoute("/help")({
  head: () => ({
    meta: [
      { title: "Centro de ajuda — Tenant Pulse" },
      { name: "description", content: "Documentação do Tenant Pulse: como funciona o health score e novidades por versão." },
    ],
  }),
  component: HelpLayout,
});

const articles = [
  { to: "/help/score", label: "Como funciona o Health Score", icon: Activity },
  { to: "/help/changelog", label: "Novidades por versão", icon: Sparkles },
];

function HelpLayout() {
  const loc = useLocation();
  return (
    <div className="px-4 md:px-8 py-6 md:py-10 max-w-6xl mx-auto pb-24 md:pb-10">
      <header className="mb-8">
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <BookOpen className="h-4 w-4" />
          <span>Centro de ajuda</span>
        </div>
        <h1 className="mt-1 text-2xl md:text-3xl font-semibold text-foreground">Documentação</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Aprende como o Tenant Pulse funciona e acompanha as novidades a cada nova versão.
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-[max-content_1fr] gap-6 md:gap-10">
        <nav className="md:sticky md:top-6 md:self-start">
          <ul className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible">
            {articles.map((a) => {
              const Icon = a.icon;
              const active = loc.pathname === a.to || (loc.pathname === "/help" && a.to === "/help/score");
              return (
                <li key={a.to} className="shrink-0">
                  <Link
                    to={a.to}
                    className={
                      "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap " +
                      (active ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted")
                    }
                  >
                    <Icon className="h-4 w-4" />
                    {a.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <article className="min-w-0">
          <Outlet />
        </article>
      </div>
    </div>
  );
}
