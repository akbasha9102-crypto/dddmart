import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { isLowStock } from "@/types/product";
import type { Product, ProductInsert, ProductUpdate, ProductWithCategory } from "@/types/product";

type Client = SupabaseClient<Database>;

/** Used by the POS barcode scanner — must stay fast (indexed, single row). */
export async function getProductByBarcode(supabase: Client, barcode: string): Promise<Product | null> {
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("barcode", barcode)
    .eq("is_active", true)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function searchProducts(supabase: Client, query: string): Promise<Product[]> {
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("is_active", true)
    .ilike("name", `%${query}%`)
    .order("name")
    .limit(25);

  if (error) throw error;
  return data ?? [];
}

export async function listProducts(supabase: Client): Promise<Product[]> {
  const { data, error } = await supabase.from("products").select("*").order("name");

  if (error) throw error;
  return data ?? [];
}

/** Used to group products by category for the mobile inventory view. */
export async function listProductsWithCategory(supabase: Client): Promise<ProductWithCategory[]> {
  const { data, error } = await supabase
    .from("products")
    .select("*, category:categories(*)")
    .eq("is_active", true)
    .order("name");

  if (error) throw error;
  return data ?? [];
}

/**
 * PostgREST filters can't compare two columns directly, so we fetch active
 * products and apply the low-stock rule client-side.
 */
export async function getLowStockProducts(supabase: Client): Promise<Product[]> {
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("is_active", true)
    .order("quantity");

  if (error) throw error;
  return (data ?? []).filter(isLowStock);
}

export async function createProduct(supabase: Client, product: ProductInsert): Promise<Product> {
  const { data, error } = await supabase.from("products").insert(product).select().single();

  if (error) throw error;
  return data;
}

export async function updateProduct(supabase: Client, id: string, patch: ProductUpdate): Promise<Product> {
  const { data, error } = await supabase.from("products").update(patch).eq("id", id).select().single();

  if (error) throw error;
  return data;
}
