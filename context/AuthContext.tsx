"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import type { UserRole } from "@/types/database.types";

interface AuthContextValue {
  user: User | null;
  role: UserRole | null;
  storeId: string | null;
  storeActive: boolean;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  role: null,
  storeId: null,
  storeActive: true,
  isLoading: true,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<UserRole | null>(null);
  const [storeId, setStoreId] = useState<string | null>(null);
  // Defaults to true (not blocked) so a transient fetch failure never
  // client-side-blocks an active store — mirrors the middleware's
  // fail-open rule; only a confirmed `false` from the DB flips this.
  //
  // Note: this is UX polish, not the enforcement boundary (see
  // lib/supabase/middleware.ts for that). It uses the caller's own
  // RLS-scoped session (anon key only — never a service-role key in the
  // browser), so it reliably catches a store that *was already* suspended
  // when a fresh session loads only if RLS still lets the row through at
  // that moment; a store suspended mid-session may not flip this state
  // until the next server round-trip (any navigation or /api/* call),
  // which middleware always catches definitively regardless.
  const [storeActive, setStoreActive] = useState(true);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();

    supabase.auth.getUser().then(async ({ data }) => {
      setUser(data.user);
      if (data.user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("role, store_id, stores(is_active)")
          .eq("id", data.user.id)
          .single();
        setRole(profile?.role ?? null);
        setStoreId(profile?.store_id ?? null);
        setStoreActive(profile?.stores?.is_active ?? true);
      } else {
        setRole(null);
        setStoreId(null);
        setStoreActive(true);
      }
      setIsLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        supabase
          .from("profiles")
          .select("role, store_id, stores(is_active)")
          .eq("id", session.user.id)
          .single()
          .then(({ data: profile }) => {
            setRole(profile?.role ?? null);
            setStoreId(profile?.store_id ?? null);
            setStoreActive(profile?.stores?.is_active ?? true);
          });
      } else {
        setRole(null);
        setStoreId(null);
        setStoreActive(true);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{ user, role, storeId, storeActive, isLoading }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
