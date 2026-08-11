import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { CheckoutPayload, CompletedSale, Sale, SaleItem, SaleItemInsert } from "@/types/pos";
import { calculateTotals } from "@/types/pos";
import { generateInvoiceNumber } from "@/lib/utils";
import { logOperation } from "@/services/archive.service";

type Client = SupabaseClient<Database>;

/**
 * Pure row-building step, split out from createSale so the
 * quantity/price/unit-snapshot math is testable without touching Supabase.
 * Deliberately omits store_id — this function has no store context of its
 * own; createSale adds store_id when it maps these rows into the actual
 * insert payload.
 */
export function buildSaleItemRows(saleId: string, items: CheckoutPayload["items"]): Omit<SaleItemInsert, "store_id">[] {
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
    cost_price: item.costPrice,
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
 * One return row enriched with its original sale line's unit_price/cost_price,
 * used to compute the profit-reversal of a return (see ReturnWithLineProfit
 * usage below) — deliberately NOT using refund_amount for that calc, since a
 * partial/overridden refund shouldn't distort the profit-reversal math.
 */
interface ReturnForReporting {
  sale_item_id: string;
  product_id: string | null;
  product_name: string;
  quantity: number;
  refund_amount: number;
  created_at: string;
}

interface SaleItemProfitInfo {
  unit_price: number;
  cost_price: number;
}

/**
 * Fetches returns whose `created_at` falls in range — returns net against
 * the day they're RETURNED, not the day of the original sale (see plan
 * rationale in services/returns.service.ts / docs). Also fetches the
 * referenced sale_items rows (keyed by sale_item_id) so callers can compute
 * each return's true profit reversal from the original line's actual
 * margin, proportional to quantity returned.
 */
async function getReturnsInRange(
  supabase: Client,
  startDate: Date,
  endDate: Date,
): Promise<{ returns: ReturnForReporting[]; saleItemById: Map<string, SaleItemProfitInfo> }> {
  const { data: returnRows, error: returnsError } = await supabase
    .from("returns")
    .select("sale_item_id, product_id, product_name, quantity, refund_amount, created_at")
    .gte("created_at", startDate.toISOString())
    .lte("created_at", endDate.toISOString());

  if (returnsError) throw returnsError;

  const returns = returnRows ?? [];
  const saleItemById = new Map<string, SaleItemProfitInfo>();

  if (returns.length > 0) {
    const { data: saleItems, error: saleItemsError } = await supabase
      .from("sale_items")
      .select("id, unit_price, cost_price")
      .in(
        "id",
        returns.map((row) => row.sale_item_id),
      );
    if (saleItemsError) throw saleItemsError;
    (saleItems ?? []).forEach((item) => saleItemById.set(item.id, { unit_price: item.unit_price, cost_price: item.cost_price }));
  }

  return { returns, saleItemById };
}

/** Reverses the original line's actual margin proportional to quantity returned — never uses refund_amount (see getReturnsInRange doc). */
function computeReturnsProfitReversal(returns: ReturnForReporting[], saleItemById: Map<string, SaleItemProfitInfo>): number {
  return returns.reduce((sum, row) => {
    const line = saleItemById.get(row.sale_item_id);
    if (!line) return sum;
    return sum + (line.unit_price - line.cost_price) * row.quantity;
  }, 0);
}

function sumRefundAmount(returns: ReturnForReporting[]): number {
  return returns.reduce((sum, row) => sum + row.refund_amount, 0);
}

interface DamageForReporting {
  product_id: string | null;
  product_name: string;
  loss_amount: number;
  created_at: string;
}

/** Fetches stock_damages whose `created_at` falls in range. */
async function getDamagesInRange(supabase: Client, startDate: Date, endDate: Date): Promise<DamageForReporting[]> {
  const { data, error } = await supabase
    .from("stock_damages")
    .select("product_id, product_name, loss_amount, created_at")
    .gte("created_at", startDate.toISOString())
    .lte("created_at", endDate.toISOString());

  if (error) throw error;
  return data ?? [];
}

function sumLossAmount(damages: DamageForReporting[]): number {
  return damages.reduce((sum, row) => sum + row.loss_amount, 0);
}

interface ReconciliationForReporting {
  product_id: string | null;
  product_name: string;
  loss_value: number;
  created_at: string;
}

/** Fetches stock_reconciliations whose `created_at` falls in range. loss_value is 0 for overage rows, so summing needs no separate filter. */
async function getReconciliationLossInRange(supabase: Client, startDate: Date, endDate: Date): Promise<ReconciliationForReporting[]> {
  const { data, error } = await supabase
    .from("stock_reconciliations")
    .select("product_id, product_name, loss_value, created_at")
    .gte("created_at", startDate.toISOString())
    .lte("created_at", endDate.toISOString());

  if (error) throw error;
  return data ?? [];
}

function sumReconciliationLoss(reconciliations: ReconciliationForReporting[]): number {
  return reconciliations.reduce((sum, row) => sum + row.loss_value, 0);
}

/** Start/end-of-day bounds for a single calendar date, matching getDailySales'/getDayTotals' existing convention. */
function dayBounds(date: Date): { dayStart: Date; dayEnd: Date } {
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(date);
  dayEnd.setHours(23, 59, 59, 999);
  return { dayStart, dayEnd };
}

/** Local-calendar-day key (YYYY-MM-DD), shared by getSalesTrend's sale/return/damage bucketing so they align on the same day boundaries. */
function dayKeyOf(value: string | Date): string {
  const day = new Date(value);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
}

/**
 * Persists a completed sale (cash or credit): the invoice header and its
 * line items, plus a customer_transactions ledger row for credit sales.
 * Stock is no longer touched here — it's decremented atomically at
 * add-to-cart time instead (see services/products.service.ts#decrementStock
 * / hooks/usePOS.ts#addProductToCart). Not wrapped in a DB transaction (no
 * RPC layer yet) — acceptable for a single-till MVP, revisit before
 * multi-till rollout.
 *
 * payload.id/payload.invoiceNumber let a previously-queued offline sale
 * (see lib/offline/syncManager.ts) sync under the same identity its receipt
 * already showed the cashier. Both are optional and unused by the normal
 * online checkout path, which keeps generating them here as before.
 *
 * Division of responsibility for CompletedSale.customerName: createSale only
 * has payload.customerId (an id) in scope, not the customer's display name,
 * so it never sets customerName — the caller (hooks/usePOS.ts), which already
 * has the selected CustomerWithBalance in hand, populates it for receipt
 * printing.
 */
export async function createSale(supabase: Client, payload: CheckoutPayload, storeId: string): Promise<CompletedSale> {
  if (payload.items.length === 0) {
    throw new Error("لا يمكن إتمام عملية بيع فارغة");
  }

  const paymentMethod = payload.paymentMethod ?? "cash";
  if (paymentMethod === "credit" && !payload.customerId) {
    throw new Error("يجب اختيار زبون لإتمام بيع بالآجل");
  }
  // Narrowed once here so both the sales insert and the customer_transactions
  // insert below can use a plain string (payload.customerId's static type is
  // string | null | undefined, but the guard above already ensures it's set
  // whenever paymentMethod === "credit").
  const customerId = payload.customerId as string | null;

  const { subtotal, discountAmount, totalAmount } = calculateTotals(payload.items, payload.discountAmount);
  const paidAmount = paymentMethod === "credit" ? 0 : payload.paidAmount;
  const changeAmount = paymentMethod === "credit" ? 0 : Math.max(payload.paidAmount - totalAmount, 0);

  const { data: sale, error: saleError } = await supabase
    .from("sales")
    .insert({
      id: payload.id ?? undefined,
      invoice_number: payload.invoiceNumber ?? generateInvoiceNumber(),
      cashier_id: payload.cashierId,
      subtotal,
      discount_amount: discountAmount,
      total_amount: totalAmount,
      paid_amount: paidAmount,
      change_amount: changeAmount,
      payment_method: paymentMethod,
      customer_id: paymentMethod === "credit" ? customerId : null,
      store_id: storeId,
    })
    .select()
    .single();

  if (saleError) throw saleError;

  const saleItems: SaleItemInsert[] = buildSaleItemRows(sale.id, payload.items).map((item) => ({
    ...item,
    store_id: storeId,
  }));

  const { data: items, error: itemsError } = await supabase.from("sale_items").insert(saleItems).select();

  if (itemsError) throw itemsError;

  if (paymentMethod === "credit" && customerId) {
    const { error: transactionError } = await supabase.from("customer_transactions").insert({
      customer_id: customerId,
      type: "sale",
      amount: totalAmount,
      sale_id: sale.id,
      store_id: storeId,
    });

    if (transactionError) throw transactionError;
  }

  await logOperation(supabase, {
    userId: payload.cashierId,
    actionType: "sale_created",
    entityType: "sale",
    entityId: sale.id,
    description: `تم تسجيل عملية بيع بقيمة ${totalAmount} (فاتورة ${sale.invoice_number})`,
    storeId,
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
  /** Nets against returns.refund_amount for the day (see totalReturnsValue). */
  totalRevenue: number;
  /** grossProfit - returnsProfitReversal - totalDamageLoss - totalReconciliationLoss (see services/sales.service.ts module doc / plan). */
  totalProfit: number;
  /** sum(returns.refund_amount) for returns whose created_at falls on this day — also already netted into totalRevenue. */
  totalReturnsValue: number;
  /** sum(stock_damages.loss_amount) for damages whose created_at falls on this day — also already subtracted from totalProfit. */
  totalDamageLoss: number;
  /** sum(stock_reconciliations.loss_value) for reconciliations whose created_at falls on this day — also already subtracted from totalProfit. Only shortages contribute; overages are 0. */
  totalReconciliationLoss: number;
}

/**
 * Profit is computed from each sale_item's own snapshotted cost_price
 * (captured at add-to-cart time), so historical reports stay accurate even
 * after a product's current cost_price changes later. Pre-migration rows
 * default to cost_price = 0 (unknown historical cost), which reads as
 * "full sale price counted as profit" — expected, not an error.
 *
 * Returns/damage net against the day they OCCURRED (returns.created_at /
 * stock_damages.created_at), not the day of the original sale — a return
 * can and should reduce a different day's report than the original sale's
 * day. Revenue nets against returns; profit nets against both returns
 * (via the original line's real margin, not refund_amount) and damage loss.
 */
export async function getDailySalesSummary(supabase: Client, date: Date): Promise<DailySalesSummary> {
  const sales = await getDailySales(supabase, date);
  const { dayStart, dayEnd } = dayBounds(date);

  const [grossProfit, { returns, saleItemById }, damages, reconciliations] = await Promise.all([
    computeProfitForSales(supabase, sales),
    getReturnsInRange(supabase, dayStart, dayEnd),
    getDamagesInRange(supabase, dayStart, dayEnd),
    getReconciliationLossInRange(supabase, dayStart, dayEnd),
  ]);

  const returnsProfitReversal = computeReturnsProfitReversal(returns, saleItemById);
  const totalReturnsValue = sumRefundAmount(returns);
  const totalDamageLoss = sumLossAmount(damages);
  const totalReconciliationLoss = sumReconciliationLoss(reconciliations);

  const grossRevenue = sales.reduce((sum, sale) => sum + sale.total_amount, 0);
  const totalRevenue = grossRevenue - totalReturnsValue;
  const totalProfit = grossProfit - returnsProfitReversal - totalDamageLoss - totalReconciliationLoss;

  return {
    sales,
    salesCount: sales.length,
    totalRevenue,
    totalProfit,
    totalReturnsValue,
    totalDamageLoss,
    totalReconciliationLoss,
  };
}

/** Shared helper: fetches sale_items for a set of sales and sums profit from each row's own snapshotted cost_price. */
async function computeProfitForSales(supabase: Client, sales: Sale[]): Promise<number> {
  if (sales.length === 0) return 0;

  const { data: items, error: itemsError } = await supabase
    .from("sale_items")
    .select("quantity, unit_price, cost_price")
    .in(
      "sale_id",
      sales.map((sale) => sale.id),
    );

  if (itemsError) throw itemsError;

  return (items ?? []).reduce((sum, item) => sum + (item.unit_price - item.cost_price) * item.quantity, 0);
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
  /** Nets against returns.refund_amount for the day (see totalReturnsValue). */
  totalRevenue: number;
  /** grossProfit - returnsProfitReversal - totalDamageLoss — see getDailySalesSummary. */
  totalProfit: number;
  averageInvoiceValue: number;
  highestInvoice: Sale | null;
  lowestInvoice: Sale | null;
  totalDiscountGiven: number;
  totalItemsSold: number;
  /** sum(returns.refund_amount) for returns whose created_at falls on this day — also already netted into totalRevenue. */
  totalReturnsValue: number;
  /** sum(stock_damages.loss_amount) for damages whose created_at falls on this day — also already subtracted from totalProfit. */
  totalDamageLoss: number;
  /** sum(stock_reconciliations.loss_value) for reconciliations whose created_at falls on this day — also already subtracted from totalProfit. Only shortages contribute; overages are 0. */
  totalReconciliationLoss: number;
  hourlyBreakdown: HourlyBucket[];
  comparisonWithYesterday: PeriodComparison;
  comparisonWithLastWeekSameDay: PeriodComparison;
}

/**
 * Lightweight totals-only fetch (no line items) for a single day, used for
 * period comparisons. Nets revenue against that day's returns too, so
 * yesterday/last-week comparisons stay apples-to-apples with today's net
 * totalRevenue.
 */
async function getDayTotals(supabase: Client, date: Date): Promise<{ revenue: number; count: number }> {
  const { dayStart, dayEnd } = dayBounds(date);

  const [{ data, error }, { returns }] = await Promise.all([
    supabase
      .from("sales")
      .select("total_amount")
      .gte("created_at", dayStart.toISOString())
      .lte("created_at", dayEnd.toISOString()),
    getReturnsInRange(supabase, dayStart, dayEnd),
  ]);

  if (error) throw error;

  const rows = data ?? [];
  const grossRevenue = rows.reduce((sum, row) => sum + row.total_amount, 0);
  return { revenue: grossRevenue - sumRefundAmount(returns), count: rows.length };
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
 * comparisons vs. yesterday / same weekday last week. Profit figures come
 * from each sale_item's own snapshotted cost_price (see getDailySalesSummary).
 */
export async function getDailyReportDetails(supabase: Client, date: Date): Promise<DailyReportDetails> {
  const sales = await getDailySales(supabase, date);
  const dateKey = new Date(date);
  dateKey.setHours(0, 0, 0, 0);
  const { dayStart, dayEnd } = dayBounds(date);

  const yesterday = new Date(dateKey);
  yesterday.setDate(yesterday.getDate() - 1);
  const lastWeekSameDay = new Date(dateKey);
  lastWeekSameDay.setDate(lastWeekSameDay.getDate() - 7);

  const [grossProfit, { returns, saleItemById }, damages, reconciliations, yesterdayTotals, lastWeekTotals] = await Promise.all([
    computeProfitForSales(supabase, sales),
    getReturnsInRange(supabase, dayStart, dayEnd),
    getDamagesInRange(supabase, dayStart, dayEnd),
    getReconciliationLossInRange(supabase, dayStart, dayEnd),
    getDayTotals(supabase, yesterday),
    getDayTotals(supabase, lastWeekSameDay),
  ]);

  const returnsProfitReversal = computeReturnsProfitReversal(returns, saleItemById);
  const totalReturnsValue = sumRefundAmount(returns);
  const totalDamageLoss = sumLossAmount(damages);
  const totalReconciliationLoss = sumReconciliationLoss(reconciliations);

  const grossRevenue = sales.reduce((sum, sale) => sum + sale.total_amount, 0);
  const totalRevenue = grossRevenue - totalReturnsValue;
  const totalProfit = grossProfit - returnsProfitReversal - totalDamageLoss - totalReconciliationLoss;
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
    totalReturnsValue,
    totalDamageLoss,
    totalReconciliationLoss,
    hourlyBreakdown,
    comparisonWithYesterday: buildComparison({ revenue: totalRevenue, count: sales.length }, yesterdayTotals),
    comparisonWithLastWeekSameDay: buildComparison({ revenue: totalRevenue, count: sales.length }, lastWeekTotals),
  };
}

export interface DailySalesPoint {
  date: string;
  /** Nets against that day's returns.refund_amount (see totalReturnsValue). */
  totalRevenue: number;
  /** grossProfit - returnsProfitReversal - totalDamageLoss - totalReconciliationLoss for this day — see getDailySalesSummary. */
  totalProfit: number;
  salesCount: number;
  averageInvoiceValue: number;
  /** sum(returns.refund_amount) whose created_at falls on this day — also already netted into totalRevenue. */
  totalReturnsValue: number;
  /** sum(stock_damages.loss_amount) whose created_at falls on this day — also already subtracted from totalProfit. */
  totalDamageLoss: number;
  /** sum(stock_reconciliations.loss_value) whose created_at falls on this day — also already subtracted from totalProfit. Only shortages contribute; overages are 0. */
  totalReconciliationLoss: number;
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
 * MAX_RANGE_DAYS. Profit comes from each sale_item's own snapshotted cost_price.
 *
 * Returns/damage are bucketed by their OWN created_at day (not the original
 * sale's day) — same "day of return/damage, not day of sale" rule as
 * getDailySalesSummary — so a return can shift a different day's point than
 * its original sale's point.
 */
export async function getSalesTrend(supabase: Client, range: SalesTrendRange): Promise<DailySalesPoint[]> {
  const { startDate, endDate } = resolveTrendRange(range);
  assertRangeWithinLimit(startDate, endDate);

  const [{ data: sales, error }, { returns, saleItemById }, damages, reconciliations] = await Promise.all([
    supabase
      .from("sales")
      .select("id, created_at, total_amount")
      .gte("created_at", startDate.toISOString())
      .lte("created_at", endDate.toISOString()),
    getReturnsInRange(supabase, startDate, endDate),
    getDamagesInRange(supabase, startDate, endDate),
    getReconciliationLossInRange(supabase, startDate, endDate),
  ]);

  if (error) throw error;

  const saleRows = sales ?? [];

  const profitBySaleId = new Map<string, number>();
  if (saleRows.length > 0) {
    const { data: items, error: itemsError } = await supabase
      .from("sale_items")
      .select("sale_id, quantity, unit_price, cost_price")
      .in(
        "sale_id",
        saleRows.map((sale) => sale.id),
      );
    if (itemsError) throw itemsError;

    (items ?? []).forEach((item) => {
      const cost = item.cost_price;
      const profit = (item.unit_price - cost) * item.quantity;
      profitBySaleId.set(item.sale_id, (profitBySaleId.get(item.sale_id) ?? 0) + profit);
    });
  }

  interface Bucket {
    grossRevenue: number;
    grossProfit: number;
    salesCount: number;
    returnsProfitReversal: number;
    totalReturnsValue: number;
    totalDamageLoss: number;
    totalReconciliationLoss: number;
  }

  const emptyBucket = (): Bucket => ({
    grossRevenue: 0,
    grossProfit: 0,
    salesCount: 0,
    returnsProfitReversal: 0,
    totalReturnsValue: 0,
    totalDamageLoss: 0,
    totalReconciliationLoss: 0,
  });

  const byDate = new Map<string, Bucket>();
  saleRows.forEach((sale) => {
    const dayKey = dayKeyOf(sale.created_at);
    const bucket = byDate.get(dayKey) ?? emptyBucket();
    bucket.grossRevenue += sale.total_amount;
    bucket.grossProfit += profitBySaleId.get(sale.id) ?? 0;
    bucket.salesCount += 1;
    byDate.set(dayKey, bucket);
  });

  returns.forEach((row) => {
    const dayKey = dayKeyOf(row.created_at);
    const bucket = byDate.get(dayKey) ?? emptyBucket();
    bucket.totalReturnsValue += row.refund_amount;
    const line = saleItemById.get(row.sale_item_id);
    if (line) bucket.returnsProfitReversal += (line.unit_price - line.cost_price) * row.quantity;
    byDate.set(dayKey, bucket);
  });

  damages.forEach((row) => {
    const dayKey = dayKeyOf(row.created_at);
    const bucket = byDate.get(dayKey) ?? emptyBucket();
    bucket.totalDamageLoss += row.loss_amount;
    byDate.set(dayKey, bucket);
  });

  reconciliations.forEach((row) => {
    const dayKey = dayKeyOf(row.created_at);
    const bucket = byDate.get(dayKey) ?? emptyBucket();
    bucket.totalReconciliationLoss += row.loss_value;
    byDate.set(dayKey, bucket);
  });

  const points: DailySalesPoint[] = [];
  const cursor = new Date(startDate);
  while (cursor <= endDate) {
    const dayKey = dayKeyOf(cursor);
    const bucket = byDate.get(dayKey) ?? emptyBucket();
    const totalRevenue = bucket.grossRevenue - bucket.totalReturnsValue;
    const totalProfit = bucket.grossProfit - bucket.returnsProfitReversal - bucket.totalDamageLoss - bucket.totalReconciliationLoss;
    points.push({
      date: dayKey,
      totalRevenue,
      totalProfit,
      salesCount: bucket.salesCount,
      averageInvoiceValue: bucket.salesCount > 0 ? totalRevenue / bucket.salesCount : 0,
      totalReturnsValue: bucket.totalReturnsValue,
      totalDamageLoss: bucket.totalDamageLoss,
      totalReconciliationLoss: bucket.totalReconciliationLoss,
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
  /** Deliberately GROSS at this per-product granularity — does not subtract returns. See totalReturnsValue. */
  totalRevenue: number;
  /** Nets against this product's returns-profit-reversal + damage loss in range — see getDailySalesSummary. */
  totalProfit: number;
  /** Share of this product's revenue out of the grand total for the range (0-100). 0 when there are no sales at all. */
  revenueSharePercent: number;
  /** Number of distinct invoices that included this product (not summed quantity). */
  saleCount: number;
  /** sum(returns.refund_amount) for this product's returns in range (by returns.created_at) — disclosed only, NOT subtracted from totalRevenue here (unlike the daily summary). */
  totalReturnsValue: number;
  /** sum(stock_damages.loss_amount) for this product in range — already subtracted from totalProfit. */
  totalDamageLoss: number;
  /** sum(stock_reconciliations.loss_value) for this product in range — already subtracted from totalProfit. Only shortages contribute; overages are 0. */
  totalReconciliationLoss: number;
}

const UNCATEGORIZED_LABEL = "أخرى";
const UNCATEGORIZED_COLOR = "#57534e";
const UNCATEGORIZED_ICON = "ellipsis";

/** Same key convention as getProductRanking's byKey map: product_id when known, else a name-based fallback for deleted products. */
function productRankingKey(productId: string | null, productName: string): string {
  return productId ?? `name:${productName}`;
}

/**
 * Full product ranking (no limit — caller paginates/sorts in the UI) for a
 * date range capped at MAX_RANGE_DAYS. Two-step fetch (sales in range →
 * their sale_items), same pattern as getDailySalesSummary. Items whose
 * product was later deleted (product_id null) are grouped by their
 * snapshotted product_name and reported with categoryId: null / "أخرى".
 * Profit comes from each sale_item's own snapshotted cost_price, netted
 * against this product's returns-profit-reversal and damage loss in range
 * (both keyed by their OWN created_at, not the original sale's day — same
 * rule as getDailySalesSummary). Revenue stays GROSS here (deliberate
 * asymmetry vs. the daily summary) — totalReturnsValue is disclosed as its
 * own field instead of being netted in.
 */
export async function getProductRanking(supabase: Client, startDate: Date, endDate: Date): Promise<ProductRankingStat[]> {
  assertRangeWithinLimit(startDate, endDate);

  const { data: sales, error: salesError } = await supabase
    .from("sales")
    .select("id")
    .gte("created_at", startDate.toISOString())
    .lte("created_at", endDate.toISOString());

  if (salesError) throw salesError;

  const { returns, saleItemById } = await getReturnsInRange(supabase, startDate, endDate);
  const damages = await getDamagesInRange(supabase, startDate, endDate);
  const reconciliations = await getReconciliationLossInRange(supabase, startDate, endDate);

  if ((!sales || sales.length === 0) && returns.length === 0 && damages.length === 0 && reconciliations.length === 0) return [];

  let items: { sale_id: string; product_id: string | null; product_name: string; quantity: number; unit_price: number; total_price: number; cost_price: number }[] = [];
  if (sales && sales.length > 0) {
    const { data, error: itemsError } = await supabase
      .from("sale_items")
      .select("sale_id, product_id, product_name, quantity, unit_price, total_price, cost_price")
      .in(
        "sale_id",
        sales.map((sale) => sale.id),
      );
    if (itemsError) throw itemsError;
    items = data ?? [];
  }

  const productIds = Array.from(
    new Set(
      [
        ...items.map((item) => item.product_id),
        ...returns.map((row) => row.product_id),
        ...damages.map((row) => row.product_id),
        ...reconciliations.map((row) => row.product_id),
      ].filter((id): id is string => id !== null),
    ),
  );

  const productInfoById = new Map<string, { categoryId: string | null }>();
  if (productIds.length > 0) {
    const { data: products, error: productsError } = await supabase
      .from("products")
      .select("id, category_id")
      .in("id", productIds);
    if (productsError) throw productsError;
    (products ?? []).forEach((product) => productInfoById.set(product.id, { categoryId: product.category_id }));
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
  const ensureBucket = (key: string, productId: string | null, productName: string, categoryId: string | null): Accumulator => {
    const existing = byKey.get(key);
    if (existing) return existing;
    const created: Accumulator = {
      productId,
      productName,
      categoryId,
      categoryName: categoryId ? (categoryNameById.get(categoryId) ?? UNCATEGORIZED_LABEL) : UNCATEGORIZED_LABEL,
      totalQuantity: 0,
      totalRevenue: 0,
      totalProfit: 0,
      revenueSharePercent: 0,
      saleCount: 0,
      totalReturnsValue: 0,
      totalDamageLoss: 0,
      totalReconciliationLoss: 0,
      saleIds: new Set(),
    };
    byKey.set(key, created);
    return created;
  };

  items.forEach((item) => {
    const key = productRankingKey(item.product_id, item.product_name);
    const info = item.product_id ? productInfoById.get(item.product_id) : undefined;
    const categoryId = info?.categoryId ?? null;
    const profit = (item.unit_price - item.cost_price) * item.quantity;

    const bucket = ensureBucket(key, item.product_id, item.product_name, categoryId);
    bucket.totalQuantity += item.quantity;
    bucket.totalRevenue += item.total_price;
    bucket.totalProfit += profit;
    bucket.saleIds.add(item.sale_id);
  });

  returns.forEach((row) => {
    const key = productRankingKey(row.product_id, row.product_name);
    const info = row.product_id ? productInfoById.get(row.product_id) : undefined;
    const categoryId = info?.categoryId ?? null;
    const bucket = ensureBucket(key, row.product_id, row.product_name, categoryId);
    bucket.totalReturnsValue += row.refund_amount;
    const line = saleItemById.get(row.sale_item_id);
    if (line) bucket.totalProfit -= (line.unit_price - line.cost_price) * row.quantity;
  });

  damages.forEach((row) => {
    const key = productRankingKey(row.product_id, row.product_name);
    const info = row.product_id ? productInfoById.get(row.product_id) : undefined;
    const categoryId = info?.categoryId ?? null;
    const bucket = ensureBucket(key, row.product_id, row.product_name, categoryId);
    bucket.totalDamageLoss += row.loss_amount;
    bucket.totalProfit -= row.loss_amount;
  });

  reconciliations.forEach((row) => {
    const key = productRankingKey(row.product_id, row.product_name);
    const info = row.product_id ? productInfoById.get(row.product_id) : undefined;
    const categoryId = info?.categoryId ?? null;
    const bucket = ensureBucket(key, row.product_id, row.product_name, categoryId);
    bucket.totalReconciliationLoss += row.loss_value;
    bucket.totalProfit -= row.loss_value;
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
      totalReturnsValue: stat.totalReturnsValue,
      totalDamageLoss: stat.totalDamageLoss,
      totalReconciliationLoss: stat.totalReconciliationLoss,
    }))
    .sort((a, b) => b.totalRevenue - a.totalRevenue);
}

export interface CategoryRankingStat {
  categoryId: string | null;
  categoryName: string;
  categoryColor: string;
  categoryIcon: string;
  totalQuantity: number;
  /** Deliberately GROSS at this per-category granularity — does not subtract returns. See totalReturnsValue. */
  totalRevenue: number;
  /** Nets against this category's returns-profit-reversal + damage loss in range — see getDailySalesSummary. */
  totalProfit: number;
  /** Share of this category's revenue out of the grand total for the range (0-100). 0 when there are no sales at all. */
  revenueSharePercent: number;
  /** Number of distinct invoices that included a product from this category. */
  saleCount: number;
  /** sum(returns.refund_amount) for this category's returns in range (by returns.created_at) — disclosed only, NOT subtracted from totalRevenue here (unlike the daily summary). */
  totalReturnsValue: number;
  /** sum(stock_damages.loss_amount) for this category in range — already subtracted from totalProfit. */
  totalDamageLoss: number;
  /** sum(stock_reconciliations.loss_value) for this category in range — already subtracted from totalProfit. Only shortages contribute; overages are 0. */
  totalReconciliationLoss: number;
}

/**
 * Full category ranking (no limit — caller paginates/sorts in the UI) for a
 * date range capped at MAX_RANGE_DAYS. Same sale_items fetch as
 * getProductRanking, additionally joined (client-side) against products →
 * categories to bucket revenue per category. Items whose product or category
 * can no longer be resolved (deleted / never assigned) are bucketed under
 * "أخرى". Profit comes from each sale_item's own snapshotted cost_price,
 * netted against this category's returns-profit-reversal and damage loss in
 * range (both keyed by their OWN created_at, not the original sale's day).
 * Revenue stays GROSS here (deliberate asymmetry vs. the daily summary) —
 * totalReturnsValue is disclosed as its own field instead of being netted in.
 */
export async function getCategoryRanking(supabase: Client, startDate: Date, endDate: Date): Promise<CategoryRankingStat[]> {
  assertRangeWithinLimit(startDate, endDate);

  const { data: sales, error: salesError } = await supabase
    .from("sales")
    .select("id")
    .gte("created_at", startDate.toISOString())
    .lte("created_at", endDate.toISOString());

  if (salesError) throw salesError;

  const { returns, saleItemById } = await getReturnsInRange(supabase, startDate, endDate);
  const damages = await getDamagesInRange(supabase, startDate, endDate);
  const reconciliations = await getReconciliationLossInRange(supabase, startDate, endDate);

  if ((!sales || sales.length === 0) && returns.length === 0 && damages.length === 0 && reconciliations.length === 0) return [];

  let items: { sale_id: string; product_id: string | null; quantity: number; unit_price: number; total_price: number; cost_price: number }[] = [];
  if (sales && sales.length > 0) {
    const { data, error: itemsError } = await supabase
      .from("sale_items")
      .select("sale_id, product_id, quantity, unit_price, total_price, cost_price")
      .in(
        "sale_id",
        sales.map((sale) => sale.id),
      );
    if (itemsError) throw itemsError;
    items = data ?? [];
  }

  const productIds = Array.from(
    new Set(
      [
        ...items.map((item) => item.product_id),
        ...returns.map((row) => row.product_id),
        ...damages.map((row) => row.product_id),
        ...reconciliations.map((row) => row.product_id),
      ].filter((id): id is string => id !== null),
    ),
  );

  const productInfoById = new Map<string, { categoryId: string | null }>();
  if (productIds.length > 0) {
    const { data: products, error: productsError } = await supabase
      .from("products")
      .select("id, category_id")
      .in("id", productIds);
    if (productsError) throw productsError;
    (products ?? []).forEach((product) => productInfoById.set(product.id, { categoryId: product.category_id }));
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
  const ensureBucket = (categoryId: string | null): Accumulator => {
    const key = categoryId ?? "__uncategorized__";
    const existing = byKey.get(key);
    if (existing) return existing;
    const category = categoryId ? categoryById.get(categoryId) : undefined;
    const created: Accumulator = {
      categoryId,
      categoryName: category?.name ?? UNCATEGORIZED_LABEL,
      categoryColor: category?.color ?? UNCATEGORIZED_COLOR,
      categoryIcon: category?.icon ?? UNCATEGORIZED_ICON,
      totalQuantity: 0,
      totalRevenue: 0,
      totalProfit: 0,
      revenueSharePercent: 0,
      saleCount: 0,
      totalReturnsValue: 0,
      totalDamageLoss: 0,
      totalReconciliationLoss: 0,
      saleIds: new Set(),
    };
    byKey.set(key, created);
    return created;
  };

  items.forEach((item) => {
    const info = item.product_id ? productInfoById.get(item.product_id) : undefined;
    const categoryId = info?.categoryId ?? null;
    const profit = (item.unit_price - item.cost_price) * item.quantity;

    const bucket = ensureBucket(categoryId);
    bucket.totalQuantity += item.quantity;
    bucket.totalRevenue += item.total_price;
    bucket.totalProfit += profit;
    bucket.saleIds.add(item.sale_id);
  });

  returns.forEach((row) => {
    const info = row.product_id ? productInfoById.get(row.product_id) : undefined;
    const categoryId = info?.categoryId ?? null;
    const bucket = ensureBucket(categoryId);
    bucket.totalReturnsValue += row.refund_amount;
    const line = saleItemById.get(row.sale_item_id);
    if (line) bucket.totalProfit -= (line.unit_price - line.cost_price) * row.quantity;
  });

  damages.forEach((row) => {
    const info = row.product_id ? productInfoById.get(row.product_id) : undefined;
    const categoryId = info?.categoryId ?? null;
    const bucket = ensureBucket(categoryId);
    bucket.totalDamageLoss += row.loss_amount;
    bucket.totalProfit -= row.loss_amount;
  });

  reconciliations.forEach((row) => {
    const info = row.product_id ? productInfoById.get(row.product_id) : undefined;
    const categoryId = info?.categoryId ?? null;
    const bucket = ensureBucket(categoryId);
    bucket.totalReconciliationLoss += row.loss_value;
    bucket.totalProfit -= row.loss_value;
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
      totalReturnsValue: stat.totalReturnsValue,
      totalDamageLoss: stat.totalDamageLoss,
      totalReconciliationLoss: stat.totalReconciliationLoss,
    }))
    .sort((a, b) => b.totalRevenue - a.totalRevenue);
}
