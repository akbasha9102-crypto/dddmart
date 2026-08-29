import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, UserRole } from "@/types/database.types";

type Client = SupabaseClient<Database>;

export interface Employee {
  id: string;
  full_name: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
}

/** Lists all employee profiles (admin and cashier alike) for the /employees screen. RLS already permits any authenticated user to read all profiles rows, so this uses the normal anon-key client — no API route needed. */
export async function listEmployees(supabase: Client): Promise<Employee[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, role, is_active, created_at")
    .order("created_at");

  if (error) throw error;
  return data ?? [];
}

/** Fetches a single employee's profile for the /employees/[id] detail screen. Returns null if the id doesn't resolve to a profile row (e.g. bad/stale link) rather than throwing — this is an expected, handleable case at the call site. */
export async function getEmployee(supabase: Client, id: string): Promise<Employee | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, role, is_active, created_at")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data;
}
