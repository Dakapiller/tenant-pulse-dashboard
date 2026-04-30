import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { fetchLatestVersion } from "@/lib/changelog";

export function VersionBadge({ className = "" }: { className?: string }) {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    fetchLatestVersion().then((v) => {
      if (mounted) setVersion(v);
    });
    return () => {
      mounted = false;
    };
  }, []);

  if (!version) return null;

  return (
    <Link
      to="/help/changelog"
      className={
        "inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors " +
        className
      }
      title="Ver novidades por versão"
    >
      <span className="rounded-full bg-muted px-2 py-0.5">v{version}</span>
    </Link>
  );
}
