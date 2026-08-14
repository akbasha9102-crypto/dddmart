import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getStore, updateStore, type Store, type StoreUpdate } from "./stores.service";
import type { Database } from "@/types/database.types";

const STORE: Store = {
  id: "store-1",
  name: "متجر الرئيسي",
  phone: "0912345678",
  address: "شارع الجمهورية",
};

/**
 * Hand-rolled fake covering the exact chain getStore calls:
 * stores.select().eq().maybeSingle(). Deliberately minimal, matching the
 * other fakes in this repo.
 */
function createFakeSupabaseForGetStore(options: { data: Store | null; error?: unknown }): {
  supabase: SupabaseClient<Database>;
  eqSpy: ReturnType<typeof vi.fn>;
} {
  const eqSpy = vi.fn(() => ({
    maybeSingle: async () => ({ data: options.data, error: options.error ?? null }),
  }));
  const supabase = {
    from: (table: string) => {
      if (table === "stores") return { select: () => ({ eq: eqSpy }) };
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient<Database>;
  return { supabase, eqSpy };
}

/**
 * Hand-rolled fake covering the exact chain updateStore calls:
 * stores.update().eq().select().single(). Deliberately minimal, matching
 * the other fakes in this repo.
 */
function createFakeSupabaseForUpdateStore(options: { data: Store | null; error?: unknown }): {
  supabase: SupabaseClient<Database>;
  updateSpy: ReturnType<typeof vi.fn>;
} {
  const updateSpy = vi.fn(() => ({
    eq: () => ({
      select: () => ({
        single: async () => ({ data: options.data, error: options.error ?? null }),
      }),
    }),
  }));
  const supabase = {
    from: (table: string) => {
      if (table === "stores") return { update: updateSpy };
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient<Database>;
  return { supabase, updateSpy };
}

describe("getStore", () => {
  it("returns the row", async () => {
    const { supabase } = createFakeSupabaseForGetStore({ data: STORE });

    const result = await getStore(supabase, "store-1");

    expect(result).toEqual(STORE);
  });

  it("returns null when maybeSingle yields no row", async () => {
    const { supabase } = createFakeSupabaseForGetStore({ data: null });

    const result = await getStore(supabase, "store-1");

    expect(result).toBeNull();
  });

  it("throws when error is set", async () => {
    const { supabase } = createFakeSupabaseForGetStore({ data: null, error: new Error("boom") });

    await expect(getStore(supabase, "store-1")).rejects.toThrow("boom");
  });
});

describe("updateStore", () => {
  it("calls .update(updates) with exactly the passed fields and returns the updated row", async () => {
    const { supabase, updateSpy } = createFakeSupabaseForUpdateStore({ data: STORE });
    const updates: StoreUpdate = { name: "متجر الرئيسي", phone: "0912345678", address: "شارع الجمهورية" };

    const result = await updateStore(supabase, "store-1", updates);

    expect(updateSpy).toHaveBeenCalledWith(updates);
    expect(result).toEqual(STORE);
  });

  it("throws when error is set", async () => {
    const { supabase } = createFakeSupabaseForUpdateStore({ data: null, error: new Error("boom") });

    await expect(updateStore(supabase, "store-1", { phone: "0900000000" })).rejects.toThrow("boom");
  });
});
