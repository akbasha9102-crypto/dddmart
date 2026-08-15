import type { Database } from "./database.types";
import type { Product } from "./product";

export type Supplier = Database["public"]["Tables"]["suppliers"]["Row"];
export type SupplierInsert = Database["public"]["Tables"]["suppliers"]["Insert"];
export type SupplierUpdate = Database["public"]["Tables"]["suppliers"]["Update"];

export type SupplierTransaction = Database["public"]["Tables"]["supplier_transactions"]["Row"];
export type SupplierTransactionInsert = Database["public"]["Tables"]["supplier_transactions"]["Insert"];

export type SupplierProduct = Database["public"]["Tables"]["supplier_products"]["Row"];
export type SupplierProductInsert = Database["public"]["Tables"]["supplier_products"]["Insert"];

export type SupplierBalance = Database["public"]["Views"]["supplier_balances"]["Row"];

export interface SupplierWithBalance extends Supplier {
  balance: number;
}

export interface SupplierProductWithDetails extends SupplierProduct {
  product: Product;
}
