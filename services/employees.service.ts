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
