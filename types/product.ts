import type { Database } from "./database.types";

export type Product = Database["public"]["Tables"]["products"]["Row"];
export type ProductInsert = Database["public"]["Tables"]["products"]["Insert"];
export type ProductUpdate = Database["public"]["Tables"]["products"]["Update"];

export type Category = Database["public"]["Tables"]["categories"]["Row"];
export type CategoryInsert = Database["public"]["Tables"]["categories"]["Insert"];
export type CategoryUpdate = Database["public"]["Tables"]["categories"]["Update"];

export type ProductUnit = Database["public"]["Tables"]["product_units"]["Row"];
export type ProductUnitInsert = Database["public"]["Tables"]["product_units"]["Insert"];
export type ProductUnitUpdate = Database["public"]["Tables"]["product_units"]["Update"];

export type StockPurchase = Database["public"]["Tables"]["stock_purchases"]["Row"];
export type StockPurchaseInsert = Database["public"]["Tables"]["stock_purchases"]["Insert"];

export interface ProductWithCategory extends Product {
  category: Category | null;
}

export function isLowStock(product: Pick<Product, "quantity" | "min_stock_threshold">): boolean {
  return product.quantity <= product.min_stock_threshold;
}

export function isCategoryActive(category: Pick<Category, "is_active">): boolean {
  return category.is_active;
}
