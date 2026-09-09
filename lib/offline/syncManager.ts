import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { decrementStock } from "@/services/products.service";
import { createSale } from "@/services/sales.service";
import { holdSale } from "@/services/heldSales.service";
import { toBaseUnits } from "@/lib/units";
import { getHeldSalesOutbox, getOutbox, setHeldSalesOutbox, setOutbox } from "@/lib/offline/db";
import {
  markConflict,
  markHeldSaleSynced,
  markHeldSaleSyncing,
  markPartial,
  markSynced,
  markSyncing,
  resetStaleHeldSyncing,
  resetStaleSyncing,
} from "@/lib/offline/outbox";
import type { PendingSale } from "@/types/offline";

type Client = SupabaseClient<Database>;

/**
 * Thrown by decrementStockForSale when a line item's decrementStock call
 * fails AFTER at least one earlier line item already succeeded (real stock
 * reduced for that earlier line, no way to know from here whether it's safe
 * to retry from scratch). Callers must treat this differently from a plain
 * throw on the FIRST line item, where nothing has been decremented yet and
 * the old "reset to pending, retry" behavior is still safe — see audit item #9.
 */
class PartialStockDecrementError extends Error {
  constructor(public readonly cause: unknown) {
    super("stock partially decremented before a later line item failed");
  }
}

export interface SyncResult {
  syncedCount: number;
  conflictCount: number;
  syncedHeldCount: number;
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
  if (isSyncing) return { syncedCount: 0, conflictCount: 0, syncedHeldCount: 0 };
  isSyncing = true;

  let syncedCount = 0;
  let conflictCount = 0;
  let syncedHeldCount = 0;

  try {
    let outbox = await getOutbox();
    const pending = outbox
      .filter((sale) => sale.status === "pending")
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    for (const sale of pending) {
      outbox = markSyncing(outbox, sale.localId);
      await setOutbox(outbox);

      let stockDecremented = false;

      try {
        const conflicts = await decrementStockForSale(supabase, sale);
        stockDecremented = true;

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
      } catch (err) {
        // Unexpected error (e.g. network dropped mid-replay). Real stock
        // may already have been decremented for this sale — either
        // decrementStockForSale itself returned successfully (stockDecremented
        // = true) and the failure happened in the later createSale call, or
        // decrementStockForSale threw PartialStockDecrementError because an
        // earlier line item succeeded before a later one failed mid-loop. In
        // either case, blindly resetting to "pending" would re-run
        // decrementStockForSale from scratch and decrement the same real
        // stock a second time (audit item #9) — so mark "partial" instead so
        // a human reviews it, and stop retrying it automatically. Only reset
        // to "pending" (old item-8 behavior) when nothing was decremented
        // yet, e.g. decrementStock threw on the very first line item.
        const anyStockDecremented = stockDecremented || err instanceof PartialStockDecrementError;
        outbox = anyStockDecremented ? markPartial(outbox, sale.localId) : resetStaleSyncing(outbox);
        await setOutbox(outbox);
        break;
      }
    }

    // Held-sale (تعليق) replay runs AFTER sales replay above completes.
    // Holding never touches stock (see types/offline.ts), so there's no
    // conflict path here — just insert the snapshot row via the same
    // holdSale() the online path uses.
    let heldOutbox = await getHeldSalesOutbox();
    const pendingHeld = heldOutbox
      .filter((sale) => sale.status === "pending")
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    for (const sale of pendingHeld) {
      heldOutbox = markHeldSaleSyncing(heldOutbox, sale.localId);
      await setHeldSalesOutbox(heldOutbox);

      try {
        await holdSale(
          supabase,
          {
            cashierId: sale.cashierId,
            items: sale.items,
            discountAmount: sale.discountAmount,
            note: sale.note,
          },
          sale.storeId,
        );

        heldOutbox = markHeldSaleSynced(heldOutbox, sale.localId);
        await setHeldSalesOutbox(heldOutbox);
        syncedHeldCount += 1;
      } catch {
        // Same handling as the sales loop above: reset this held sale
        // (marked "syncing" above) back to "pending" and stop this phase,
        // leaving remaining held sales pending for the next sync attempt.
        heldOutbox = resetStaleHeldSyncing(heldOutbox);
        await setHeldSalesOutbox(heldOutbox);
        break;
      }
    }
  } finally {
    isSyncing = false;
  }

  return { syncedCount, conflictCount, syncedHeldCount };
}

/**
 * Decrements real stock for every line in an offline sale via the same
 * decrementStock RPC the online path uses. If a line fails (insufficient
 * real stock), the lines that already succeeded are NOT rolled back —
 * they're a legitimate sale of the stock that did exist; rolling back would
 * reintroduce the same race window this guards against. Returns the list of
 * lines that failed (empty = every line succeeded).
 *
 * If a later line item's decrementStock call throws (e.g. network dropped
 * mid-loop) AFTER an earlier line item already succeeded, this throws
 * PartialStockDecrementError instead of letting the raw error propagate, so
 * the caller can tell "some real stock was already decremented, do not
 * blindly retry from scratch" apart from a throw on the very first line
 * (nothing decremented yet, safe to treat as before) — see audit item #9.
 */
async function decrementStockForSale(
  supabase: Client,
  sale: PendingSale,
): Promise<{ productId: string; productName: string; requestedBaseUnits: number }[]> {
  const conflicts: { productId: string; productName: string; requestedBaseUnits: number }[] = [];
  let anyDecremented = false;

  for (const item of sale.payload.items) {
    const baseUnits = toBaseUnits(item.quantity, item.unitConversionFactor);
    let updated: Awaited<ReturnType<typeof decrementStock>>;
    try {
      updated = await decrementStock(supabase, item.productId, baseUnits);
    } catch (err) {
      if (anyDecremented) {
        throw new PartialStockDecrementError(err);
      }
      throw err;
    }

    if (!updated) {
      conflicts.push({ productId: item.productId, productName: item.name, requestedBaseUnits: baseUnits });
      break;
    }
    anyDecremented = true;
  }

  return conflicts;
}
