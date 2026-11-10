import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session, User } from "@supabase/supabase-js";
import { logAudit, flushAuditLogs } from "@/lib/auditLogger";
import { clearCachedRoles } from "@/lib/roleCache";

interface AuthContextType {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  const lastUserRef = useRef<User | null>(null);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      setLoading(false);
      if (event === "SIGNED_IN" && session?.user && lastUserRef.current?.id !== session.user.id) {
        logAudit({
          action: "login",
          entity_type: "auth",
          entity_id: session.user.id,
          user_id: session.user.id,
          user_email: session.user.email || "",
          details: { method: "password" },
        });
      }
      if (event === "SIGNED_OUT" && lastUserRef.current) {
        logAudit({
          action: "logout",
          entity_type: "auth",
          entity_id: lastUserRef.current.id,
          user_id: lastUserRef.current.id,
          user_email: lastUserRef.current.email || "",
        });
      }
      lastUserRef.current = session?.user ?? null;
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      lastUserRef.current = session?.user ?? null;
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      logAudit({
        action: "login_failed",
        entity_type: "auth",
        entity_id: email,
        user_email: email,
        user_id: "00000000-0000-0000-0000-000000000000",
        details: { reason: error.message },
      });
      throw error;
    }
  };

  const signOut = async () => {
    try { await flushAuditLogs(); } catch {/* ignore */}
    clearCachedRoles();
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  };

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
