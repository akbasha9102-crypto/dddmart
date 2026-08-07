import type { CheckoutPayload } from "@/types/pos";

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
  conflicts?: { productId: string; productName: string; requestedBaseUnits: number }[];
}
