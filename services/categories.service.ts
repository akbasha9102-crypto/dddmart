import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { Category, CategoryUpdate } from "@/types/product";
import { logOperation } from "@/services/archive.service";

type Client = SupabaseClient<Database>;

const NEW_CATEGORY_SORT_ORDER = 500;

export async function listCategories(supabase: Client, options?: { includeInactive?: boolean }): Promise<Category[]> {
  let query = supabase.from("categories").select("*").order("sort_order");
  if (!options?.includeInactive) {
    query = query.eq("is_active", true);
  }

  const { data, error } = await query;

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
 * surfacing an error to the UI. The idempotent-duplicate path intentionally
 * skips logOperation so re-submitting an existing name doesn't double-log.
 */
export async function createCategory(
  supabase: Client,
  input: { name: string; color?: string; icon?: string },
  actorId: string | null,
): Promise<Category> {
  const trimmedName = input.name.trim();

  const { data, error } = await supabase
    .from("categories")
    .insert({
      name: trimmedName,
      sort_order: NEW_CATEGORY_SORT_ORDER,
      color: input.color,
      icon: input.icon,
    })
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

  await logOperation(supabase, {
    userId: actorId,
    actionType: "category_created",
    entityType: "category",
    entityId: data.id,
    description: `تم إضافة القسم "${data.name}"`,
  });

  return data;
}

export async function updateCategory(
  supabase: Client,
  id: string,
  patch: CategoryUpdate,
  actorId: string | null,
): Promise<Category> {
  const { data, error } = await supabase.from("categories").update(patch).eq("id", id).select().single();

  if (error) throw error;

  await logOperation(supabase, {
    userId: actorId,
    actionType: "category_updated",
    entityType: "category",
    entityId: data.id,
    description: `تم تعديل القسم "${data.name}"`,
  });

  return data;
}

/** Soft delete: sets is_active = false so the category disappears from active listings while preserving history/FKs. */
export async function deleteCategory(supabase: Client, id: string, actorId: string | null): Promise<void> {
  const { data, error } = await supabase
    .from("categories")
    .update({ is_active: false })
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;

  await logOperation(supabase, {
    userId: actorId,
    actionType: "category_deleted",
    entityType: "category",
    entityId: data.id,
    description: `تم حذف القسم "${data.name}"`,
  });
}
