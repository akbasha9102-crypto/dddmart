import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { Category, ProductUnit, ProductWithCategory } from "@/types/product";
import { listAllProductUnits, listProductsWithCategory } from "@/services/products.service";
import { listCategories } from "@/services/categories.service";
import {
  getCachedCategories,
  getCachedProducts,
  getCachedUnits,
  setCachedCategories,
  setCachedProducts,
  setCachedUnits,
} from "@/lib/offline/db";

type Client = SupabaseClient<Database>;

/**
 * Refreshes the local catalog cache (products, categories, product units)
 * from Supabase. Called whenever the app is online so the cache stays warm
 * for the next offline period — see BarcodeScanner's write-through effect.
 */
export async function refreshProductCache(supabase: Client): Promise<void> {
  const [products, categories, units] = await Promise.all([
    listProductsWithCategory(supabase),
    listCategories(supabase),
    listAllProductUnits(supabase),
  ]);
  await Promise.all([setCachedProducts(products), setCachedCategories(categories), setCachedUnits(units)]);
}

export async function getCachedCatalog(): Promise<{ products: ProductWithCategory[]; categories: Category[] }> {
  const [products, categories] = await Promise.all([getCachedProducts(), getCachedCategories()]);
  return { products, categories };
}

export async function getCachedUnitsList(): Promise<ProductUnit[]> {
  return getCachedUnits();
}

/**
 * Mirrors resolveBarcode from services/products.service.ts, but operates on
 * in-memory cached arrays instead of Supabase. Kept pure (arrays in, result
 * out) so it's unit-testable without touching IndexedDB/Supabase, matching
 * resolveBarcode's own test style. Callers read the persisted units via
 * getCachedUnitsList() first (see BarcodeScanner/usePOS wiring).
 */
export function resolveBarcodeOffline(
  barcode: string,
  catalog: ProductWithCategory[],
  units: ProductUnit[],
): { kind: "base"; product: ProductWithCategory } | { kind: "unit"; product: ProductWithCategory; unit: ProductUnit } | null {
  const product = catalog.find((item) => item.barcode === barcode && item.is_active);
  if (product) return { kind: "base", product };

  const unit = units.find((item) => item.barcode === barcode && item.is_active);
  if (!unit) return null;

  const unitProduct = catalog.find((item) => item.id === unit.product_id && item.is_active);
  if (!unitProduct) return null;

  return { kind: "unit", product: unitProduct, unit };
}
