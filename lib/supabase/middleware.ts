import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/database.types";

const PUBLIC_PATHS = ["/login", "/subscription-paused"];

/**
 * Refreshes the Supabase auth session on every request and redirects
 * unauthenticated users away from protected routes (POS, dashboard).
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublicPath = PUBLIC_PATHS.some((path) => request.nextUrl.pathname.startsWith(path));

  if (!user && !isPublicPath) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    return NextResponse.redirect(loginUrl);
  }

  if (user && !isPublicPath) {
    // Fail OPEN: only a definite is_active === false blocks anything. A
    // network/DB hiccup here must never block a real, paying, active
    // store's sales — so any error/missing-data case falls through
    // untouched below.
    //
    // This lookup must use the service-role client, not the caller's
    // RLS-scoped session: after the A2 migration, current_store_id() (and
    // therefore every RLS policy keyed on it, including profiles' own
    // select policy) returns nothing once a store is suspended — so the
    // very row middleware needs to read to detect "suspended" is exactly
    // the row RLS would hide from the caller. Only a privileged read can
    // positively distinguish "confirmed suspended" from "lookup failed".
    const storeActive = await getStoreActiveStatus(user.id);

    if (storeActive === false) {
      const isApiRequest = request.nextUrl.pathname.startsWith("/api/");

      if (isApiRequest) {
        return NextResponse.json({ error: "الاشتراك متوقف لهذا المتجر" }, { status: 403 });
      }

      const pausedUrl = request.nextUrl.clone();
      pausedUrl.pathname = "/subscription-paused";
      return NextResponse.redirect(pausedUrl);
    }
  }

  return response;
}

/**
 * Returns the caller's store's `is_active` flag, or `null` if it could not
 * be determined (missing env, network/DB error, no matching row) — callers
 * must treat `null` as "unknown" and fail open, never as `false`.
 *
 * Uses the service-role key deliberately: after the A2 migration, RLS
 * itself hides a suspended store's rows from the caller's own session, so
 * a privileged read is the only way to positively confirm suspension here.
 */
async function getStoreActiveStatus(userId: string): Promise<boolean | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    return null;
  }

  try {
    const admin = createSupabaseClient<Database>(url, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data, error } = await admin.from("profiles").select("stores(is_active)").eq("id", userId).single();

    if (error || !data?.stores) {
      return null;
    }

    return data.stores.is_active;
  } catch {
    return null;
  }
}
