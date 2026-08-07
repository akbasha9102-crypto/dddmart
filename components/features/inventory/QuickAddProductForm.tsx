"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { createProduct, isUniqueViolation } from "@/services/products.service";
import { useAuth } from "@/context/AuthContext";
import { isAdminRole } from "@/lib/employees/adminCheck";
import type { Category } from "@/types/product";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { BarcodeGenerator, generateBarcode } from "./BarcodeGenerator";
import { CameraBarcodeScanner } from "@/components/features/shared/CameraBarcodeScanner";
import { ProfitPreview } from "./ProfitPreview";

interface QuickAddProductFormProps {
  categories: Category[];
}

/** Mobile-first minimal add-product form: name + barcode + quantity + category only. */
export function QuickAddProductForm({ categories }: QuickAddProductFormProps) {
  const router = useRouter();
  const { user, role } = useAuth();
  const [name, setName] = useState("");
  const [barcode, setBarcode] = useState("");
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [costPrice, setCostPrice] = useState("");
  const [salePrice, setSalePrice] = useState("");
  const [quantity, setQuantity] = useState("");
  const [categoryId, setCategoryId] = useState("");
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
      await createProduct(
        supabase,
        {
          name,
          quantity: Number(quantity) || 0,
          category_id: categoryId || null,
          cost_price: Number(costPrice) || 0,
          sale_price: Number(salePrice) || 0,
          barcode: barcode.trim() || generateBarcode(),
        },
        user?.id ?? null,
      );

      router.push("/inventory");
      router.refresh();
    } catch (err) {
      if (isUniqueViolation(err)) {
        setError("هذا الباركود مستخدم من قبل لمنتج آخر. جرّب مسحه مرة أخرى أو اتركه فارغاً للتوليد التلقائي.");
      } else {
        setError(err instanceof Error ? err.message : "تعذر حفظ المنتج");
      }
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

      <BarcodeGenerator
        value={barcode}
        onChange={setBarcode}
        required={false}
        className="flex-1 font-mono h-14 text-lg"
        extraAction={
          <Button
            type="button"
            variant="secondary"
            onClick={() => setIsCameraOpen(true)}
            aria-label="مسح الباركود بالكاميرا"
          >
            📷
          </Button>
        }
      />
      <p className="text-xs text-gray-500">اتركه فارغاً لتوليد باركود تلقائياً</p>
      <CameraBarcodeScanner
        open={isCameraOpen}
        onClose={() => setIsCameraOpen(false)}
        onDetected={(code) => {
          setBarcode(code);
          setIsCameraOpen(false);
        }}
      />

      <div className={isAdminRole(role) ? "grid grid-cols-2 gap-4" : ""}>
        {isAdminRole(role) ? (
          <Input
            label="سعر الشراء (للسلعة الواحدة)"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={costPrice}
            onChange={(event) => setCostPrice(event.target.value)}
            className="h-14 text-lg"
            required
          />
        ) : null}
        <Input
          label="سعر البيع (للسلعة الواحدة)"
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          value={salePrice}
          onChange={(event) => setSalePrice(event.target.value)}
          className="h-14 text-lg"
          required
        />
      </div>
      {isAdminRole(role) ? <ProfitPreview costPrice={costPrice} salePrice={salePrice} /> : null}

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
