import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { getMe, type MeResponse } from "@/server/auth.functions";

export type Role = "superuser" | "cs" | "pending";

export interface UserProfile {
  id: string;
  email: string;
  display_name: string | null;
  role: Role;
  created_at: string;
  approved_at: string | null;
}

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  profile: UserProfile | null;
  loading: boolean;
  profileError: string | null;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchMeWithRetry(attempts = 4): Promise<{ data: MeResponse | null; error: string | null }> {
  let lastErr: string | null = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const data = await getMe();
      return { data, error: null };
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      console.warn(`[auth] getMe attempt ${i + 1} failed:`, lastErr);
      // backoff: 250, 500, 1000ms
      await new Promise((r) => setTimeout(r, 250 * Math.pow(2, i)));
    }
  }
  return { data: null, error: lastErr };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);
  const lastLoadedUid = useRef<string | null>(null);

  const loadProfile = async () => {
    const { data, error } = await fetchMeWithRetry();
    if (error || !data) {
      setProfileError(error ?? "Erro desconhecido");
      return;
    }
    setProfileError(null);
    setProfile(data);
  };

  const triggerProfileLoad = (uid: string, force = false) => {
    if (!force && lastLoadedUid.current === uid) return;
    lastLoadedUid.current = uid;
    setTimeout(() => { void loadProfile(); }, 0);
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);
      if (newSession?.user) {
        triggerProfileLoad(newSession.user.id);
      } else {
        lastLoadedUid.current = null;
        setProfile(null);
        setProfileError(null);
      }
    });

    void supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) triggerProfileLoad(s.user.id);
      setLoading(false);
    }).catch((e) => {
      console.error("getSession error", e);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    lastLoadedUid.current = null;
    setProfile(null);
    setProfileError(null);
  };

  const refreshProfile = async () => {
    lastLoadedUid.current = null;
    await loadProfile();
    if (user) lastLoadedUid.current = user.id;
  };

  return (
    <AuthContext.Provider value={{ user, session, profile, loading, profileError, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
