"use client";

import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { recordDamage } from "@/services/damages.service";
import { useAuth } from "@/context/AuthContext";
import { formatCurrency } from "@/lib/utils";
import type { Product } from "@/types/product";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

interface DamageStockFormProps {
  product: Product;
  onSaved: () => void;
  onCancel: () => void;
}

const REASON_PRESETS = ["منتهي الصلاحية", "مكسور/تالف", "أخرى"] as const;

/** Lets an admin record damaged/expired stock, decrementing quantity by the product's own base unit (no unit picker — v1 scope). Mirrors ReceiveStockForm's shape. */
export function DamageStockForm({ product, onSaved, onCancel }: DamageStockFormProps) {
  const { user } = useAuth();
  const [quantity, setQuantity] = useState("");
  const [reasonPreset, setReasonPreset] = useState<(typeof REASON_PRESETS)[number]>(REASON_PRESETS[0]);
  const [customReason, setCustomReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const quantityNumber = Number(quantity);
  const isQuantityValid = quantity !== "" && Number.isInteger(quantityNumber) && quantityNumber > 0 && quantityNumber <= product.quantity;
  const estimatedLoss = isQuantityValid ? quantityNumber * product.cost_price : 0;

  const finalReason = useMemo(
    () => (reasonPreset === "أخرى" ? customReason.trim() || null : reasonPreset),
    [reasonPreset, customReason],
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!Number.isInteger(quantityNumber) || quantityNumber <= 0) {
      setError("الكمية يجب أن تكون عدداً صحيحاً أكبر من صفر");
      return;
    }
    if (quantityNumber > product.quantity) {
      setError(`الكمية أكبر من المخزون المتوفر (المتوفر: ${product.quantity})`);
      return;
    }

    setError(null);
    setIsSaving(true);
    try {
      const supabase = createClient();
      await recordDamage(
        supabase,
        {
          productId: product.id,
          productName: product.name,
          quantity: quantityNumber,
          reason: finalReason,
        },
        user?.id ?? null,
      );
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر تسجيل التلف");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <Input
        label={`الكمية التالفة (${product.unit}) — المتوفر ${product.quantity}`}
        type="number"
        min={1}
        max={product.quantity}
        step={1}
        value={quantity}
        onChange={(event) => setQuantity(event.target.value)}
        required
      />

      <div className="flex flex-col gap-1">
        <label htmlFor="damage-reason" className="text-sm font-medium text-gray-700">
          السبب
        </label>
        <select
          id="damage-reason"
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

      {isQuantityValid ? (
        <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-600">
          الخسارة التقديرية: {formatCurrency(estimatedLoss)}
        </p>
      ) : null}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          إلغاء
        </Button>
        <Button type="submit" variant="danger" disabled={isSaving}>
          {isSaving ? "جارٍ الحفظ..." : "تسجيل التلف"}
        </Button>
      </div>
    </form>
  );
}
