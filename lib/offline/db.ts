import { get, set } from "idb-keyval";
import type { Category, ProductUnit, ProductWithCategory } from "@/types/product";
import type { PendingSale } from "@/types/offline";

/**
 * Thin IndexedDB wrapper (via idb-keyval) for everything offline mode needs
 * to persist client-side: the last-known product/category catalog (read
 * path while offline) and the sale outbox (write path while offline).
 *
 * Every function guards on `typeof window === "undefined"` and returns
 * immediately — Next.js App Router evaluates module top-level code and can
 * type-check/execute these during the server build even though they're only
 * ever called from client components/hooks at runtime.
 */

const PRODUCTS_KEY = "products-cache";
const CATEGORIES_KEY = "categories-cache";
const UNITS_KEY = "product-units-cache";
const OUTBOX_KEY = "sales-outbox";

export async function getCachedProducts(): Promise<ProductWithCategory[]> {
  if (typeof window === "undefined") return [];
  const value = await get<ProductWithCategory[]>(PRODUCTS_KEY);
  return value ?? [];
}

export async function setCachedProducts(products: ProductWithCategory[]): Promise<void> {
  if (typeof window === "undefined") return;
  await set(PRODUCTS_KEY, products);
}

export async function getCachedCategories(): Promise<Category[]> {
  if (typeof window === "undefined") return [];
  const value = await get<Category[]>(CATEGORIES_KEY);
  return value ?? [];
}

export async function setCachedCategories(categories: Category[]): Promise<void> {
  if (typeof window === "undefined") return;
  await set(CATEGORIES_KEY, categories);
}

export async function getCachedUnits(): Promise<ProductUnit[]> {
  if (typeof window === "undefined") return [];
  const value = await get<ProductUnit[]>(UNITS_KEY);
  return value ?? [];
}

export async function setCachedUnits(units: ProductUnit[]): Promise<void> {
  if (typeof window === "undefined") return;
  await set(UNITS_KEY, units);
}

export async function getOutbox(): Promise<PendingSale[]> {
  if (typeof window === "undefined") return [];
  const value = await get<PendingSale[]>(OUTBOX_KEY);
  return value ?? [];
}

export async function setOutbox(sales: PendingSale[]): Promise<void> {
  if (typeof window === "undefined") return;
  await set(OUTBOX_KEY, sales);
}
