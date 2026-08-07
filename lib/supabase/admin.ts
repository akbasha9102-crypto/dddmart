/**
 * Server-only. Never import from a "use client" file or any code that runs
 * in the browser.
 *
 * Supabase client authenticated with the service-role key — bypasses RLS
 * entirely and can call the Auth Admin API (create/ban users). Only for use
 * inside Route Handlers under app/api/, after the caller's admin role has
 * already been verified via lib/supabase/server.ts + profiles.role.
 */
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

export function createAdminClient() {
  if (typeof window !== "undefined") {
    throw new Error("lib/supabase/admin.ts لا يجوز استدعاؤه من المتصفح");
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY غير موجود بمتغيرات البيئة");
  }

  return createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
