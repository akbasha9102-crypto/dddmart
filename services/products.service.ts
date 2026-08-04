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

export function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "23505";
}

export async function updateProduct(supabase: Client, id: string, patch: ProductUpdate): Promise<Product> {
  const { data, error } = await supabase.from("products").update(patch).eq("id", id).select().single();

  if (error) throw error;
  return data;
}

/**
 * Atomically decrements stock by `quantity`, guarded so it can never go
 * below zero. Returns the updated product, or null if there wasn't enough
 * stock at the instant this ran (lost a race to a concurrent sale/scan, or
 * stock changed since the cart snapshot was taken) — callers must treat
 * null as "insufficient stock now", not throw a generic error.
 */
export async function decrementStock(supabase: Client, productId: string, quantity: number): Promise<Product | null> {
  const { data, error } = await supabase.rpc("adjust_product_stock", {
    p_product_id: productId,
    p_delta: -quantity,
  });
  if (error) throw error;
  return data?.[0] ?? null;
}

/**
 * Atomically restores (increments) stock by `quantity` — the symmetric
 * inverse of decrementStock, used when a cart line is removed, its quantity
 * reduced, or the whole cart is cleared before checkout. Always succeeds
 * (increment can't fail the >= 0 guard) unless the product row itself was
 * deleted, in which case it resolves to null.
 */
export async function incrementStock(supabase: Client, productId: string, quantity: number): Promise<Product | null> {
  const { data, error } = await supabase.rpc("adjust_product_stock", {
    p_product_id: productId,
    p_delta: quantity,
  });
  if (error) throw error;
  return data?.[0] ?? null;
}
