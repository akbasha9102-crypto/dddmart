import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { Product } from "@/types/product";
import { getLowStockProducts } from "@/services/products.service";
import { logOperation } from "@/services/archive.service";

type Client = SupabaseClient<Database>;

/** Manual stock correction (e.g. after a physical count or damaged goods). */
export async function adjustStock(
  supabase: Client,
  productId: string,
  delta: number,
  actorId: string | null,
): Promise<Product> {
  const { data: current, error: fetchError } = await supabase
    .from("products")
    .select("quantity")
    .eq("id", productId)
    .single();

  if (fetchError) throw fetchError;

  const { data, error } = await supabase
    .from("products")
    .update({ quantity: Math.max(current.quantity + delta, 0) })
    .eq("id", productId)
    .select()
    .single();

  if (error) throw error;

  await logOperation(supabase, {
    userId: actorId,
    actionType: "stock_adjusted",
    entityType: "stock",
    entityId: data.id,
    description: `تم تعديل مخزون "${data.name}" بمقدار ${delta > 0 ? "+" : ""}${delta}`,
  });

  return data;
}

export async function getLowStockAlerts(supabase: Client): Promise<Product[]> {
  return getLowStockProducts(supabase);
}
