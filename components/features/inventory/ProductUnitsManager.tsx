"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  createProductUnit,
  deleteProductUnit,
  isUniqueViolation,
  listProductUnits,
} from "@/services/products.service";
import { useAuth } from "@/context/AuthContext";
import type { ProductUnit } from "@/types/product";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

interface ProductUnitsManagerProps {
  productId: string;
}

/** Lets a manager attach extra sale units (كيس، كارتون...) to an existing product, each with its own barcode and price. */
export function ProductUnitsManager({ productId }: ProductUnitsManagerProps) {
  const { storeId } = useAuth();
  const [units, setUnits] = useState<ProductUnit[]>([]);
  const [unitName, setUnitName] = useState("");
  const [conversionFactor, setConversionFactor] = useState("");
  const [barcode, setBarcode] = useState("");
  const [salePrice, setSalePrice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      setUnits(await listProductUnits(supabase, productId));
    }
    void load();
  }, [productId]);

  async function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const factor = Number(conversionFactor);
    if (!Number.isInteger(factor) || factor <= 1) {
      setError("معامل التحويل يجب أن يكون عدداً صحيحاً أكبر من 1");
      return;
    }
    if (Number(salePrice) <= 0) {
      setError("سعر البيع يجب أن يكون أكبر من صفر");
      return;
    }
    if (!storeId) {
      setError("تعذر تحديد المتجر — الرجاء إعادة تسجيل الدخول");
      return;
    }

    setError(null);
    setIsSaving(true);
    try {
      const supabase = createClient();
      const created = await createProductUnit(
        supabase,
        {
          product_id: productId,
          unit_name: unitName,
          conversion_factor: factor,
          barcode,
          sale_price: Number(salePrice),
          sort_order: units.length,
        },
        storeId,
      );
      setUnits([...units, created]);
      setUnitName("");
      setConversionFactor("");
      setBarcode("");
      setSalePrice("");
    } catch (err) {
      setError(isUniqueViolation(err) ? "الباركود مستخدم من قبل" : "تعذر إضافة الوحدة");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleRemove(id: string) {
    const supabase = createClient();
    await deleteProductUnit(supabase, id);
    setUnits(units.filter((unit) => unit.id !== id));
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-gray-200 p-3">
      <p className="text-sm font-medium text-gray-700">وحدات البيع الإضافية (كيس، كارتون...)</p>

      {units.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {units.map((unit) => (
            <li key={unit.id} className="flex items-center justify-between text-sm text-gray-700">
              <span>
                {unit.unit_name} = {unit.conversion_factor} قطعة — باركود {unit.barcode} — {unit.sale_price}
              </span>
              <button type="button" onClick={() => handleRemove(unit.id)} className="text-red-600 hover:underline">
                حذف
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <form onSubmit={handleAdd} className="grid grid-cols-2 gap-2">
        <Input label="اسم الوحدة" value={unitName} onChange={(event) => setUnitName(event.target.value)} required />
        <Input
          label="معامل التحويل"
          type="number"
          min={2}
          step={1}
          value={conversionFactor}
          onChange={(event) => setConversionFactor(event.target.value)}
          required
        />
        <Input label="الباركود" value={barcode} onChange={(event) => setBarcode(event.target.value)} required />
        <Input
          label="سعر البيع"
          type="number"
          min={0}
          step="0.01"
          value={salePrice}
          onChange={(event) => setSalePrice(event.target.value)}
          required
        />
        <Button type="submit" disabled={isSaving} className="col-span-2">
          {isSaving ? "جارٍ الإضافة..." : "إضافة وحدة"}
        </Button>
      </form>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
