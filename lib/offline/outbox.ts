import type { PendingSale } from "@/types/offline";
import { getOutbox, setOutbox } from "@/lib/offline/db";

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

export function markConflict(outbox: PendingSale[], localId: string, conflicts: PendingSale["conflicts"]): PendingSale[] {
  return outbox.map((sale) =>
    sale.localId === localId ? { ...sale, status: "conflict" as const, conflicts } : sale,
  );
}

export function markSyncing(outbox: PendingSale[], localId: string): PendingSale[] {
  return outbox.map((sale) => (sale.localId === localId ? { ...sale, status: "syncing" as const } : sale));
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
