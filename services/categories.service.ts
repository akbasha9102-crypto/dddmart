import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { Category } from "@/types/product";

type Client = SupabaseClient<Database>;

export async function listCategories(supabase: Client): Promise<Category[]> {
  const { data, error } = await supabase.from("categories").select("*").order("name");

  if (error) throw error;
  return data ?? [];
}

export async function createCategory(supabase: Client, name: string): Promise<Category> {
  const { data, error } = await supabase.from("categories").insert({ name }).select().single();

  if (error) throw error;
  return data;
}
