"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { createProduct, updateProduct } from "@/services/products.service";
import { useAuth } from "@/context/AuthContext";
import type { Product, Category } from "@/types/product";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { BarcodeGenerator } from "./BarcodeGenerator";
import { ProfitPreview } from "./ProfitPreview";
import { ProductUnitsManager } from "./ProductUnitsManager";

interface ProductFormProps {
  product?: Product | null;
  categories: Category[];
  onSaved: (product: Product) => void;
  onCancel: () => void;
}

export function ProductForm({ product, categories, onSaved, onCancel }: ProductFormProps) {
  const { user } = useAuth();
  const [name, setName] = useState(product?.name ?? "");
  const [barcode, setBarcode] = useState(product?.barcode ?? "");
  const [categoryId, setCategoryId] = useState(product?.category_id ?? "");
  const [costPrice, setCostPrice] = useState(String(product?.cost_price ?? 0));
  const [salePrice, setSalePrice] = useState(String(product?.sale_price ?? ""));
  const [quantity, setQuantity] = useState(String(product?.quantity ?? 0));
  const [minStock, setMinStock] = useState(String(product?.min_stock_threshold ?? 5));
  const [unit, setUnit] = useState(product?.unit ?? "قطعة");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (Number(salePrice) <= 0) {
      setError("سعر البيع يجب أن يكون أكبر من صفر");
      return;
    }

    setError(null);
    setIsSaving(true);

    try {
      const supabase = createClient();
      const payload = {
        name,
        barcode,
        category_id: categoryId || null,
        cost_price: Number(costPrice) || 0,
        sale_price: Number(salePrice) || 0,
        quantity: Number(quantity) || 0,
        min_stock_threshold: Number(minStock) || 0,
        unit,
      };

      const actorId = user?.id ?? null;
      const saved = product
        ? await updateProduct(supabase, product.id, payload, actorId)
        : await createProduct(supabase, payload, actorId);

      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر حفظ المنتج");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <Input label="اسم المنتج" value={name} onChange={(event) => setName(event.target.value)} required />

      <BarcodeGenerator value={barcode} onChange={setBarcode} />

      <div className="flex flex-col gap-1">
        <label htmlFor="category" className="text-sm font-medium text-gray-700">
          الفئة
        </label>
        <select
          id="category"
          value={categoryId ?? ""}
          onChange={(event) => setCategoryId(event.target.value)}
          className="h-11 rounded-lg border border-gray-300 px-3 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
        >
          <option value="">بدون فئة</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Input
          label="سعر التكلفة"
          type="number"
          min={0}
          step="0.01"
          value={costPrice}
          onChange={(event) => setCostPrice(event.target.value)}
          required
        />
        <Input
          label="سعر البيع"
          type="number"
          min={0}
          step="0.01"
          value={salePrice}
          onChange={(event) => setSalePrice(event.target.value)}
          required
        />
        <Input
          label="الكمية"
          type="number"
          min={0}
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
        />
        <Input
          label="حد التنبيه"
          type="number"
          min={0}
          value={minStock}
          onChange={(event) => setMinStock(event.target.value)}
        />
        <ProfitPreview costPrice={costPrice} salePrice={salePrice} className="col-span-2" />
      </div>

      <Input label="الوحدة" value={unit} onChange={(event) => setUnit(event.target.value)} />

      {product ? <ProductUnitsManager productId={product.id} /> : null}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          إلغاء
        </Button>
        <Button type="submit" disabled={isSaving}>
          {isSaving ? "جارٍ الحفظ..." : "حفظ"}
        </Button>
      </div>
    </form>
  );
}
