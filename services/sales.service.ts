import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { CheckoutPayload, CompletedSale, Sale, SaleItem, SaleItemInsert } from "@/types/pos";
import { calculateTotals } from "@/types/pos";
import { generateInvoiceNumber } from "@/lib/utils";

type Client = SupabaseClient<Database>;

/**
 * Persists a completed cash sale: the invoice header, its line items, and the
 * resulting stock decrement. Not wrapped in a DB transaction (no RPC layer
 * yet) — acceptable for a single-till MVP, revisit before multi-till rollout.
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

  await Promise.all(
    payload.items.map((item) =>
      supabase
        .from("products")
        .update({ quantity: Math.max(item.availableStock - item.quantity, 0) })
        .eq("id", item.productId),
    ),
  );

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
