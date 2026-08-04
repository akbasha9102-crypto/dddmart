"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { createProduct, updateProduct } from "@/services/products.service";
import { createCategory } from "@/services/categories.service";
import type { Product, Category } from "@/types/product";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { BarcodeGenerator } from "./BarcodeGenerator";

interface ProductFormProps {
  product?: Product | null;
  categories: Category[];
  onSaved: (product: Product) => void;
  onCancel: () => void;
}

export function ProductForm({ product, categories, onSaved, onCancel }: ProductFormProps) {
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
  const [extraCategories, setExtraCategories] = useState<Category[]>([]);
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const allCategories = [...categories, ...extraCategories];

  async function handleAddCategory() {
    const name = newCategoryName.trim();
    if (!name) return;
    const supabase = createClient();
    const created = await createCategory(supabase, name);
    setExtraCategories((prev) => [...prev, created]);
    setCategoryId(created.id);
    setNewCategoryName("");
    setIsAddingCategory(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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

      const saved = product
        ? await updateProduct(supabase, product.id, payload)
        : await createProduct(supabase, payload);

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
        <div className="flex gap-2">
          <select
            id="category"
            value={categoryId ?? ""}
            onChange={(event) => setCategoryId(event.target.value)}
            className="h-11 flex-1 rounded-lg border border-gray-300 px-3 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
          >
            <option value="">بدون فئة</option>
            {allCategories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
          <Button type="button" variant="secondary" onClick={() => setIsAddingCategory((prev) => !prev)}>
            + فئة
          </Button>
        </div>
        {isAddingCategory ? (
          <div className="flex gap-2 pt-1">
            <Input
              value={newCategoryName}
              onChange={(event) => setNewCategoryName(event.target.value)}
              placeholder="اسم الفئة الجديدة"
              className="flex-1"
            />
            <Button type="button" size="sm" onClick={() => void handleAddCategory()}>
              إضافة
            </Button>
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Input
          label="سعر التكلفة"
          type="number"
          min={0}
          step="0.01"
          value={costPrice}
          onChange={(event) => setCostPrice(event.target.value)}
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
      </div>

      <Input label="الوحدة" value={unit} onChange={(event) => setUnit(event.target.value)} />

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
