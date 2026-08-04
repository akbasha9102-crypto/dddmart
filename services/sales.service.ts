import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { CheckoutPayload, CompletedSale, Sale, SaleItem, SaleItemInsert } from "@/types/pos";
import { calculateTotals } from "@/types/pos";
import { generateInvoiceNumber } from "@/lib/utils";
import { logOperation } from "@/services/archive.service";

type Client = SupabaseClient<Database>;

/**
 * Persists a completed cash sale: the invoice header and its line items.
 * Stock is no longer touched here — it's decremented atomically at
 * add-to-cart time instead (see services/products.service.ts#decrementStock
 * / hooks/usePOS.ts#addProductToCart). Not wrapped in a DB transaction (no
 * RPC layer yet) — acceptable for a single-till MVP, revisit before
 * multi-till rollout.
 */
export async function createSale(supabase: Client, payload: CheckoutPayload): Promise<CompletedSale> {
  if (payload.items.length === 0) {
    throw new Error("لا يمكن إتمام عملية بيع فارغة");
  }

  const { subtotal, discountAmount, totalAmount } = calculateTotals(payload.items, payload.discountAmount);
  const changeAmount = Math.max(payload.paidAmount - totalAmount, 0);

  const { data: sale, error: saleError } = await supabase
    .from("sales")
    .insert({
      invoice_number: generateInvoiceNumber(),
      cashier_id: payload.cashierId,
      subtotal,
      discount_amount: discountAmount,
      total_amount: totalAmount,
      paid_amount: payload.paidAmount,
      change_amount: changeAmount,
      payment_method: "cash",
    })
    .select()
    .single();

  if (saleError) throw saleError;

  const saleItems: SaleItemInsert[] = payload.items.map((item) => ({
    sale_id: sale.id,
    product_id: item.productId,
    product_name: item.name,
    barcode: item.barcode,
    quantity: item.quantity,
    unit_price: item.unitPrice,
    total_price: item.unitPrice * item.quantity,
  }));

  const { data: items, error: itemsError } = await supabase.from("sale_items").insert(saleItems).select();

  if (itemsError) throw itemsError;

  await logOperation(supabase, {
    userId: payload.cashierId,
    actionType: "sale_created",
    entityType: "sale",
    entityId: sale.id,
    description: `تم تسجيل عملية بيع بقيمة ${totalAmount} (فاتورة ${sale.invoice_number})`,
  });

  return { sale, items: items ?? [], changeAmount };
}

export async function getDailySales(supabase: Client, date: Date): Promise<Sale[]> {
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(date);
  dayEnd.setHours(23, 59, 59, 999);

  const { data, error } = await supabase
    .from("sales")
    .select("*")
    .gte("created_at", dayStart.toISOString())
    .lte("created_at", dayEnd.toISOString())
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function getSaleItems(supabase: Client, saleId: string): Promise<SaleItem[]> {
  const { data, error } = await supabase.from("sale_items").select("*").eq("sale_id", saleId);

  if (error) throw error;
  return data ?? [];
}

export interface DailySalesSummary {
  sales: Sale[];
  salesCount: number;
  totalRevenue: number;
  totalProfit: number;
}

/**
 * Profit is estimated from each product's *current* cost_price, since
 * sale_items doesn't snapshot cost at sale time — fine for a same-day
 * report, but historical reports will drift if costs change later.
 */
export async function getDailySalesSummary(supabase: Client, date: Date): Promise<DailySalesSummary> {
  const sales = await getDailySales(supabase, date);

  if (sales.length === 0) {
    return { sales, salesCount: 0, totalRevenue: 0, totalProfit: 0 };
  }

  const { data: items, error: itemsError } = await supabase
    .from("sale_items")
    .select("product_id, quantity, unit_price")
    .in(
      "sale_id",
      sales.map((sale) => sale.id),
    );

  if (itemsError) throw itemsError;

  const productIds = Array.from(
    new Set((items ?? []).map((item) => item.product_id).filter((id): id is string => id !== null)),
  );

  const costByProductId = new Map<string, number>();
  if (productIds.length > 0) {
    const { data: products, error: productsError } = await supabase
      .from("products")
      .select("id, cost_price")
      .in("id", productIds);

    if (productsError) throw productsError;
    (products ?? []).forEach((product) => costByProductId.set(product.id, product.cost_price));
  }

  const totalProfit = (items ?? []).reduce((sum, item) => {
    const cost = item.product_id ? (costByProductId.get(item.product_id) ?? 0) : 0;
    return sum + (item.unit_price - cost) * item.quantity;
  }, 0);

  const totalRevenue = sales.reduce((sum, sale) => sum + sale.total_amount, 0);

  return { sales, salesCount: sales.length, totalRevenue, totalProfit };
}

export interface DailySalesPoint {
  date: string;
  totalRevenue: number;
  salesCount: number;
}

/** Buckets sales revenue/count per calendar day (ascending), zero-filling days with no sales so the chart doesn't skip gaps. */
export async function getSalesTrend(supabase: Client, days = 7): Promise<DailySalesPoint[]> {
  const endDate = new Date();
  endDate.setHours(23, 59, 59, 999);
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - (days - 1));
  startDate.setHours(0, 0, 0, 0);

  const { data: sales, error } = await supabase
    .from("sales")
    .select("created_at, total_amount")
    .gte("created_at", startDate.toISOString())
    .lte("created_at", endDate.toISOString());

  if (error) throw error;

  const byDate = new Map<string, { totalRevenue: number; salesCount: number }>();
  (sales ?? []).forEach((sale) => {
    const day = sale.created_at.slice(0, 10);
    const bucket = byDate.get(day) ?? { totalRevenue: 0, salesCount: 0 };
    bucket.totalRevenue += sale.total_amount;
    bucket.salesCount += 1;
    byDate.set(day, bucket);
  });

  const points: DailySalesPoint[] = [];
  const cursor = new Date(startDate);
  while (cursor <= endDate) {
    const day = cursor.toISOString().slice(0, 10);
    const bucket = byDate.get(day) ?? { totalRevenue: 0, salesCount: 0 };
    points.push({ date: day, totalRevenue: bucket.totalRevenue, salesCount: bucket.salesCount });
    cursor.setDate(cursor.getDate() + 1);
  }

  return points;
}

export interface TopProductStat {
  productId: string | null;
  productName: string;
  totalQuantity: number;
  totalRevenue: number;
}

/**
 * Two-step fetch (sales in range → their sale_items), same pattern as
 * getDailySalesSummary. Grouped by product_id, falling back to grouping by
 * the snapshotted product_name for items whose product was later deleted
 * (product_id set null).
 */
export async function getTopProducts(
  supabase: Client,
  startDate: Date,
  endDate: Date,
  limit = 10,
): Promise<TopProductStat[]> {
  const { data: sales, error: salesError } = await supabase
    .from("sales")
    .select("id")
    .gte("created_at", startDate.toISOString())
    .lte("created_at", endDate.toISOString());

  if (salesError) throw salesError;
  if (!sales || sales.length === 0) return [];

  const { data: items, error: itemsError } = await supabase
    .from("sale_items")
    .select("product_id, product_name, quantity, total_price")
    .in(
      "sale_id",
      sales.map((sale) => sale.id),
    );

  if (itemsError) throw itemsError;

  const byKey = new Map<string, TopProductStat>();
  (items ?? []).forEach((item) => {
    const key = item.product_id ?? `name:${item.product_name}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.totalQuantity += item.quantity;
      existing.totalRevenue += item.total_price;
    } else {
      byKey.set(key, {
        productId: item.product_id,
        productName: item.product_name,
        totalQuantity: item.quantity,
        totalRevenue: item.total_price,
      });
    }
  });

  return Array.from(byKey.values())
    .sort((a, b) => b.totalRevenue - a.totalRevenue)
    .slice(0, limit);
}

export interface TopCategoryStat {
  categoryId: string | null;
  categoryName: string;
  categoryColor: string;
  categoryIcon: string;
  totalQuantity: number;
  totalRevenue: number;
}

const UNCATEGORIZED_LABEL = "أخرى";
const UNCATEGORIZED_COLOR = "#57534e";
const UNCATEGORIZED_ICON = "ellipsis";

/**
 * Same sale_items fetch as getTopProducts, additionally joined (client-side)
 * against products → categories to bucket revenue per category. Items whose
 * product or category can no longer be resolved (deleted / never assigned)
 * are bucketed under "أخرى".
 */
export async function getTopCategories(
  supabase: Client,
  startDate: Date,
  endDate: Date,
  limit = 10,
): Promise<TopCategoryStat[]> {
  const { data: sales, error: salesError } = await supabase
    .from("sales")
    .select("id")
    .gte("created_at", startDate.toISOString())
    .lte("created_at", endDate.toISOString());

  if (salesError) throw salesError;
  if (!sales || sales.length === 0) return [];

  const { data: items, error: itemsError } = await supabase
    .from("sale_items")
    .select("product_id, quantity, total_price")
    .in(
      "sale_id",
      sales.map((sale) => sale.id),
    );

  if (itemsError) throw itemsError;

  const productIds = Array.from(
    new Set((items ?? []).map((item) => item.product_id).filter((id): id is string => id !== null)),
  );

  const categoryIdByProductId = new Map<string, string | null>();
  if (productIds.length > 0) {
    const { data: products, error: productsError } = await supabase
      .from("products")
      .select("id, category_id")
      .in("id", productIds);

    if (productsError) throw productsError;
    (products ?? []).forEach((product) => categoryIdByProductId.set(product.id, product.category_id));
  }

  const categoryIds = Array.from(
    new Set(Array.from(categoryIdByProductId.values()).filter((id): id is string => id !== null)),
  );

  const categoryById = new Map<string, { name: string; color: string; icon: string }>();
  if (categoryIds.length > 0) {
    const { data: categories, error: categoriesError } = await supabase
      .from("categories")
      .select("id, name, color, icon")
      .in("id", categoryIds);

    if (categoriesError) throw categoriesError;
    (categories ?? []).forEach((category) =>
      categoryById.set(category.id, { name: category.name, color: category.color, icon: category.icon }),
    );
  }

  const byKey = new Map<string, TopCategoryStat>();
  (items ?? []).forEach((item) => {
    const categoryId = item.product_id ? (categoryIdByProductId.get(item.product_id) ?? null) : null;
    const category = categoryId ? categoryById.get(categoryId) : undefined;
    const key = categoryId ?? "__uncategorized__";

    const existing = byKey.get(key);
    if (existing) {
      existing.totalQuantity += item.quantity;
      existing.totalRevenue += item.total_price;
    } else {
      byKey.set(key, {
        categoryId,
        categoryName: category?.name ?? UNCATEGORIZED_LABEL,
        categoryColor: category?.color ?? UNCATEGORIZED_COLOR,
        categoryIcon: category?.icon ?? UNCATEGORIZED_ICON,
        totalQuantity: item.quantity,
        totalRevenue: item.total_price,
      });
    }
  });

  return Array.from(byKey.values())
    .sort((a, b) => b.totalRevenue - a.totalRevenue)
    .slice(0, limit);
}
