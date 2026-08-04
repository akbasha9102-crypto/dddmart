import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { CheckoutPayload, CompletedSale, SaleItemInsert } from "@/types/pos";
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

export async function getDailySales(supabase: Client, date: Date) {
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
