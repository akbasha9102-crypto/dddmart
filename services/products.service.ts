import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, PaymentMethod } from "@/types/database.types";
import { isLowStock } from "@/types/product";
import type { Product, ProductInsert, ProductUpdate, ProductUnit, ProductUnitInsert, ProductUnitUpdate, ProductWithCategory } from "@/types/product";
import { logOperation } from "@/services/archive.service";
import { toBaseUnitCost, toBaseUnits } from "@/lib/units";

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

export async function getProduct(supabase: Client, id: string): Promise<Product | null> {
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("id", id)
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

export async function createProductUnit(
  supabase: Client,
  unit: Omit<ProductUnitInsert, "store_id">,
  storeId: string,
): Promise<ProductUnit> {
  const { data, error } = await supabase
    .from("product_units")
    .insert({ ...unit, store_id: storeId })
    .select()
    .single();
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

export async function createProduct(
  supabase: Client,
  product: Omit<ProductInsert, "store_id">,
  actorId: string | null,
  storeId: string,
): Promise<Product> {
  const { data, error } = await supabase
    .from("products")
    .insert({ ...product, store_id: storeId })
    .select()
    .single();

  if (error) throw error;

  await logOperation(supabase, {
    userId: actorId,
    actionType: "product_created",
    entityType: "product",
    entityId: data.id,
    description: `تم إضافة المنتج "${data.name}"`,
    storeId,
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
  storeId: string,
): Promise<Product> {
  const { data, error } = await supabase.from("products").update(patch).eq("id", id).select().single();

  if (error) throw error;

  await logOperation(supabase, {
    userId: actorId,
    actionType: "product_updated",
    entityType: "product",
    entityId: data.id,
    description: `تم تعديل المنتج "${data.name}"`,
    storeId,
  });

  return data;
}

/** Soft delete: sets is_active = false so the product disappears from active listings while preserving history/FKs. */
export async function deleteProduct(supabase: Client, id: string, actorId: string | null, storeId: string): Promise<void> {
  const { data, error } = await supabase.from("products").update({ is_active: false }).eq("id", id).select().single();

  if (error) throw error;

  await logOperation(supabase, {
    userId: actorId,
    actionType: "product_deleted",
    entityType: "product",
    entityId: data.id,
    description: `تم حذف المنتج "${data.name}"`,
    storeId,
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

/**
 * Atomically records a stock purchase: increments products.quantity by
 * addedBaseUnits and recomputes products.cost_price as the weighted
 * average of existing stock cost and the newly purchased stock's cost, in
 * a single DB statement (receive_product_stock RPC) so it can't race with
 * a concurrent sale/scan decrementing the same product's quantity.
 * Returns null if addedBaseUnits/unitBaseCost fail their guards or the
 * product no longer exists — callers must treat null as failure, not throw.
 */
export async function receiveStock(
  supabase: Client,
  productId: string,
  addedBaseUnits: number,
  unitBaseCost: number,
): Promise<Product | null> {
  const { data, error } = await supabase.rpc("receive_product_stock", {
    p_product_id: productId,
    p_added_base_units: addedBaseUnits,
    p_unit_base_cost: unitBaseCost,
  });
  if (error) throw error;
  return data?.[0] ?? null;
}

export interface RecordStockPurchaseParams {
  productId: string;
  productName: string;
  purchasedQuantity: number;
  unitName: string | null; // null = base unit (products.unit)
  conversionFactor: number; // 1 for base unit
  costPerPurchasedUnit: number;
  supplierId?: string | null;
  supplierName?: string | null;
  invoiceNumber?: string | null;
  paymentMethod?: PaymentMethod | null;
}

/**
 * Records a purchase of stock-by-pack: converts the purchased quantity and
 * per-unit cost into base-unit terms, calls receiveStock, always inserts a
 * stock_purchases row (the permanent receipt record), and — only when a
 * supplier is attached — posts directly to supplier_transactions (a
 * 'purchase' row, plus an immediate matching 'payment' row when paid
 * cash). These supplier_transactions inserts are NOT routed through
 * recordSupplierPurchase/recordSupplierPayment and are not separately
 * audit-logged — same reasoning as a POS credit sale posting directly to
 * customer_transactions. Finally logs one stock_received audit entry,
 * mentioning the supplier/invoice when present. This is the function the
 * UI calls. Throws if the product wasn't found, the RPC's guards rejected
 * the input, or a supplier was given without a payment method.
 */
export async function recordStockPurchase(
  supabase: Client,
  params: RecordStockPurchaseParams,
  actorId: string | null,
  storeId: string,
): Promise<Product> {
  if (params.supplierId && !params.paymentMethod) {
    throw new Error("يجب تحديد طريقة الدفع عند اختيار مورد");
  }

  const addedBaseUnits = toBaseUnits(params.purchasedQuantity, params.conversionFactor);
  const unitBaseCost = toBaseUnitCost(params.costPerPurchasedUnit, params.conversionFactor);
  const totalCost = Math.round(addedBaseUnits * unitBaseCost * 100) / 100;

  const updated = await receiveStock(supabase, params.productId, addedBaseUnits, unitBaseCost);
  if (!updated) throw new Error("تعذر استلام المخزون — تحقق من القيم المدخلة");

  const { data: purchase, error: purchaseError } = await supabase
    .from("stock_purchases")
    .insert({
      product_id: params.productId,
      product_name: params.productName,
      quantity: addedBaseUnits,
      cost_price: unitBaseCost,
      total_cost: totalCost,
      supplier_id: params.supplierId ?? null,
      invoice_number: params.invoiceNumber ?? null,
      payment_method: params.supplierId ? (params.paymentMethod ?? null) : null,
      actor_id: actorId,
      store_id: storeId,
    })
    .select()
    .single();
  if (purchaseError) throw purchaseError;

  if (params.supplierId) {
    const transactionNote = params.invoiceNumber
      ? `فاتورة رقم ${params.invoiceNumber} — ${params.purchasedQuantity} ${params.unitName ?? updated.unit} من "${params.productName}"`
      : `شراء ${params.purchasedQuantity} ${params.unitName ?? updated.unit} من "${params.productName}"`;

    const { error: purchaseTxnError } = await supabase.from("supplier_transactions").insert({
      supplier_id: params.supplierId,
      type: "purchase",
      amount: totalCost,
      note: transactionNote,
      stock_purchase_id: purchase.id,
      store_id: storeId,
    });
    if (purchaseTxnError) throw purchaseTxnError;

    if (params.paymentMethod === "cash") {
      const { error: paymentTxnError } = await supabase.from("supplier_transactions").insert({
        supplier_id: params.supplierId,
        type: "payment",
        amount: totalCost,
        note: transactionNote,
        stock_purchase_id: purchase.id,
        store_id: storeId,
      });
      if (paymentTxnError) throw paymentTxnError;
    }
  }

  const supplierNote = params.supplierId
    ? ` — مورد: ${params.supplierName ?? ""}${params.invoiceNumber ? `، فاتورة رقم ${params.invoiceNumber}` : ""}`
    : "";

  await logOperation(supabase, {
    userId: actorId,
    actionType: "stock_received",
    entityType: "stock",
    entityId: updated.id,
    description: `تم استلام ${params.purchasedQuantity} ${params.unitName ?? "قطعة"} (${addedBaseUnits} ${updated.unit}) من "${params.productName}" — سعر التكلفة الجديد ${updated.cost_price}${supplierNote}`,
    storeId,
  });

  return updated;
}
