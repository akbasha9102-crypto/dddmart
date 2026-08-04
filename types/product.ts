import type { Database } from "./database.types";

export type Product = Database["public"]["Tables"]["products"]["Row"];
export type ProductInsert = Database["public"]["Tables"]["products"]["Insert"];
export type ProductUpdate = Database["public"]["Tables"]["products"]["Update"];

export type Category = Database["public"]["Tables"]["categories"]["Row"];

export interface ProductWithCategory extends Product {
  category: Category | null;
}

export function isLowStock(product: Pick<Product, "quantity" | "min_stock_threshold">): boolean {
  return product.quantity <= product.min_stock_threshold;
}
