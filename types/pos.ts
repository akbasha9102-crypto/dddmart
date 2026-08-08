import type { Database, PaymentMethod } from "./database.types";
import type { Product, ProductUnit } from "./product";

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
  /** Cost price snapshotted at add-to-cart time — permanent once the sale is recorded, unaffected by later changes to the product's cost_price. */
  costPrice: number;
  quantity: number;
  /** Stock remaining on hand immediately after this item was reserved (post-decrement), for display only — not used for any further stock arithmetic. */
  availableStock: number;
  /** Name of the non-base unit sold (e.g. "كارتون"). Undefined means the product's base unit. */
  unitName?: string;
  /** How many base units this line's unit equals. Undefined/1 both mean the base unit. */
  unitConversionFactor?: number;
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
  /** Set when replaying a previously-queued offline sale so it syncs under the id its receipt already showed. Omitted (and left to the DB default) for a normal online checkout. */
  id?: string;
  /** Set when replaying a previously-queued offline sale so it keeps the invoice number its receipt already showed. Omitted (and auto-generated) for a normal online checkout. */
  invoiceNumber?: string;
  /** Defaults to "cash" when omitted, so every existing caller keeps working unchanged. */
  paymentMethod?: PaymentMethod;
  /** Required (by createSale) when paymentMethod is "credit". */
  customerId?: string | null;
}

export interface CompletedSale {
  sale: Sale;
  items: SaleItem[];
  changeAmount: number;
  /** Set only for credit sales, for receipt printing — createSale only has customerId in scope, so this is populated by the caller (hooks/usePOS.ts). */
  customerName?: string;
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
    costPrice: product.cost_price,
    quantity,
    availableStock: product.quantity,
  };
}

export function productUnitToCartItem(product: Product, unit: ProductUnit, quantity = 1): CartItem {
  return {
    productId: product.id,
    name: product.name,
    barcode: unit.barcode,
    unitPrice: unit.sale_price,
    costPrice: product.cost_price * unit.conversion_factor,
    quantity,
    availableStock: product.quantity,
    unitName: unit.unit_name,
    unitConversionFactor: unit.conversion_factor,
  };
}

export function calculateTotals(items: CartItem[], discountAmount = 0): CartTotals {
  const subtotal = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const totalAmount = Math.max(subtotal - discountAmount, 0);
  return { subtotal, discountAmount, totalAmount };
}
