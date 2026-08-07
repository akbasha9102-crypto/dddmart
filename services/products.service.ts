import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { isLowStock } from "@/types/product";
import type { Product, ProductInsert, ProductUpdate, ProductUnit, ProductUnitInsert, ProductUnitUpdate, ProductWithCategory } from "@/types/product";
import { logOperation } from "@/services/archive.service";

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

/**
 * Resolves a scanned/typed barcode to either a product sold at its base
 * unit, or a product sold via one of its extra units (product_units).
 * Tries the existing fast products.barcode lookup first — unchanged for
 * every product that has no extra units — and only falls back to
 * product_units on a miss.
 */
export async function resolveBarcode(
  supabase: Client,
  barcode: string,
): Promise<{ kind: "base"; product: Product } | { kind: "unit"; product: Product; unit: ProductUnit } | null> {
  const product = await getProductByBarcode(supabase, barcode);
  if (product) return { kind: "base", product };

  const { data, error } = await supabase
    .from("product_units")
    .select("*, products!inner(*)")
    .eq("barcode", barcode)
    .eq("is_active", true)
    .eq("products.is_active", true)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const { products: productRow, ...unit } = data as ProductUnit & { products: Product };
  return { kind: "unit", product: productRow, unit };
}

/**
 * All active product_units across all products, used by
 * lib/offline/productCache.ts to replicate the "kind: unit" (carton/multi-unit
 * barcode) branch of resolveBarcode while offline.
 */
export async function listAllProductUnits(supabase: Client): Promise<ProductUnit[]> {
  const { data, error } = await supabase.from("product_units").select("*").eq("is_active", true);

  if (error) throw error;
  return data ?? [];
}

export async function listProductUnits(supabase: Client, productId: string): Promise<ProductUnit[]> {
  const { data, error } = await supabase
    .from("product_units")
    .select("*")
    .eq("product_id", productId)
    .eq("is_active", true)
    .order("sort_order");

  if (error) throw error;
  return data ?? [];
}

export async function createProductUnit(supabase: Client, unit: ProductUnitInsert): Promise<ProductUnit> {
  const { data, error } = await supabase.from("product_units").insert(unit).select().single();
  if (error) throw error;
  return data;
}

export async function updateProductUnit(supabase: Client, id: string, patch: ProductUnitUpdate): Promise<ProductUnit> {
  const { data, error } = await supabase.from("product_units").update(patch).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

/** Soft delete, matching deleteProduct's convention: keeps historical sale_items snapshots intact. */
export async function deleteProductUnit(supabase: Client, id: string): Promise<void> {
  const { error } = await supabase.from("product_units").update({ is_active: false }).eq("id", id);
  if (error) throw error;
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
  const { data, error } = await supabase.from("products").select("*").eq("is_active", true).order("name");

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

export async function createProduct(supabase: Client, product: ProductInsert, actorId: string | null): Promise<Product> {
  const { data, error } = await supabase.from("products").insert(product).select().single();

  if (error) throw error;

  await logOperation(supabase, {
    userId: actorId,
    actionType: "product_created",
    entityType: "product",
    entityId: data.id,
    description: `تم إضافة المنتج "${data.name}"`,
  });

  return data;
}

export function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "23505";
}

export async function updateProduct(
  supabase: Client,
  id: string,
  patch: ProductUpdate,
  actorId: string | null,
): Promise<Product> {
  const { data, error } = await supabase.from("products").update(patch).eq("id", id).select().single();

  if (error) throw error;

  await logOperation(supabase, {
    userId: actorId,
    actionType: "product_updated",
    entityType: "product",
    entityId: data.id,
    description: `تم تعديل المنتج "${data.name}"`,
  });

  return data;
}

/** Soft delete: sets is_active = false so the product disappears from active listings while preserving history/FKs. */
export async function deleteProduct(supabase: Client, id: string, actorId: string | null): Promise<void> {
  const { data, error } = await supabase.from("products").update({ is_active: false }).eq("id", id).select().single();

  if (error) throw error;

  await logOperation(supabase, {
    userId: actorId,
    actionType: "product_deleted",
    entityType: "product",
    entityId: data.id,
    description: `تم حذف المنتج "${data.name}"`,
  });
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
