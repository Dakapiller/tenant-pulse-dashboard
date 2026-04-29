import { Link } from "@tanstack/react-router";
import type { ReactNode, MouseEvent } from "react";

/**
 * Single source of truth for navigating to a club's profile.
 * Opens the drawer on /clubs by setting the ?tenant search param.
 */
export function ClubLink({
  name,
  children,
  className = "font-medium hover:underline text-left",
  onClick,
}: {
  name: string;
  children?: ReactNode;
  className?: string;
  onClick?: (e: MouseEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <Link
      to="/clubs"
      search={{ tenant: name }}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(e);
      }}
      className={className}
    >
      {children ?? name}
    </Link>
  );
}
