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

/**
 * Applies a base-unit stock delta to the cached product list and persists
 * it, mirroring what decrementStock/incrementStock do server-side via the
 * adjust_product_stock RPC — used while offline so the cart's view of stock
 * stays consistent across multiple offline add/remove operations. Returns
 * the updated product, or null if it isn't in the cache or the delta would
 * push quantity below zero.
 */
export async function applyLocalStockDelta(productId: string, baseUnitsDelta: number): Promise<ProductWithCategory | null> {
  const products = await getCachedProducts();
  let updated: ProductWithCategory | null = null;

  const next = products.map((product) => {
    if (product.id !== productId) return product;
    const newQuantity = product.quantity + baseUnitsDelta;
    if (newQuantity < 0) return product;
    updated = { ...product, quantity: newQuantity };
    return updated;
  });

  if (!updated) return null;

  await setCachedProducts(next);
  return updated;
}
