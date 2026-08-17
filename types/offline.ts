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
  status: "pending" | "syncing" | "conflict" | "synced";
  createdAt: string; // ISO, used for FIFO replay order and receipt display
  payload: CheckoutPayload;
  invoiceNumber: string; // generated locally at checkout time so the receipt can show it immediately
  /** The cashier's store_id at the moment this sale was queued (AuthContext, cached from the last online session) — replayed as-is by syncManager.ts, not re-resolved from "whoever happens to be online now". */
  storeId: string;
  conflicts?: { productId: string; productName: string; requestedBaseUnits: number }[];
}

/**
 * A "hold sale" (تعليق) that happened while offline, queued in IndexedDB
 * until the connection returns. Unlike PendingSale, holding never touches
 * stock — items were already decremented at add-to-cart time (see
 * hooks/usePOS.ts / services/heldSales.service.ts#holdSale) — so there is
 * no stock-mutation risk and the "conflict" status is structurally
 * unreachable here. It's kept anyway for type parity with PendingSale (same
 * status union, same syncManager.ts patterns) rather than carving out a
 * narrower type just for this one field.
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
