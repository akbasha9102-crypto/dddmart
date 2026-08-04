"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { createProduct } from "@/services/products.service";
import type { Category } from "@/types/product";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { generateBarcode } from "./BarcodeGenerator";

interface QuickAddProductFormProps {
  categories: Category[];
}

/** Mobile-first minimal add-product form: name + quantity + category only. */
export function QuickAddProductForm({ categories }: QuickAddProductFormProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSaving(true);

    try {
      const supabase = createClient();
      await createProduct(supabase, {
        name,
        quantity: Number(quantity) || 0,
        category_id: categoryId || null,
        sale_price: 0,
        barcode: generateBarcode(),
      });

      router.push("/inventory");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر حفظ المنتج");
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <Input
        label="اسم السلعة"
        value={name}
        onChange={(event) => setName(event.target.value)}
        className="h-14 text-lg"
        required
        autoFocus
      />

      <Input
        label="العدد / الكمية"
        type="number"
        inputMode="numeric"
        min={0}
        value={quantity}
        onChange={(event) => setQuantity(event.target.value)}
        className="h-14 text-lg"
        required
      />

      <div className="flex flex-col gap-1">
        <label htmlFor="quick-category" className="text-sm font-medium text-gray-700">
          القسم
        </label>
        <select
          id="quick-category"
          value={categoryId}
          onChange={(event) => setCategoryId(event.target.value)}
          className="h-14 rounded-lg border border-gray-300 px-3 text-lg outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
          required
        >
          <option value="" disabled>
            اختر القسم
          </option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <Button type="submit" size="xl" disabled={isSaving} className="mt-2 w-full">
        {isSaving ? "جارٍ الحفظ..." : "حفظ السلعة"}
      </Button>
    </form>
  );
}
