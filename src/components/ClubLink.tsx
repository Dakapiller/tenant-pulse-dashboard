import type { ReactNode, MouseEvent } from "react";
import { useClubQuickView } from "@/contexts/ClubQuickViewContext";

/**
 * Single source of truth for navigating to a club's profile.
 * Opens a global QuickView modal over the current page, so filters,
 * scroll and page state are preserved.
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
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
}) {
  const { openClub } = useClubQuickView();
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(e);
        if (!e.defaultPrevented) openClub(name);
      }}
      className={className}
    >
      {children ?? name}
    </button>
  );
}
