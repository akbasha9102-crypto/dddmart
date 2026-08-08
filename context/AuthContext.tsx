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
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextValue>({ user: null, role: null, storeId: null, isLoading: true });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<UserRole | null>(null);
  const [storeId, setStoreId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();

    supabase.auth.getUser().then(async ({ data }) => {
      setUser(data.user);
      if (data.user) {
        const { data: profile } = await supabase.from("profiles").select("role, store_id").eq("id", data.user.id).single();
        setRole(profile?.role ?? null);
        setStoreId(profile?.store_id ?? null);
      } else {
        setRole(null);
        setStoreId(null);
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
          .select("role, store_id")
          .eq("id", session.user.id)
          .single()
          .then(({ data: profile }) => {
            setRole(profile?.role ?? null);
            setStoreId(profile?.store_id ?? null);
          });
      } else {
        setRole(null);
        setStoreId(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  return <AuthContext.Provider value={{ user, role, storeId, isLoading }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
