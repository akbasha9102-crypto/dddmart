import type { CartItem, CheckoutPayload } from "@/types/pos";

/** Base-unit delta already applied optimistically to the local product cache; negative = decrement. */
export interface PendingStockOp {
  productId: string;
  baseUnitsDelta: number;
}

/**
 * A checkout that happened while offline, queued in IndexedDB until the
 * connection returns. `payload` reuses the existing CheckoutPayload shape
 * (types/pos.ts) rather than inventing a parallel one — see
 * services/sales.service.ts#createSale for how payload.id/invoiceNumber let
 * a synced sale keep the identity the cashier's receipt already showed.
 */
export interface PendingSale {
  /** Client-generated id (crypto.randomUUID()), used as the outbox key and as the sale's id when synced. */
  localId: string;
  /**
   * "partial" is no longer produced going forward — it dates from when
   * offline sale replay decremented stock in a separate pre-flight step
   * before persisting the sale (audit item #9), which could leave real
   * stock decremented with no sale record if it failed mid-way. As of
   * supabase/migrations/00000000000042_checkout_time_stock_decrement.sql,
   * create_sale_atomic (called via createSale, see lib/offline/
   * syncManager.ts) does the stock check-and-decrement AND the sale insert
   * in one atomic transaction, so that partial state can no longer occur —
   * any failure now safely resets to "pending" for retry. This status is
   * kept in the union (not deleted) purely so already-queued outbox data on
   * a cashier's device from before this change can still be displayed
   * correctly; nothing in the codebase sets it anymore. Distinct from
   * "conflict" (insufficient stock is a normal business outcome).
   */
  status: "pending" | "syncing" | "conflict" | "synced" | "partial";
  createdAt: string; // ISO, used for FIFO replay order and receipt display
  payload: CheckoutPayload;
  invoiceNumber: string; // generated locally at checkout time so the receipt can show it immediately
  /** The cashier's store_id at the moment this sale was queued (AuthContext, cached from the last online session) — replayed as-is by syncManager.ts, not re-resolved from "whoever happens to be online now". */
  storeId: string;
  conflicts?: { productId: string; productName: string; requestedBaseUnits: number }[];
  /**
   * Set only when this sale synced successfully (status stays "synced" — the
   * server recorded it correctly and it needs no retry/reconciliation) but
   * the total the offline receipt showed the cashier/customer, computed from
   * the locally cached product prices at checkout time, differs from the
   * server-authoritative total_amount that create_sale_atomic actually
   * recorded (it always recomputes price/total server-side from the live
   * products table, ignoring any client-sent price — see audit item #3).
   * This is a loss-prevention/reporting signal only: it does not mean the
   * sale itself is broken, incomplete, or needs retrying — the recorded
   * amount is correct and final. A human should review whether the
   * discrepancy was honest price staleness or a cashier undercharging a
   * customer while the till/receipt showed a different (lower) amount.
   */
  priceMismatch?: { offlineTotal: number; serverTotal: number };
}

/**
 * A "hold sale" (تعليق) that happened while offline, queued in IndexedDB
 * until the connection returns. As of
 * supabase/migrations/00000000000043_hold_sale_stock_decrement.sql, hold_sale
 * atomically reserves stock per line at hold time (row-locked
 * check-and-decrement, same pattern as create_sale_atomic) — so unlike
 * before that migration, replaying a queued held sale CAN now hit a genuine
 * insufficient-stock conflict, surfaced via the "conflict" status below
 * (see lib/offline/syncManager.ts's isInsufficientStockError handling and
 * markHeldSaleConflict in lib/offline/outbox.ts).
 */
export interface PendingHeldSale {
  /** Client-generated id (crypto.randomUUID()), used as the outbox key. */
  localId: string;
  status: "pending" | "syncing" | "conflict" | "synced";
  createdAt: string; // ISO, used for FIFO replay order and list display
  cashierId: string | null;
  items: CartItem[];
  discountAmount: number;
  note: string | null;
  /** The cashier's store_id at the moment this held sale was queued — replayed as-is by syncManager.ts, same convention as PendingSale.storeId. */
  storeId: string;
}
