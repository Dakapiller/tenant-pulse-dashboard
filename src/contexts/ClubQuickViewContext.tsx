import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ClubQuickView } from "@/components/ClubQuickView";

type OpenOptions = {
  onChanged?: () => void | Promise<void>;
};

interface ClubQuickViewContextValue {
  openClub: (name: string, opts?: OpenOptions) => void;
  close: () => void;
  currentTenant: string | null;
}

const ClubQuickViewContext = createContext<ClubQuickViewContextValue | null>(null);

export function useClubQuickView(): ClubQuickViewContextValue {
  const ctx = useContext(ClubQuickViewContext);
  if (!ctx) {
    // Safe fallback so components outside the provider don't crash.
    return {
      openClub: () => {},
      close: () => {},
      currentTenant: null,
    };
  }
  return ctx;
}

export function ClubQuickViewProvider({ children }: { children: ReactNode }) {
  const [tenant, setTenant] = useState<string | null>(null);
  const [onChanged, setOnChanged] = useState<(() => void | Promise<void>) | null>(null);

  const openClub = useCallback((name: string, opts?: OpenOptions) => {
    setTenant(name);
    // Wrap in a function to avoid React invoking the setter's callback form.
    setOnChanged(() => (opts?.onChanged ? opts.onChanged : null));
  }, []);

  const close = useCallback(() => {
    setTenant(null);
    setOnChanged(null);
  }, []);

  // Close on Escape
  useEffect(() => {
    if (!tenant) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [tenant, close]);

  // Lock body scroll while open
  useEffect(() => {
    if (!tenant) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [tenant]);

  const value = useMemo<ClubQuickViewContextValue>(
    () => ({ openClub, close, currentTenant: tenant }),
    [openClub, close, tenant],
  );

  return (
    <ClubQuickViewContext.Provider value={value}>
      {children}
      {tenant && (
        <ClubQuickView
          tenant={tenant}
          onClose={close}
          onChanged={onChanged ?? undefined}
        />
      )}
    </ClubQuickViewContext.Provider>
  );
}
