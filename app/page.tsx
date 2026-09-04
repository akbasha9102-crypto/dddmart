import { redirect } from "next/navigation";

/**
 * `/` is not in middleware's PUBLIC_PATHS, so middleware already redirects
 * any unauthenticated request away to `/login` before this component ever
 * runs — an authenticated user reaching here just needs to land on `/pos`.
 * See lib/supabase/middleware.ts.
 */
export default function HomePage() {
  redirect("/pos");
}
