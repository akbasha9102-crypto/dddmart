import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { Category } from "@/types/product";

type Client = SupabaseClient<Database>;

const NEW_CATEGORY_SORT_ORDER = 500;

export async function listCategories(supabase: Client): Promise<Category[]> {
  const { data, error } = await supabase.from("categories").select("*").order("sort_order");

  if (error) throw error;
  return data ?? [];
}

/**
 * Creates a new category. Sort order is fixed at 500 — after the curated
 * defaults (10-180) but before "أخرى" (999) — no extra query round-trip
 * needed to compute it.
 *
 * Duplicate names (unique(name) constraint, migration 00000000000001) are
 * treated as idempotent: re-fetch and return the existing row instead of
 * surfacing an error to the UI.
 */
export async function createCategory(supabase: Client, name: string): Promise<Category> {
  const trimmedName = name.trim();

  const { data, error } = await supabase
    .from("categories")
    .insert({ name: trimmedName, sort_order: NEW_CATEGORY_SORT_ORDER })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      const { data: existing, error: fetchError } = await supabase
        .from("categories")
        .select("*")
        .eq("name", trimmedName)
        .single();
      if (fetchError) throw fetchError;
      return existing;
    }
    throw error;
  }

  return data;
}
