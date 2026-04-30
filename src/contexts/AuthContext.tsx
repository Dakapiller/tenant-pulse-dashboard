import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type Role = "superuser" | "cs" | "pending";

export interface UserProfile {
  id: string;
  email: string;
  role: Role;
  created_at: string;
  approved_at: string | null;
  approved_by: string | null;
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

async function fetchProfileWithRetry(uid: string, attempts = 5): Promise<{ data: UserProfile | null; error: string | null }> {
  let lastErr: string | null = null;
  for (let i = 0; i < attempts; i++) {
    const { data, error } = await supabase
      .from("user_profiles")
      .select("*")
      .eq("id", uid)
      .maybeSingle();
    if (!error) return { data: (data as UserProfile | null) ?? null, error: null };
    lastErr = error.message ?? "Erro desconhecido";
    console.warn(`[auth] profile fetch attempt ${i + 1} failed:`, lastErr);
    // exponential backoff: 300ms, 600ms, 1200ms, 2400ms
    await new Promise((r) => setTimeout(r, 300 * Math.pow(2, i)));
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

  const loadProfile = async (uid: string) => {
    const { data, error } = await fetchProfileWithRetry(uid);
    if (error) {
      console.error("loadProfile error", error);
      setProfileError(error);
      // do NOT clear an existing profile — keep last good value
      return;
    }
    setProfileError(null);
    setProfile(data);
  };

  const triggerProfileLoad = (uid: string, force = false) => {
    if (!force && lastLoadedUid.current === uid) return;
    lastLoadedUid.current = uid;
    // fire-and-forget; never await inside auth callbacks
    setTimeout(() => { void loadProfile(uid); }, 0);
  };

  useEffect(() => {
    // Listener FIRST
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

    // THEN check existing session — never await DB queries here
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
    if (user) {
      lastLoadedUid.current = null;
      await loadProfile(user.id);
      lastLoadedUid.current = user.id;
    }
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
