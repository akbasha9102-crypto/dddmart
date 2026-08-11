"use client";

import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { recordReconciliation } from "@/services/reconciliations.service";
import { useAuth } from "@/context/AuthContext";
import { formatCurrency } from "@/lib/utils";
import type { Product } from "@/types/product";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

interface StockReconciliationFormProps {
  product: Product;
  onSaved: () => void;
  onCancel: () => void;
}

const REASON_PRESETS = ["جرد دوري", "اشتباه سرقة", "خطأ إدخال سابق", "أخرى"] as const;

/** Lets an admin correct a product's stock to match a physical count — the count can be lower (shortage/theft) or higher (overage) than the system quantity. Mirrors DamageStockForm's shape. */
export function StockReconciliationForm({ product, onSaved, onCancel }: StockReconciliationFormProps) {
  const { user, storeId } = useAuth();
  const [countedQuantity, setCountedQuantity] = useState("");
  const [reasonPreset, setReasonPreset] = useState<(typeof REASON_PRESETS)[number]>(REASON_PRESETS[0]);
  const [customReason, setCustomReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const countedNumber = Number(countedQuantity);
  const isCountValid = countedQuantity !== "" && Number.isInteger(countedNumber) && countedNumber >= 0;
  const difference = isCountValid ? countedNumber - product.quantity : 0;
  const hasDifference = isCountValid && difference !== 0;
  const estimatedLoss = difference < 0 ? Math.abs(difference) * product.cost_price : 0;

  const finalReason = useMemo(
    () => (reasonPreset === "أخرى" ? customReason.trim() || null : reasonPreset),
    [reasonPreset, customReason],
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!Number.isInteger(countedNumber) || countedNumber < 0) {
      setError("الكمية الفعلية يجب أن تكون عدداً صحيحاً صفر أو أكبر");
      return;
    }
    if (countedNumber === product.quantity) {
      setError("لا يوجد فرق لتسجيله");
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
      await recordReconciliation(
        supabase,
        {
          productId: product.id,
          productName: product.name,
          countedQuantity: countedNumber,
          reason: finalReason,
        },
        user?.id ?? null,
        storeId,
      );
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر تسجيل التسوية");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <p className="text-sm text-gray-600">
        الكمية المسجلة بالنظام: <span className="font-semibold text-gray-900">{product.quantity} {product.unit}</span>
      </p>

      <Input
        label={`الكمية الفعلية بعد الجرد (${product.unit})`}
        type="number"
        min={0}
        step={1}
        value={countedQuantity}
        onChange={(event) => setCountedQuantity(event.target.value)}
        required
      />

      <div className="flex flex-col gap-1">
        <label htmlFor="reconciliation-reason" className="text-sm font-medium text-gray-700">
          السبب
        </label>
        <select
          id="reconciliation-reason"
          value={reasonPreset}
          onChange={(event) => setReasonPreset(event.target.value as (typeof REASON_PRESETS)[number])}
          className="h-11 rounded-lg border border-gray-300 px-3 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
        >
          {REASON_PRESETS.map((preset) => (
            <option key={preset} value={preset}>
              {preset}
            </option>
          ))}
        </select>
      </div>

      {reasonPreset === "أخرى" ? (
        <Input
          label="وضّح السبب"
          type="text"
          value={customReason}
          onChange={(event) => setCustomReason(event.target.value)}
        />
      ) : null}

      {hasDifference ? (
        <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-600">
          الفرق: {difference > 0 ? `زيادة ${difference}` : `نقص ${Math.abs(difference)}`}
          {estimatedLoss > 0 ? ` — الخسارة التقديرية: ${formatCurrency(estimatedLoss)}` : ""}
        </p>
      ) : null}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          إلغاء
        </Button>
        <Button type="submit" disabled={isSaving || !hasDifference}>
          {isSaving ? "جارٍ الحفظ..." : "تسجيل التسوية"}
        </Button>
      </div>
    </form>
  );
}
