import { describe, expect, it } from "vitest";
import { enqueueSale, markConflict, markSynced, markSyncing, nextPendingSale } from "./outbox";
import type { PendingSale } from "@/types/offline";

const BASE_PAYLOAD: PendingSale["payload"] = {
  items: [{ productId: "p1", name: "منتج", barcode: "1111", unitPrice: 10, costPrice: 6, quantity: 1, availableStock: 8 }],
  discountAmount: 0,
  paidAmount: 10,
  cashierId: "cashier-1",
};

function makeSale(overrides: Partial<PendingSale> = {}): PendingSale {
  return {
    localId: "local-1",
    status: "pending",
    createdAt: "2026-08-07T10:00:00.000Z",
    payload: BASE_PAYLOAD,
    invoiceNumber: "INV-20260807-0001",
    storeId: "store-1",
    ...overrides,
  };
}

describe("enqueueSale", () => {
  it("appends the sale to the end of the outbox", () => {
    const existing = [makeSale({ localId: "local-1" })];
    const added = makeSale({ localId: "local-2" });
    expect(enqueueSale(existing, added)).toEqual([existing[0], added]);
  });

  it("does not mutate the original array", () => {
    const existing = [makeSale({ localId: "local-1" })];
    enqueueSale(existing, makeSale({ localId: "local-2" }));
    expect(existing).toHaveLength(1);
  });
});

describe("markSynced", () => {
  it("flips only the matching sale's status to synced", () => {
    const outbox = [makeSale({ localId: "local-1" }), makeSale({ localId: "local-2" })];
    const result = markSynced(outbox, "local-1");
    expect(result[0]?.status).toBe("synced");
    expect(result[1]?.status).toBe("pending");
  });
});

describe("markSyncing", () => {
  it("flips only the matching sale's status to syncing", () => {
    const outbox = [makeSale({ localId: "local-1" }), makeSale({ localId: "local-2" })];
    const result = markSyncing(outbox, "local-2");
    expect(result[0]?.status).toBe("pending");
    expect(result[1]?.status).toBe("syncing");
  });
});

describe("markConflict", () => {
  it("sets status to conflict and records the conflicts", () => {
    const outbox = [makeSale({ localId: "local-1" })];
    const conflicts = [{ productId: "p1", productName: "منتج", requestedBaseUnits: 5 }];
    const result = markConflict(outbox, "local-1", conflicts);
    expect(result[0]?.status).toBe("conflict");
    expect(result[0]?.conflicts).toEqual(conflicts);
  });
});

describe("nextPendingSale", () => {
  it("returns undefined when the outbox is empty", () => {
    expect(nextPendingSale([])).toBeUndefined();
  });

  it("returns undefined when no sale is pending", () => {
    const outbox = [makeSale({ localId: "local-1", status: "synced" })];
    expect(nextPendingSale(outbox)).toBeUndefined();
  });

  it("returns the oldest pending sale by createdAt, ignoring non-pending sales", () => {
    const newer = makeSale({ localId: "newer", createdAt: "2026-08-07T12:00:00.000Z" });
    const older = makeSale({ localId: "older", createdAt: "2026-08-07T09:00:00.000Z" });
    const synced = makeSale({ localId: "synced-one", createdAt: "2026-08-07T08:00:00.000Z", status: "synced" });
    const result = nextPendingSale([newer, synced, older]);
    expect(result?.localId).toBe("older");
  });
});
