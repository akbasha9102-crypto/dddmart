import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { CheckoutPayload, CompletedSale, Sale, SaleItem, SaleItemInsert } from "@/types/pos";
import { calculateTotals } from "@/types/pos";
import { generateInvoiceNumber } from "@/lib/utils";
import { logOperation } from "@/services/archive.service";

type Client = SupabaseClient<Database>;

/** Pure row-building step, split out from createSale so the quantity/price/unit-snapshot math is testable without touching Supabase. */
export function buildSaleItemRows(saleId: string, items: CheckoutPayload["items"]): SaleItemInsert[] {
  return items.map((item) => ({
    sale_id: saleId,
    product_id: item.productId,
    product_name: item.name,
    barcode: item.barcode,
    quantity: item.quantity,
    unit_price: item.unitPrice,
    total_price: item.unitPrice * item.quantity,
    unit_label: item.unitName ?? null,
    unit_conversion_factor: item.unitConversionFactor ?? 1,
  }));
}

/** Maximum free-form date range (in days) accepted by any trend/ranking query, to protect mobile clients from accidentally-huge fetches. */
export const MAX_RANGE_DAYS = 90;

/** Throws an Arabic error if the [startDate, endDate] span exceeds MAX_RANGE_DAYS. */
function assertRangeWithinLimit(startDate: Date, endDate: Date): void {
  const spanDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  if (spanDays > MAX_RANGE_DAYS) {
    throw new Error(`المدى الزمني الأقصى المسموح به هو ${MAX_RANGE_DAYS} يوماً`);
  }
}

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

  const saleItems: SaleItemInsert[] = buildSaleItemRows(sale.id, payload.items);

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

  const totalProfit = await computeProfitForSales(supabase, sales);
  const totalRevenue = sales.reduce((sum, sale) => sum + sale.total_amount, 0);

  return { sales, salesCount: sales.length, totalRevenue, totalProfit };
}

/** Shared helper: fetches sale_items for a set of sales and estimates total profit from products' current cost_price. */
async function computeProfitForSales(supabase: Client, sales: Sale[]): Promise<number> {
  if (sales.length === 0) return 0;

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

  return (items ?? []).reduce((sum, item) => {
    const cost = item.product_id ? (costByProductId.get(item.product_id) ?? 0) : 0;
    return sum + (item.unit_price - cost) * item.quantity;
  }, 0);
}

export interface HourlyBucket {
  hour: number;
  revenue: number;
  salesCount: number;
}

export interface PeriodComparison {
  currentRevenue: number;
  previousRevenue: number;
  /** null when previousRevenue is 0 (division by zero is meaningless, not "0% change"). */
  revenueChangePercent: number | null;
  currentSalesCount: number;
  previousSalesCount: number;
  salesCountChangePercent: number | null;
}

export interface DailyReportDetails {
  date: string;
  sales: Sale[];
  salesCount: number;
  totalRevenue: number;
  /** Estimated from products' current cost_price — see getDailySalesSummary. */
  totalProfit: number;
  averageInvoiceValue: number;
  highestInvoice: Sale | null;
  lowestInvoice: Sale | null;
  totalDiscountGiven: number;
  totalItemsSold: number;
  hourlyBreakdown: HourlyBucket[];
  comparisonWithYesterday: PeriodComparison;
  comparisonWithLastWeekSameDay: PeriodComparison;
}

/** Lightweight totals-only fetch (no line items) for a single day, used for period comparisons. */
async function getDayTotals(supabase: Client, date: Date): Promise<{ revenue: number; count: number }> {
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(date);
  dayEnd.setHours(23, 59, 59, 999);

  const { data, error } = await supabase
    .from("sales")
    .select("total_amount")
    .gte("created_at", dayStart.toISOString())
    .lte("created_at", dayEnd.toISOString());

  if (error) throw error;

  const rows = data ?? [];
  return { revenue: rows.reduce((sum, row) => sum + row.total_amount, 0), count: rows.length };
}

function buildComparison(current: { revenue: number; count: number }, previous: { revenue: number; count: number }): PeriodComparison {
  return {
    currentRevenue: current.revenue,
    previousRevenue: previous.revenue,
    revenueChangePercent: previous.revenue === 0 ? null : ((current.revenue - previous.revenue) / previous.revenue) * 100,
    currentSalesCount: current.count,
    previousSalesCount: previous.count,
    salesCountChangePercent: previous.count === 0 ? null : ((current.count - previous.count) / previous.count) * 100,
  };
}

/**
 * Rich single-day report: totals, invoice extremes, hourly distribution, and
 * comparisons vs. yesterday / same weekday last week. Profit figures are
 * estimated from products' current cost_price (see getDailySalesSummary).
 */
export async function getDailyReportDetails(supabase: Client, date: Date): Promise<DailyReportDetails> {
  const sales = await getDailySales(supabase, date);
  const dateKey = new Date(date);
  dateKey.setHours(0, 0, 0, 0);

  const yesterday = new Date(dateKey);
  yesterday.setDate(yesterday.getDate() - 1);
  const lastWeekSameDay = new Date(dateKey);
  lastWeekSameDay.setDate(lastWeekSameDay.getDate() - 7);

  const [totalProfit, yesterdayTotals, lastWeekTotals] = await Promise.all([
    computeProfitForSales(supabase, sales),
    getDayTotals(supabase, yesterday),
    getDayTotals(supabase, lastWeekSameDay),
  ]);

  const totalRevenue = sales.reduce((sum, sale) => sum + sale.total_amount, 0);
  const totalDiscountGiven = sales.reduce((sum, sale) => sum + sale.discount_amount, 0);
  const averageInvoiceValue = sales.length > 0 ? totalRevenue / sales.length : 0;

  let highestInvoice: Sale | null = null;
  let lowestInvoice: Sale | null = null;
  sales.forEach((sale) => {
    if (!highestInvoice || sale.total_amount > highestInvoice.total_amount) highestInvoice = sale;
    if (!lowestInvoice || sale.total_amount < lowestInvoice.total_amount) lowestInvoice = sale;
  });

  const hourlyBreakdown: HourlyBucket[] = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    revenue: 0,
    salesCount: 0,
  }));
  sales.forEach((sale) => {
    const hour = new Date(sale.created_at).getHours();
    const bucket = hourlyBreakdown[hour];
    if (!bucket) return;
    bucket.revenue += sale.total_amount;
    bucket.salesCount += 1;
  });

  let totalItemsSold = 0;
  if (sales.length > 0) {
    const { data: items, error: itemsError } = await supabase
      .from("sale_items")
      .select("quantity")
      .in(
        "sale_id",
        sales.map((sale) => sale.id),
      );
    if (itemsError) throw itemsError;
    totalItemsSold = (items ?? []).reduce((sum, item) => sum + item.quantity, 0);
  }

  return {
    date: dateKey.toISOString().slice(0, 10),
    sales,
    salesCount: sales.length,
    totalRevenue,
    totalProfit,
    averageInvoiceValue,
    highestInvoice,
    lowestInvoice,
    totalDiscountGiven,
    totalItemsSold,
    hourlyBreakdown,
    comparisonWithYesterday: buildComparison({ revenue: totalRevenue, count: sales.length }, yesterdayTotals),
    comparisonWithLastWeekSameDay: buildComparison({ revenue: totalRevenue, count: sales.length }, lastWeekTotals),
  };
}

export interface DailySalesPoint {
  date: string;
  totalRevenue: number;
  /** Estimated from products' current cost_price — see getDailySalesSummary. */
  totalProfit: number;
  salesCount: number;
  averageInvoiceValue: number;
}

export type SalesTrendRange = { days: number } | { startDate: Date; endDate: Date };

function resolveTrendRange(range: SalesTrendRange): { startDate: Date; endDate: Date } {
  if ("days" in range) {
    const endDate = new Date();
    endDate.setHours(23, 59, 59, 999);
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - (range.days - 1));
    startDate.setHours(0, 0, 0, 0);
    return { startDate, endDate };
  }
  const startDate = new Date(range.startDate);
  startDate.setHours(0, 0, 0, 0);
  const endDate = new Date(range.endDate);
  endDate.setHours(23, 59, 59, 999);
  return { startDate, endDate };
}

/**
 * Buckets sales revenue/profit/count per calendar day (ascending), zero-filling
 * days with no sales so the chart doesn't skip gaps. Accepts either a rolling
 * "last N days" window or an explicit custom range, both capped at
 * MAX_RANGE_DAYS. Profit is estimated from products' current cost_price.
 */
export async function getSalesTrend(supabase: Client, range: SalesTrendRange): Promise<DailySalesPoint[]> {
  const { startDate, endDate } = resolveTrendRange(range);
  assertRangeWithinLimit(startDate, endDate);

  const { data: sales, error } = await supabase
    .from("sales")
    .select("id, created_at, total_amount")
    .gte("created_at", startDate.toISOString())
    .lte("created_at", endDate.toISOString());

  if (error) throw error;

  const saleRows = sales ?? [];

  const profitBySaleId = new Map<string, number>();
  if (saleRows.length > 0) {
    const { data: items, error: itemsError } = await supabase
      .from("sale_items")
      .select("sale_id, product_id, quantity, unit_price")
      .in(
        "sale_id",
        saleRows.map((sale) => sale.id),
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

    (items ?? []).forEach((item) => {
      const cost = item.product_id ? (costByProductId.get(item.product_id) ?? 0) : 0;
      const profit = (item.unit_price - cost) * item.quantity;
      profitBySaleId.set(item.sale_id, (profitBySaleId.get(item.sale_id) ?? 0) + profit);
    });
  }

  const byDate = new Map<string, { totalRevenue: number; totalProfit: number; salesCount: number }>();
  saleRows.forEach((sale) => {
    const day = new Date(sale.created_at);
    const dayKey = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
    const bucket = byDate.get(dayKey) ?? { totalRevenue: 0, totalProfit: 0, salesCount: 0 };
    bucket.totalRevenue += sale.total_amount;
    bucket.totalProfit += profitBySaleId.get(sale.id) ?? 0;
    bucket.salesCount += 1;
    byDate.set(dayKey, bucket);
  });

  const points: DailySalesPoint[] = [];
  const cursor = new Date(startDate);
  while (cursor <= endDate) {
    const dayKey = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
    const bucket = byDate.get(dayKey) ?? { totalRevenue: 0, totalProfit: 0, salesCount: 0 };
    points.push({
      date: dayKey,
      totalRevenue: bucket.totalRevenue,
      totalProfit: bucket.totalProfit,
      salesCount: bucket.salesCount,
      averageInvoiceValue: bucket.salesCount > 0 ? bucket.totalRevenue / bucket.salesCount : 0,
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  return points;
}

export interface ProductRankingStat {
  productId: string | null;
  productName: string;
  categoryId: string | null;
  categoryName: string;
  totalQuantity: number;
  totalRevenue: number;
  /** Estimated from the product's current cost_price — see getDailySalesSummary. */
  totalProfit: number;
  /** Share of this product's revenue out of the grand total for the range (0-100). 0 when there are no sales at all. */
  revenueSharePercent: number;
  /** Number of distinct invoices that included this product (not summed quantity). */
  saleCount: number;
}

const UNCATEGORIZED_LABEL = "أخرى";
const UNCATEGORIZED_COLOR = "#57534e";
const UNCATEGORIZED_ICON = "ellipsis";

/**
 * Full product ranking (no limit — caller paginates/sorts in the UI) for a
 * date range capped at MAX_RANGE_DAYS. Two-step fetch (sales in range →
 * their sale_items), same pattern as getDailySalesSummary. Items whose
 * product was later deleted (product_id null) are grouped by their
 * snapshotted product_name and reported with categoryId: null / "أخرى".
 * Profit is estimated from products' current cost_price.
 */
export async function getProductRanking(supabase: Client, startDate: Date, endDate: Date): Promise<ProductRankingStat[]> {
  assertRangeWithinLimit(startDate, endDate);

  const { data: sales, error: salesError } = await supabase
    .from("sales")
    .select("id")
    .gte("created_at", startDate.toISOString())
    .lte("created_at", endDate.toISOString());

  if (salesError) throw salesError;
  if (!sales || sales.length === 0) return [];

  const { data: items, error: itemsError } = await supabase
    .from("sale_items")
    .select("sale_id, product_id, product_name, quantity, unit_price, total_price")
    .in(
      "sale_id",
      sales.map((sale) => sale.id),
    );

  if (itemsError) throw itemsError;

  const productIds = Array.from(
    new Set((items ?? []).map((item) => item.product_id).filter((id): id is string => id !== null)),
  );

  const productInfoById = new Map<string, { categoryId: string | null; costPrice: number }>();
  if (productIds.length > 0) {
    const { data: products, error: productsError } = await supabase
      .from("products")
      .select("id, category_id, cost_price")
      .in("id", productIds);
    if (productsError) throw productsError;
    (products ?? []).forEach((product) =>
      productInfoById.set(product.id, { categoryId: product.category_id, costPrice: product.cost_price }),
    );
  }

  const categoryIds = Array.from(
    new Set(Array.from(productInfoById.values()).map((info) => info.categoryId).filter((id): id is string => id !== null)),
  );

  const categoryNameById = new Map<string, string>();
  if (categoryIds.length > 0) {
    const { data: categories, error: categoriesError } = await supabase
      .from("categories")
      .select("id, name")
      .in("id", categoryIds);
    if (categoriesError) throw categoriesError;
    (categories ?? []).forEach((category) => categoryNameById.set(category.id, category.name));
  }

  interface Accumulator extends ProductRankingStat {
    saleIds: Set<string>;
  }

  const byKey = new Map<string, Accumulator>();
  (items ?? []).forEach((item) => {
    const key = item.product_id ?? `name:${item.product_name}`;
    const info = item.product_id ? productInfoById.get(item.product_id) : undefined;
    const categoryId = info?.categoryId ?? null;
    const cost = info?.costPrice ?? 0;
    const profit = (item.unit_price - cost) * item.quantity;

    const existing = byKey.get(key);
    if (existing) {
      existing.totalQuantity += item.quantity;
      existing.totalRevenue += item.total_price;
      existing.totalProfit += profit;
      existing.saleIds.add(item.sale_id);
    } else {
      byKey.set(key, {
        productId: item.product_id,
        productName: item.product_name,
        categoryId,
        categoryName: categoryId ? (categoryNameById.get(categoryId) ?? UNCATEGORIZED_LABEL) : UNCATEGORIZED_LABEL,
        totalQuantity: item.quantity,
        totalRevenue: item.total_price,
        totalProfit: profit,
        revenueSharePercent: 0,
        saleCount: 0,
        saleIds: new Set([item.sale_id]),
      });
    }
  });

  const stats = Array.from(byKey.values());
  const grandTotalRevenue = stats.reduce((sum, stat) => sum + stat.totalRevenue, 0);

  return stats
    .map((stat) => ({
      productId: stat.productId,
      productName: stat.productName,
      categoryId: stat.categoryId,
      categoryName: stat.categoryName,
      totalQuantity: stat.totalQuantity,
      totalRevenue: stat.totalRevenue,
      totalProfit: stat.totalProfit,
      revenueSharePercent: grandTotalRevenue > 0 ? (stat.totalRevenue / grandTotalRevenue) * 100 : 0,
      saleCount: stat.saleIds.size,
    }))
    .sort((a, b) => b.totalRevenue - a.totalRevenue);
}

export interface CategoryRankingStat {
  categoryId: string | null;
  categoryName: string;
  categoryColor: string;
  categoryIcon: string;
  totalQuantity: number;
  totalRevenue: number;
  /** Estimated from products' current cost_price — see getDailySalesSummary. */
  totalProfit: number;
  /** Share of this category's revenue out of the grand total for the range (0-100). 0 when there are no sales at all. */
  revenueSharePercent: number;
  /** Number of distinct invoices that included a product from this category. */
  saleCount: number;
}

/**
 * Full category ranking (no limit — caller paginates/sorts in the UI) for a
 * date range capped at MAX_RANGE_DAYS. Same sale_items fetch as
 * getProductRanking, additionally joined (client-side) against products →
 * categories to bucket revenue per category. Items whose product or category
 * can no longer be resolved (deleted / never assigned) are bucketed under
 * "أخرى". Profit is estimated from products' current cost_price.
 */
export async function getCategoryRanking(supabase: Client, startDate: Date, endDate: Date): Promise<CategoryRankingStat[]> {
  assertRangeWithinLimit(startDate, endDate);

  const { data: sales, error: salesError } = await supabase
    .from("sales")
    .select("id")
    .gte("created_at", startDate.toISOString())
    .lte("created_at", endDate.toISOString());

  if (salesError) throw salesError;
  if (!sales || sales.length === 0) return [];

  const { data: items, error: itemsError } = await supabase
    .from("sale_items")
    .select("sale_id, product_id, quantity, unit_price, total_price")
    .in(
      "sale_id",
      sales.map((sale) => sale.id),
    );

  if (itemsError) throw itemsError;

  const productIds = Array.from(
    new Set((items ?? []).map((item) => item.product_id).filter((id): id is string => id !== null)),
  );

  const productInfoById = new Map<string, { categoryId: string | null; costPrice: number }>();
  if (productIds.length > 0) {
    const { data: products, error: productsError } = await supabase
      .from("products")
      .select("id, category_id, cost_price")
      .in("id", productIds);
    if (productsError) throw productsError;
    (products ?? []).forEach((product) =>
      productInfoById.set(product.id, { categoryId: product.category_id, costPrice: product.cost_price }),
    );
  }

  const categoryIds = Array.from(
    new Set(Array.from(productInfoById.values()).map((info) => info.categoryId).filter((id): id is string => id !== null)),
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

  interface Accumulator extends CategoryRankingStat {
    saleIds: Set<string>;
  }

  const byKey = new Map<string, Accumulator>();
  (items ?? []).forEach((item) => {
    const info = item.product_id ? productInfoById.get(item.product_id) : undefined;
    const categoryId = info?.categoryId ?? null;
    const category = categoryId ? categoryById.get(categoryId) : undefined;
    const cost = info?.costPrice ?? 0;
    const profit = (item.unit_price - cost) * item.quantity;
    const key = categoryId ?? "__uncategorized__";

    const existing = byKey.get(key);
    if (existing) {
      existing.totalQuantity += item.quantity;
      existing.totalRevenue += item.total_price;
      existing.totalProfit += profit;
      existing.saleIds.add(item.sale_id);
    } else {
      byKey.set(key, {
        categoryId,
        categoryName: category?.name ?? UNCATEGORIZED_LABEL,
        categoryColor: category?.color ?? UNCATEGORIZED_COLOR,
        categoryIcon: category?.icon ?? UNCATEGORIZED_ICON,
        totalQuantity: item.quantity,
        totalRevenue: item.total_price,
        totalProfit: profit,
        revenueSharePercent: 0,
        saleCount: 0,
        saleIds: new Set([item.sale_id]),
      });
    }
  });

  const stats = Array.from(byKey.values());
  const grandTotalRevenue = stats.reduce((sum, stat) => sum + stat.totalRevenue, 0);

  return stats
    .map((stat) => ({
      categoryId: stat.categoryId,
      categoryName: stat.categoryName,
      categoryColor: stat.categoryColor,
      categoryIcon: stat.categoryIcon,
      totalQuantity: stat.totalQuantity,
      totalRevenue: stat.totalRevenue,
      totalProfit: stat.totalProfit,
      revenueSharePercent: grandTotalRevenue > 0 ? (stat.totalRevenue / grandTotalRevenue) * 100 : 0,
      saleCount: stat.saleIds.size,
    }))
    .sort((a, b) => b.totalRevenue - a.totalRevenue);
}
