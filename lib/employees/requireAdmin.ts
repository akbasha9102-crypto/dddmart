import { createClient } from "@/lib/supabase/server";
import { isAdminRole } from "@/lib/employees/adminCheck";

type RequireAdminResult = { ok: true; userId: string; storeId: string } | { ok: false; status: 401 | 403 };

/**
 * Server-side admin-role verification shared by both employee route
 * handlers. Reads the caller's session via the cookie-aware anon client
 * (lib/supabase/server.ts) and checks profiles.role — never trusts the
 * client. Returns a 401 if there's no session, 403 if the caller isn't an
 * admin, so a cashier calling these routes directly gets a real rejection
 * regardless of what the UI shows.
 *
 * Also resolves the caller's store_id: both /api/employees route handlers
 * use the admin (service-role) Supabase client, which bypasses RLS
 * entirely — so store isolation for those routes has to be enforced here,
 * explicitly, in application code, not left to the database.
 */
export async function requireAdmin(): Promise<RequireAdminResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, status: 401 };
  }

  const { data: profile } = await supabase.from("profiles").select("role, store_id").eq("id", user.id).single();

  if (!isAdminRole(profile?.role) || !profile?.store_id) {
    return { ok: false, status: 403 };
  }

  return { ok: true, userId: user.id, storeId: profile.store_id };
}
