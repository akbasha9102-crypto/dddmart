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

vi.mock("@/services/products.service", () => ({
  isUniqueViolation: (error: unknown) =>
    typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "23505",
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
        clientLocalId: sale.localId,
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

  it("on error mid-loop, resets the failing held sale to pending and leaves remaining held sales pending", async () => {
    const first = makeHeldSale({ localId: "held-1", createdAt: "2026-08-07T09:00:00.000Z" });
    const second = makeHeldSale({ localId: "held-2", createdAt: "2026-08-07T10:00:00.000Z" });
    outboxState.held = [first, second];
    holdSaleMock.mockRejectedValueOnce(new Error("network dropped"));

    const { syncOutbox } = await import("./syncManager");
    const result = await syncOutbox(FAKE_SUPABASE);

    expect(result.syncedHeldCount).toBe(0);
    expect(outboxState.held.find((s) => s.localId === "held-1")?.status).toBe("pending");
    expect(outboxState.held.find((s) => s.localId === "held-2")?.status).toBe("pending");
    expect(holdSaleMock).toHaveBeenCalledTimes(1);
  });

  it("passes clientLocalId: sale.localId to holdSale — audit item #11", async () => {
    const sale = makeHeldSale({ localId: "held-local-9" });
    outboxState.held = [sale];

    const { syncOutbox } = await import("./syncManager");
    await syncOutbox(FAKE_SUPABASE);

    expect(holdSaleMock).toHaveBeenCalledWith(
      FAKE_SUPABASE,
      expect.objectContaining({ clientLocalId: "held-local-9" }),
      sale.storeId,
    );
  });

  it("treats a 23505 on held_sales_client_local_id_key as already-synced — audit item #11", async () => {
    outboxState.held = [makeHeldSale({ localId: "held-1" })];
    holdSaleMock.mockRejectedValueOnce({
      code: "23505",
      message: 'duplicate key value violates unique constraint "held_sales_client_local_id_key"',
    });

    const { syncOutbox } = await import("./syncManager");
    const result = await syncOutbox(FAKE_SUPABASE);

    expect(result.syncedHeldCount).toBe(1);
    expect(outboxState.held.find((s) => s.localId === "held-1")?.status).toBe("synced");
  });

  it("continues processing the rest of the batch after a held_sales_client_local_id_key 23505 (does not stop the run) — audit item #11", async () => {
    const first = makeHeldSale({ localId: "held-1", createdAt: "2026-08-07T09:00:00.000Z" });
    const second = makeHeldSale({ localId: "held-2", createdAt: "2026-08-07T10:00:00.000Z" });
    outboxState.held = [first, second];
    holdSaleMock.mockRejectedValueOnce({
      code: "23505",
      message: 'duplicate key value violates unique constraint "held_sales_client_local_id_key"',
    });

    const { syncOutbox } = await import("./syncManager");
    const result = await syncOutbox(FAKE_SUPABASE);

    expect(result.syncedHeldCount).toBe(2);
    expect(outboxState.held.find((s) => s.localId === "held-1")?.status).toBe("synced");
    expect(outboxState.held.find((s) => s.localId === "held-2")?.status).toBe("synced");
    expect(holdSaleMock).toHaveBeenCalledTimes(2);
  });

  it("a non-23505 (or differently-named 23505) error still falls through to resetStaleHeldSyncing/pending unchanged (regression guard) — audit item #11", async () => {
    const first = makeHeldSale({ localId: "held-1", createdAt: "2026-08-07T09:00:00.000Z" });
    const second = makeHeldSale({ localId: "held-2", createdAt: "2026-08-07T10:00:00.000Z" });
    outboxState.held = [first, second];
    holdSaleMock.mockRejectedValueOnce(new Error("network dropped"));

    const { syncOutbox } = await import("./syncManager");
    const result = await syncOutbox(FAKE_SUPABASE);

    expect(result.syncedHeldCount).toBe(0);
    expect(outboxState.held.find((s) => s.localId === "held-1")?.status).toBe("pending");
    expect(outboxState.held.find((s) => s.localId === "held-2")?.status).toBe("pending");
    expect(holdSaleMock).toHaveBeenCalledTimes(1);
  });

  it("marks a held sale as 'conflict' (not 'pending') when hold_sale throws an insufficient-stock error — migration 43", async () => {
    const first = makeHeldSale({ localId: "held-1", createdAt: "2026-08-07T09:00:00.000Z" });
    const second = makeHeldSale({ localId: "held-2", createdAt: "2026-08-07T10:00:00.000Z" });
    outboxState.held = [first, second];
    holdSaleMock.mockRejectedValueOnce({ message: "ERROR: الكمية المتوفرة من منتج غير كافية" });

    const { syncOutbox } = await import("./syncManager");
    const result = await syncOutbox(FAKE_SUPABASE);

    expect(outboxState.held.find((s) => s.localId === "held-1")?.status).toBe("conflict");
    // Remaining held sales stay pending for the next sync attempt, same as any other break-on-error case.
    expect(outboxState.held.find((s) => s.localId === "held-2")?.status).toBe("pending");
    expect(result.syncedHeldCount).toBe(0);
  });

  it("runs sales replay before held-sale replay (call-order assertion)", async () => {
    outboxState.sales = [makeSale({ localId: "sale-1" })];
    outboxState.held = [makeHeldSale({ localId: "held-1" })];

    const calls: string[] = [];
    createSaleMock.mockImplementation(async () => {
      calls.push("createSale");
      return { sale: { total_amount: 10 }, items: [], changeAmount: 0 };
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

describe("syncOutbox — sales replay phase", () => {
  beforeEach(() => {
    outboxState.sales = [];
    outboxState.held = [];
    createSaleMock.mockClear();
    holdSaleMock.mockClear();
    createSaleMock.mockResolvedValue({ sale: { total_amount: 10 }, items: [], changeAmount: 0 });
    holdSaleMock.mockResolvedValue({});
  });

  it("calls createSale directly with no separate stock pre-flight step", async () => {
    outboxState.sales = [makeSale({ localId: "sale-1" })];

    const { syncOutbox } = await import("./syncManager");
    const result = await syncOutbox(FAKE_SUPABASE);

    expect(result.syncedCount).toBe(1);
    expect(createSaleMock).toHaveBeenCalledTimes(1);
    expect(createSaleMock).toHaveBeenCalledWith(
      FAKE_SUPABASE,
      expect.objectContaining({ id: "sale-1", invoiceNumber: "INV-20260807-0001" }),
      "store-1",
    );
    expect(outboxState.sales.find((s) => s.localId === "sale-1")?.status).toBe("synced");
  });

  it("on a generic/network error from createSale, resets the failing sale to pending and leaves the rest pending", async () => {
    const first = makeSale({ localId: "sale-1", createdAt: "2026-08-07T09:00:00.000Z" });
    const second = makeSale({ localId: "sale-2", createdAt: "2026-08-07T10:00:00.000Z" });
    outboxState.sales = [first, second];
    createSaleMock.mockRejectedValueOnce(new Error("network dropped"));

    const { syncOutbox } = await import("./syncManager");
    const result = await syncOutbox(FAKE_SUPABASE);

    expect(result.syncedCount).toBe(0);
    expect(outboxState.sales.find((s) => s.localId === "sale-1")?.status).toBe("pending");
    expect(outboxState.sales.find((s) => s.localId === "sale-2")?.status).toBe("pending");
    expect(createSaleMock).toHaveBeenCalledTimes(1);
  });

  it("marks the sale as 'conflict' (not 'pending') when createSale throws an insufficient-stock error from create_sale_atomic", async () => {
    outboxState.sales = [makeSale({ localId: "sale-1" })];
    createSaleMock.mockRejectedValueOnce({ message: "ERROR: الكمية المتوفرة من منتج غير كافية" });

    const { syncOutbox } = await import("./syncManager");
    const result = await syncOutbox(FAKE_SUPABASE);

    expect(result.syncedCount).toBe(0);
    expect(result.conflictCount).toBe(1);
    expect(outboxState.sales.find((s) => s.localId === "sale-1")?.status).toBe("conflict");
  });

  it("treats a 23505 on sales_pkey from createSale as already-synced — audit item #10", async () => {
    outboxState.sales = [makeSale({ localId: "sale-1" })];
    createSaleMock.mockRejectedValueOnce({
      code: "23505",
      message: 'duplicate key value violates unique constraint "sales_pkey"',
    });

    const { syncOutbox } = await import("./syncManager");
    const result = await syncOutbox(FAKE_SUPABASE);

    expect(result.syncedCount).toBe(1);
    expect(outboxState.sales.find((s) => s.localId === "sale-1")?.status).toBe("synced");
  });

  it("continues processing the rest of the batch after a sales_pkey 23505 (does not stop the run) — audit item #10", async () => {
    const first = makeSale({ localId: "sale-1", createdAt: "2026-08-07T09:00:00.000Z" });
    const second = makeSale({ localId: "sale-2", createdAt: "2026-08-07T10:00:00.000Z" });
    outboxState.sales = [first, second];
    createSaleMock.mockRejectedValueOnce({
      code: "23505",
      message: 'duplicate key value violates unique constraint "sales_pkey"',
    });

    const { syncOutbox } = await import("./syncManager");
    const result = await syncOutbox(FAKE_SUPABASE);

    expect(result.syncedCount).toBe(2);
    expect(outboxState.sales.find((s) => s.localId === "sale-1")?.status).toBe("synced");
    expect(outboxState.sales.find((s) => s.localId === "sale-2")?.status).toBe("synced");
    expect(createSaleMock).toHaveBeenCalledTimes(2);
  });

  it("does NOT treat a 23505 on a DIFFERENT constraint (e.g. invoice_number collision) as already-synced — falls through to pending, audit item #10", async () => {
    outboxState.sales = [makeSale({ localId: "sale-1" })];
    createSaleMock.mockRejectedValueOnce({
      code: "23505",
      message: 'duplicate key value violates unique constraint "sales_store_id_invoice_number_key"',
    });

    const { syncOutbox } = await import("./syncManager");
    const result = await syncOutbox(FAKE_SUPABASE);

    expect(result.syncedCount).toBe(0);
    expect(outboxState.sales.find((s) => s.localId === "sale-1")?.status).toBe("pending");
  });

  it("a non-23505, non-insufficient-stock error still falls through to resetStaleSyncing/pending (regression guard)", async () => {
    outboxState.sales = [makeSale({ localId: "sale-1" })];
    createSaleMock.mockRejectedValueOnce({ code: "23503", message: "foreign key violation" });

    const { syncOutbox } = await import("./syncManager");
    const result = await syncOutbox(FAKE_SUPABASE);

    expect(result.syncedCount).toBe(0);
    expect(outboxState.sales.find((s) => s.localId === "sale-1")?.status).toBe("pending");
  });
});

describe("syncOutbox — offline receipt vs. server total mismatch detection (audit item #3)", () => {
  beforeEach(() => {
    outboxState.sales = [];
    outboxState.held = [];
    createSaleMock.mockClear();
  });

  it("does not flag priceMismatch when the offline total matches the server-recorded total exactly", async () => {
    outboxState.sales = [makeSale({ localId: "sale-1" })];
    createSaleMock.mockResolvedValueOnce({ sale: { total_amount: 10 }, items: [], changeAmount: 0 });

    const { syncOutbox } = await import("./syncManager");
    const result = await syncOutbox(FAKE_SUPABASE);

    expect(result.syncedCount).toBe(1);
    const synced = outboxState.sales.find((s) => s.localId === "sale-1");
    expect(synced?.status).toBe("synced");
    expect(synced?.priceMismatch).toBeUndefined();
  });

  it("flags priceMismatch when the offline total differs from the server-recorded total beyond tolerance, while still counting as synced", async () => {
    outboxState.sales = [makeSale({ localId: "sale-1" })];
    createSaleMock.mockResolvedValueOnce({ sale: { total_amount: 15 }, items: [], changeAmount: 0 });

    const { syncOutbox } = await import("./syncManager");
    const result = await syncOutbox(FAKE_SUPABASE);

    expect(result.syncedCount).toBe(1);
    const synced = outboxState.sales.find((s) => s.localId === "sale-1");
    expect(synced?.status).toBe("synced");
    expect(synced?.priceMismatch).toEqual({ offlineTotal: 10, serverTotal: 15 });
  });

  it("does not flag priceMismatch when the difference is a negligible floating-point amount within the 0.01 tolerance", async () => {
    outboxState.sales = [makeSale({ localId: "sale-1" })];
    createSaleMock.mockResolvedValueOnce({ sale: { total_amount: 10.001 }, items: [], changeAmount: 0 });

    const { syncOutbox } = await import("./syncManager");
    const result = await syncOutbox(FAKE_SUPABASE);

    expect(result.syncedCount).toBe(1);
    const synced = outboxState.sales.find((s) => s.localId === "sale-1");
    expect(synced?.status).toBe("synced");
    expect(synced?.priceMismatch).toBeUndefined();
  });
});
