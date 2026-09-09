import type { PendingHeldSale, PendingSale } from "@/types/offline";
import { getHeldSalesOutbox, getOutbox, setHeldSalesOutbox, setOutbox } from "@/lib/offline/db";

/**
 * Pure outbox reducer functions — plain array in, plain array out, no
 * IndexedDB — so they're unit-testable the same way the rest of this repo
 * tests its logic (see services/products.service.test.ts). The thin IO
 * wrappers below call getOutbox()/setOutbox() around these.
 */

export function enqueueSale(outbox: PendingSale[], sale: PendingSale): PendingSale[] {
  return [...outbox, sale];
}

export function markSynced(outbox: PendingSale[], localId: string): PendingSale[] {
  return outbox.map((sale) => (sale.localId === localId ? { ...sale, status: "synced" as const } : sale));
}

/**
 * Attaches a priceMismatch flag to an already-"synced" sale — see audit
 * item #3 and types/offline.ts. Deliberately does NOT change `status`: the
 * sale synced correctly and needs no retry/reconciliation, so status stays
 * "synced". This only adds an independent reporting fact for
 * OfflineConflictModal to surface.
 */
export function markPriceMismatch(
  outbox: PendingSale[],
  localId: string,
  priceMismatch: NonNullable<PendingSale["priceMismatch"]>,
): PendingSale[] {
  return outbox.map((sale) => (sale.localId === localId ? { ...sale, priceMismatch } : sale));
}

export function markConflict(outbox: PendingSale[], localId: string, conflicts: PendingSale["conflicts"]): PendingSale[] {
  return outbox.map((sale) =>
    sale.localId === localId ? { ...sale, status: "conflict" as const, conflicts } : sale,
  );
}

/**
 * Marks a sale "partial": real stock was already decremented (fully or for
 * some line items) but the sale record itself was never persisted, and it's
 * no longer safe to auto-retry (retrying would decrement the same stock
 * again). Unlike markConflict, there's no extra per-line detail to attach —
 * the whole point is that we don't know the exact state, a human needs to
 * look. See audit item #9.
 */
export function markPartial(outbox: PendingSale[], localId: string): PendingSale[] {
  return outbox.map((sale) => (sale.localId === localId ? { ...sale, status: "partial" as const } : sale));
}

export function markSyncing(outbox: PendingSale[], localId: string): PendingSale[] {
  return outbox.map((sale) => (sale.localId === localId ? { ...sale, status: "syncing" as const } : sale));
}

export function resetStaleSyncing(outbox: PendingSale[]): PendingSale[] {
  return outbox.map((sale) => (sale.status === "syncing" ? { ...sale, status: "pending" as const } : sale));
}

/** Oldest by createdAt with status "pending" — FIFO replay order. */
export function nextPendingSale(outbox: PendingSale[]): PendingSale | undefined {
  return outbox
    .filter((sale) => sale.status === "pending")
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())[0];
}

export async function addPendingSale(sale: PendingSale): Promise<void> {
  const outbox = await getOutbox();
  await setOutbox(enqueueSale(outbox, sale));
}

export async function getPendingSales(): Promise<PendingSale[]> {
  return getOutbox();
}

/**
 * Pure outbox reducers for held sales (تعليق queued while offline) —
 * mirrors the sale reducers above one-for-one. See types/offline.ts for why
 * "conflict" is unreachable here (holding never touches stock) but kept for
 * type parity with PendingSale.
 */

export function enqueueHeldSale(outbox: PendingHeldSale[], sale: PendingHeldSale): PendingHeldSale[] {
  return [...outbox, sale];
}

export function markHeldSaleSynced(outbox: PendingHeldSale[], localId: string): PendingHeldSale[] {
  return outbox.map((sale) => (sale.localId === localId ? { ...sale, status: "synced" as const } : sale));
}

export function markHeldSaleConflict(outbox: PendingHeldSale[], localId: string): PendingHeldSale[] {
  return outbox.map((sale) => (sale.localId === localId ? { ...sale, status: "conflict" as const } : sale));
}

export function markHeldSaleSyncing(outbox: PendingHeldSale[], localId: string): PendingHeldSale[] {
  return outbox.map((sale) => (sale.localId === localId ? { ...sale, status: "syncing" as const } : sale));
}

export function resetStaleHeldSyncing(outbox: PendingHeldSale[]): PendingHeldSale[] {
  return outbox.map((sale) => (sale.status === "syncing" ? { ...sale, status: "pending" as const } : sale));
}

/** Oldest by createdAt with status "pending" — FIFO replay order. */
export function nextPendingHeldSale(outbox: PendingHeldSale[]): PendingHeldSale | undefined {
  return outbox
    .filter((sale) => sale.status === "pending")
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())[0];
}

export function removeHeldSale(outbox: PendingHeldSale[], localId: string): PendingHeldSale[] {
  return outbox.filter((sale) => sale.localId !== localId);
}

export async function addPendingHeldSale(sale: PendingHeldSale): Promise<void> {
  const outbox = await getHeldSalesOutbox();
  await setHeldSalesOutbox(enqueueHeldSale(outbox, sale));
}

export async function getPendingHeldSales(): Promise<PendingHeldSale[]> {
  return getHeldSalesOutbox();
}

export async function removePendingHeldSale(localId: string): Promise<void> {
  const outbox = await getHeldSalesOutbox();
  await setHeldSalesOutbox(removeHeldSale(outbox, localId));
}

export async function resetStaleSyncingSales(): Promise<void> {
  const outbox = await getOutbox();
  await setOutbox(resetStaleSyncing(outbox));
}

export async function resetStaleSyncingHeldSales(): Promise<void> {
  const outbox = await getHeldSalesOutbox();
  await setHeldSalesOutbox(resetStaleHeldSyncing(outbox));
}
