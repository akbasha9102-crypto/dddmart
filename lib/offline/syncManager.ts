import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { isUniqueViolation } from "@/services/products.service";
import { createSale } from "@/services/sales.service";
import { holdSale } from "@/services/heldSales.service";
import { calculateTotals } from "@/types/pos";
import { getHeldSalesOutbox, getOutbox, setHeldSalesOutbox, setOutbox } from "@/lib/offline/db";
import {
  markConflict,
  markHeldSaleConflict,
  markHeldSaleSynced,
  markHeldSaleSyncing,
  markPriceMismatch,
  markSynced,
  markSyncing,
  resetStaleHeldSyncing,
  resetStaleSyncing,
} from "@/lib/offline/outbox";

type Client = SupabaseClient<Database>;

/**
 * True for a Postgres exception raised by create_sale_atomic/hold_sale's
 * insufficient-stock check (supabase/migrations/00000000000042_checkout_time_
 * stock_decrement.sql / 00000000000043_hold_sale_stock_decrement.sql) —
 * matched on the stable Arabic suffix both RPCs raise verbatim
 * ('الكمية المتوفرة من % غير كافية'). Postgres prepends framing (e.g.
 * "ERROR:") to a raised exception's message, so this is a substring match,
 * not a full-string match — same pattern as isSalesPkeyViolation below.
 */
function isInsufficientStockError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "message" in err &&
    typeof (err as { message?: unknown }).message === "string" &&
    (err as { message: string }).message.includes("غير كافية")
  );
}

/**
 * True only for a Postgres 23505 (unique_violation) that names the
 * `sales_pkey` constraint specifically — see audit item #10. `sales` also
 * has a unique (store_id, invoice_number) constraint that can collide
 * between two different, never-persisted sales (generateInvoiceNumber() in
 * lib/utils.ts only has a 4-digit random suffix per day), so a bare 23505
 * code is not enough evidence that this exact sale already synced.
 */
function isSalesPkeyViolation(err: unknown): boolean {
  return (
    isUniqueViolation(err) &&
    typeof err === "object" &&
    err !== null &&
    "message" in err &&
    typeof (err as { message?: unknown }).message === "string" &&
    (err as { message: string }).message.includes("sales_pkey")
  );
}

/**
 * True only for a Postgres 23505 (unique_violation) that names the
 * `held_sales_client_local_id_key` constraint specifically — see audit item
 * #11. Unlike `sales` (which also has a unique (store_id, invoice_number)
 * constraint that a genuine, different sale could collide on), held_sales
 * has no other unique constraint besides its primary key (server-generated,
 * never client-supplied, so it can't collide here) — so this narrowing is
 * currently defensive-only, not resolving a real ambiguity, but is kept for
 * consistency with isSalesPkeyViolation's pattern and in case a future
 * unique constraint is ever added to this table.
 */
function isHeldSaleClientLocalIdViolation(err: unknown): boolean {
  return (
    isUniqueViolation(err) &&
    typeof err === "object" &&
    err !== null &&
    "message" in err &&
    typeof (err as { message?: unknown }).message === "string" &&
    (err as { message: string }).message.includes("held_sales_client_local_id_key")
  );
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
 * For each pending sale, calls the exact same createSale used by the online
 * checkout path (services/sales.service.ts) — there is only one
 * implementation of "how a sale is persisted", online or replayed. There is
 * no separate stock pre-flight step anymore: create_sale_atomic (called
 * inside createSale) now does the stock check-and-decrement AND the
 * sale/sale_items insert atomically, in one transaction — see
 * supabase/migrations/00000000000042_checkout_time_stock_decrement.sql.
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

      try {
        const persisted = await createSale(
          supabase,
          {
            ...sale.payload,
            id: sale.localId,
            invoiceNumber: sale.invoiceNumber,
          },
          sale.storeId,
        );

        // Audit item #3: the offline receipt shown to the cashier/customer
        // was computed from the locally cached (possibly stale, or
        // DevTools-tampered — separately closed, out of scope) product
        // price via the same calculateTotals() the online checkout UI
        // uses. create_sale_atomic (called inside createSale above) always
        // recomputes price/total server-side from the live products table
        // and ignores this offline total entirely for the actual charge —
        // so the recorded sale.total_amount is always correct. This is
        // purely a detection step to flag when the two numbers diverged,
        // for human review (honest staleness vs. a cashier undercharging a
        // customer). 0.01 tolerance matches total_amount's numeric(12,2)
        // column — never more than 2 decimal places server-side, so any
        // gap beyond a cent is a genuine mismatch, not float noise.
        const offlineTotal = calculateTotals(sale.payload.items, sale.payload.discountAmount).totalAmount;
        const serverTotal = persisted.sale.total_amount;
        if (Math.abs(offlineTotal - serverTotal) > 0.01) {
          outbox = markPriceMismatch(outbox, sale.localId, { offlineTotal, serverTotal });
        }

        outbox = markSynced(outbox, sale.localId);
        await setOutbox(outbox);
        syncedCount += 1;
      } catch (err) {
        // A 23505 (unique_violation) specifically on the `sales_pkey`
        // constraint means this exact sale (sales.id === sale.localId, via
        // create_sale_atomic's p_client_sale_id) already exists server-side
        // — an earlier createSale call for this same localId already
        // succeeded and only the response was lost (e.g. a cross-tab race
        // on the same still-"pending" sale; isSyncing above only guards
        // this tab — see audit item #12, out of scope here). Nothing to
        // reconcile: mark "synced" and move on to the rest of the batch.
        //
        // Deliberately narrow to sales_pkey by name: `sales` ALSO has a
        // unique (store_id, invoice_number) constraint, and
        // generateInvoiceNumber() (lib/utils.ts) only has a 4-digit random
        // suffix per day — a genuine collision between two DIFFERENT,
        // never-persisted sales is realistically possible in a busy store.
        // Treating ANY 23505 as "already synced" would risk silently
        // dropping a real sale that never actually saved. Only the PK
        // collision is unambiguous proof this exact sale succeeded — any
        // other 23505 falls through to the existing conflict/pending logic
        // below, same as before — see audit item #10.
        if (isSalesPkeyViolation(err)) {
          outbox = markSynced(outbox, sale.localId);
          await setOutbox(outbox);
          syncedCount += 1;
          continue;
        }

        // An insufficient-stock exception from create_sale_atomic (see
        // migration 42) — real business outcome, not a transient failure:
        // between this sale being queued offline and now, the requested
        // stock genuinely ran out (sold elsewhere, damaged, etc). Not safe
        // (or useful) to blindly retry, so mark "conflict" for a human to
        // reconcile, same status/reducer already used elsewhere in this
        // file, and stop this phase.
        if (isInsufficientStockError(err)) {
          outbox = markConflict(outbox, sale.localId, undefined);
          await setOutbox(outbox);
          conflictCount += 1;
          break;
        }

        // Any other error (network drop, unknown) resets this sale back to
        // "pending" for a later retry. This is now ALWAYS safe, unlike
        // before this migration: create_sale_atomic is one atomic Postgres
        // transaction — the stock decrement and the sale/sale_items insert
        // either both happen or neither does, so there is no more
        // partial-decrement state that would make a blind retry unsafe (the
        // old "partial" status/audit-item-#9 machinery this replaced is no
        // longer produced by this loop — see markPartial's remaining
        // doc/type comments for why the status itself is kept, not removed).
        outbox = resetStaleSyncing(outbox);
        await setOutbox(outbox);
        break;
      }
    }

    // Held-sale (تعليق) replay runs AFTER sales replay above completes.
    // hold_sale now ALSO atomically reserves stock per line (see
    // supabase/migrations/00000000000043_hold_sale_stock_decrement.sql), so
    // — unlike before that migration — a held-sale replay CAN hit a genuine
    // insufficient-stock conflict here, handled the same way as the sales
    // loop above (markHeldSaleConflict instead of silently retrying
    // forever).
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
            clientLocalId: sale.localId,
          },
          sale.storeId,
        );

        heldOutbox = markHeldSaleSynced(heldOutbox, sale.localId);
        await setHeldSalesOutbox(heldOutbox);
        syncedHeldCount += 1;
      } catch (err) {
        // A 23505 specifically on held_sales_client_local_id_key means this
        // exact held sale (held_sales.client_local_id === sale.localId)
        // already exists server-side — an earlier holdSale call for this
        // same localId already succeeded and only the response was lost.
        // Nothing to reconcile: mark "synced" and move on — see audit item
        // #11 (mirrors isSalesPkeyViolation's pattern above for item #10).
        if (isHeldSaleClientLocalIdViolation(err)) {
          heldOutbox = markHeldSaleSynced(heldOutbox, sale.localId);
          await setHeldSalesOutbox(heldOutbox);
          syncedHeldCount += 1;
          continue;
        }

        // An insufficient-stock exception from hold_sale (migration 43) —
        // same reasoning as the sales loop's isInsufficientStockError branch
        // above: a real business outcome, not safe to silently retry.
        // markHeldSaleConflict already existed (previously unreachable, per
        // its own doc comment, since holding never used to touch stock) —
        // wired up here now that it can actually happen.
        if (isInsufficientStockError(err)) {
          heldOutbox = markHeldSaleConflict(heldOutbox, sale.localId);
          await setHeldSalesOutbox(heldOutbox);
          break;
        }

        // Any other error (network drop, unknown): reset this held sale
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
