import { describe, expect, it } from "vitest";
import {
  enqueueHeldSale,
  enqueueSale,
  markConflict,
  markHeldSaleConflict,
  markHeldSaleSynced,
  markHeldSaleSyncing,
  markSynced,
  markSyncing,
  nextPendingHeldSale,
  nextPendingSale,
  removeHeldSale,
} from "./outbox";
import type { PendingHeldSale, PendingSale } from "@/types/offline";

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

const BASE_HELD_ITEMS: PendingHeldSale["items"] = [
  { productId: "p1", name: "منتج", barcode: "1111", unitPrice: 10, costPrice: 6, quantity: 1, availableStock: 8 },
];

function makeHeldSale(overrides: Partial<PendingHeldSale> = {}): PendingHeldSale {
  return {
    localId: "held-local-1",
    status: "pending",
    createdAt: "2026-08-07T10:00:00.000Z",
    cashierId: "cashier-1",
    items: BASE_HELD_ITEMS,
    discountAmount: 0,
    note: null,
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

describe("enqueueHeldSale", () => {
  it("appends the held sale to the end of the outbox", () => {
    const existing = [makeHeldSale({ localId: "held-local-1" })];
    const added = makeHeldSale({ localId: "held-local-2" });
    expect(enqueueHeldSale(existing, added)).toEqual([existing[0], added]);
  });

  it("does not mutate the original array", () => {
    const existing = [makeHeldSale({ localId: "held-local-1" })];
    enqueueHeldSale(existing, makeHeldSale({ localId: "held-local-2" }));
    expect(existing).toHaveLength(1);
  });
});

describe("markHeldSaleSynced", () => {
  it("flips only the matching held sale's status to synced", () => {
    const outbox = [makeHeldSale({ localId: "held-local-1" }), makeHeldSale({ localId: "held-local-2" })];
    const result = markHeldSaleSynced(outbox, "held-local-1");
    expect(result[0]?.status).toBe("synced");
    expect(result[1]?.status).toBe("pending");
  });
});

describe("markHeldSaleSyncing", () => {
  it("flips only the matching held sale's status to syncing", () => {
    const outbox = [makeHeldSale({ localId: "held-local-1" }), makeHeldSale({ localId: "held-local-2" })];
    const result = markHeldSaleSyncing(outbox, "held-local-2");
    expect(result[0]?.status).toBe("pending");
    expect(result[1]?.status).toBe("syncing");
  });
});

describe("markHeldSaleConflict", () => {
  it("sets status to conflict on only the matching held sale", () => {
    const outbox = [makeHeldSale({ localId: "held-local-1" }), makeHeldSale({ localId: "held-local-2" })];
    const result = markHeldSaleConflict(outbox, "held-local-1");
    expect(result[0]?.status).toBe("conflict");
    expect(result[1]?.status).toBe("pending");
  });
});

describe("nextPendingHeldSale", () => {
  it("returns undefined when the outbox is empty", () => {
    expect(nextPendingHeldSale([])).toBeUndefined();
  });

  it("returns undefined when no held sale is pending", () => {
    const outbox = [makeHeldSale({ localId: "held-local-1", status: "synced" })];
    expect(nextPendingHeldSale(outbox)).toBeUndefined();
  });

  it("returns the oldest pending held sale by createdAt, ignoring non-pending held sales", () => {
    const newer = makeHeldSale({ localId: "newer", createdAt: "2026-08-07T12:00:00.000Z" });
    const older = makeHeldSale({ localId: "older", createdAt: "2026-08-07T09:00:00.000Z" });
    const synced = makeHeldSale({ localId: "synced-one", createdAt: "2026-08-07T08:00:00.000Z", status: "synced" });
    const result = nextPendingHeldSale([newer, synced, older]);
    expect(result?.localId).toBe("older");
  });
});

describe("removeHeldSale", () => {
  it("removes only the matching held sale", () => {
    const outbox = [makeHeldSale({ localId: "held-local-1" }), makeHeldSale({ localId: "held-local-2" })];
    const result = removeHeldSale(outbox, "held-local-1");
    expect(result).toEqual([outbox[1]]);
  });

  it("does not mutate the original array", () => {
    const outbox = [makeHeldSale({ localId: "held-local-1" }), makeHeldSale({ localId: "held-local-2" })];
    removeHeldSale(outbox, "held-local-1");
    expect(outbox).toHaveLength(2);
  });

  it("returns the outbox unchanged when the id is not found", () => {
    const outbox = [makeHeldSale({ localId: "held-local-1" })];
    expect(removeHeldSale(outbox, "does-not-exist")).toEqual(outbox);
  });
});
