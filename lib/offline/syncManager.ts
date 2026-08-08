import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { decrementStock } from "@/services/products.service";
import { createSale } from "@/services/sales.service";
import { toBaseUnits } from "@/lib/units";
import { getOutbox, setOutbox } from "@/lib/offline/db";
import { markConflict, markSynced, markSyncing } from "@/lib/offline/outbox";
import type { PendingSale } from "@/types/offline";

type Client = SupabaseClient<Database>;

export interface SyncResult {
  syncedCount: number;
  conflictCount: number;
}

// Prevents concurrent replay runs from a reconnect event firing while a
// manual "sync now" (or a previous reconnect) is already in flight.
let isSyncing = false;

/**
 * Replays queued offline sales against Supabase, oldest first (FIFO), one
 * at a time — sequential on purpose: a just-reconnected link can be flaky,
 * and order must be preserved.
 *
 * For each pending sale, calls the exact same decrementStock/createSale
 * used by the online checkout path (services/products.service.ts,
 * services/sales.service.ts) — there is only one implementation of "how a
 * stock decrement is validated" or "how a sale is persisted", online or
 * replayed.
 */
export async function syncOutbox(supabase: Client): Promise<SyncResult> {
  if (isSyncing) return { syncedCount: 0, conflictCount: 0 };
  isSyncing = true;

  let syncedCount = 0;
  let conflictCount = 0;

  try {
    let outbox = await getOutbox();
    const pending = outbox
      .filter((sale) => sale.status === "pending")
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    for (const sale of pending) {
      outbox = markSyncing(outbox, sale.localId);
      await setOutbox(outbox);

      try {
        const conflicts = await decrementStockForSale(supabase, sale);

        if (conflicts.length > 0) {
          outbox = markConflict(outbox, sale.localId, conflicts);
          await setOutbox(outbox);
          conflictCount += 1;
          continue;
        }

        await createSale(
          supabase,
          {
            ...sale.payload,
            id: sale.localId,
            invoiceNumber: sale.invoiceNumber,
          },
          sale.storeId,
        );

        outbox = markSynced(outbox, sale.localId);
        await setOutbox(outbox);
        syncedCount += 1;
      } catch {
        // Unexpected error (e.g. network dropped mid-replay): stop the
        // whole run, leave this sale (and everything after it) pending so
        // the next online event or manual retry resumes from here.
        break;
      }
    }
  } finally {
    isSyncing = false;
  }

  return { syncedCount, conflictCount };
}

/**
 * Decrements real stock for every line in an offline sale via the same
 * decrementStock RPC the online path uses. If a line fails (insufficient
 * real stock), the lines that already succeeded are NOT rolled back —
 * they're a legitimate sale of the stock that did exist; rolling back would
 * reintroduce the same race window this guards against. Returns the list of
 * lines that failed (empty = every line succeeded).
 */
async function decrementStockForSale(
  supabase: Client,
  sale: PendingSale,
): Promise<{ productId: string; productName: string; requestedBaseUnits: number }[]> {
  const conflicts: { productId: string; productName: string; requestedBaseUnits: number }[] = [];

  for (const item of sale.payload.items) {
    const baseUnits = toBaseUnits(item.quantity, item.unitConversionFactor);
    const updated = await decrementStock(supabase, item.productId, baseUnits);
    if (!updated) {
      conflicts.push({ productId: item.productId, productName: item.name, requestedBaseUnits: baseUnits });
      break;
    }
  }

  return conflicts;
}
