import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { PendingHeldSale, PendingSale } from "@/types/offline";

// syncManager.ts persists outbox state through lib/offline/db.ts (idb-keyval
// under the hood). We mock db.ts directly rather than idb-keyval so the
// test controls exactly what each read returns and can assert on every
// write, without needing a real IndexedDB in the node test environment.
const outboxState: { sales: PendingSale[]; held: PendingHeldSale[] } = { sales: [], held: [] };

vi.mock("@/lib/offline/db", () => ({
  getOutbox: vi.fn(async () => outboxState.sales),
  setOutbox: vi.fn(async (sales: PendingSale[]) => {
    outboxState.sales = sales;
  }),
  getHeldSalesOutbox: vi.fn(async () => outboxState.held),
  setHeldSalesOutbox: vi.fn(async (sales: PendingHeldSale[]) => {
    outboxState.held = sales;
  }),
}));

const createSaleMock = vi.fn(async (..._args: unknown[]) => ({}));
vi.mock("@/services/sales.service", () => ({
  createSale: (...args: unknown[]) => createSaleMock(...args),
}));

const decrementStockMock = vi.fn(async (..._args: unknown[]) => undefined as unknown);
vi.mock("@/services/products.service", () => ({
  decrementStock: (...args: unknown[]) => decrementStockMock(...args),
}));

const holdSaleMock = vi.fn(async (..._args: unknown[]) => ({}));
vi.mock("@/services/heldSales.service", () => ({
  holdSale: (...args: unknown[]) => holdSaleMock(...args),
}));

const FAKE_SUPABASE = {} as SupabaseClient<Database>;

const BASE_SALE_PAYLOAD: PendingSale["payload"] = {
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
    payload: BASE_SALE_PAYLOAD,
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

describe("syncOutbox — held-sale replay phase", () => {
  beforeEach(() => {
    outboxState.sales = [];
    outboxState.held = [];
    createSaleMock.mockClear();
    decrementStockMock.mockClear();
    holdSaleMock.mockClear();
    createSaleMock.mockResolvedValue({});
    holdSaleMock.mockResolvedValue({});
  });

  it("replays pending held sales in FIFO order (oldest createdAt first)", async () => {
    const newer = makeHeldSale({ localId: "newer", createdAt: "2026-08-07T12:00:00.000Z", note: "newer" });
    const older = makeHeldSale({ localId: "older", createdAt: "2026-08-07T09:00:00.000Z", note: "older" });
    outboxState.held = [newer, older];

    const { syncOutbox } = await import("./syncManager");
    await syncOutbox(FAKE_SUPABASE);

    const callOrder = holdSaleMock.mock.calls.map((call) => (call[1] as { note: string }).note);
    expect(callOrder).toEqual(["older", "newer"]);
  });

  it("passes the correct params (cashierId, items, discountAmount, note) to holdSale, and storeId as third arg", async () => {
    const sale = makeHeldSale({
      cashierId: "cashier-9",
      discountAmount: 5,
      note: "طاولة 3",
      storeId: "store-9",
    });
    outboxState.held = [sale];

    const { syncOutbox } = await import("./syncManager");
    await syncOutbox(FAKE_SUPABASE);

    expect(holdSaleMock).toHaveBeenCalledWith(
      FAKE_SUPABASE,
      {
        cashierId: "cashier-9",
        items: sale.items,
        discountAmount: 5,
        note: "طاولة 3",
      },
      "store-9",
    );
  });

  it("marks a successfully replayed held sale as synced and increments syncedHeldCount", async () => {
    outboxState.held = [makeHeldSale({ localId: "held-1" })];

    const { syncOutbox } = await import("./syncManager");
    const result = await syncOutbox(FAKE_SUPABASE);

    expect(result.syncedHeldCount).toBe(1);
    expect(outboxState.held.find((s) => s.localId === "held-1")?.status).toBe("synced");
  });

  it("on error mid-loop, leaves the failing and remaining held sales pending", async () => {
    const first = makeHeldSale({ localId: "held-1", createdAt: "2026-08-07T09:00:00.000Z" });
    const second = makeHeldSale({ localId: "held-2", createdAt: "2026-08-07T10:00:00.000Z" });
    outboxState.held = [first, second];
    holdSaleMock.mockRejectedValueOnce(new Error("network dropped"));

    const { syncOutbox } = await import("./syncManager");
    const result = await syncOutbox(FAKE_SUPABASE);

    expect(result.syncedHeldCount).toBe(0);
    expect(outboxState.held.find((s) => s.localId === "held-1")?.status).toBe("syncing");
    expect(outboxState.held.find((s) => s.localId === "held-2")?.status).toBe("pending");
    expect(holdSaleMock).toHaveBeenCalledTimes(1);
  });

  it("runs sales replay before held-sale replay (call-order assertion)", async () => {
    outboxState.sales = [makeSale({ localId: "sale-1" })];
    outboxState.held = [makeHeldSale({ localId: "held-1" })];
    decrementStockMock.mockResolvedValue({ id: "p1", quantity: 5 });

    const calls: string[] = [];
    createSaleMock.mockImplementation(async () => {
      calls.push("createSale");
      return {};
    });
    holdSaleMock.mockImplementation(async () => {
      calls.push("holdSale");
      return {};
    });

    const { syncOutbox } = await import("./syncManager");
    await syncOutbox(FAKE_SUPABASE);

    expect(calls).toEqual(["createSale", "holdSale"]);
  });
});
