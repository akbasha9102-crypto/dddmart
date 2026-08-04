import type { Database } from "./database.types";
import type { Product } from "./product";

export type Sale = Database["public"]["Tables"]["sales"]["Row"];
export type SaleInsert = Database["public"]["Tables"]["sales"]["Insert"];
export type SaleItem = Database["public"]["Tables"]["sale_items"]["Row"];
export type SaleItemInsert = Database["public"]["Tables"]["sale_items"]["Insert"];

/** A line in the active POS cart, before it becomes a persisted sale_item. */
export interface CartItem {
  productId: string;
  name: string;
  barcode: string;
  unitPrice: number;
  quantity: number;
  /** Stock remaining on hand immediately after this item was reserved (post-decrement), for display only — not used for any further stock arithmetic. */
  availableStock: number;
}

export interface CartTotals {
  subtotal: number;
  discountAmount: number;
  totalAmount: number;
}

export interface CheckoutPayload {
  items: CartItem[];
  discountAmount: number;
  paidAmount: number;
  cashierId: string | null;
}

export interface CompletedSale {
  sale: Sale;
  items: SaleItem[];
  changeAmount: number;
}

export function findCartItemByBarcode(items: CartItem[], barcode: string): CartItem | undefined {
  return items.find((item) => item.barcode === barcode);
}

export function productToCartItem(product: Product, quantity = 1): CartItem {
  return {
    productId: product.id,
    name: product.name,
    barcode: product.barcode,
    unitPrice: product.sale_price,
    quantity,
    availableStock: product.quantity,
  };
}

export function calculateTotals(items: CartItem[], discountAmount = 0): CartTotals {
  const subtotal = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const totalAmount = Math.max(subtotal - discountAmount, 0);
  return { subtotal, discountAmount, totalAmount };
}
