"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getSaleItems } from "@/services/sales.service";
import { getReturnedQuantitiesForSale, recordReturn } from "@/services/returns.service";
import { useAuth } from "@/context/AuthContext";
import { formatCurrency } from "@/lib/utils";
import type { Sale, SaleItem } from "@/types/pos";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

interface SaleReturnPanelProps {
  sale: Sale;
}

const REASON_PRESETS = ["تالف", "غير مطابق", "غير مرغوب به", "أخرى"] as const;

/**
 * Reusable return UI/logic, shared by the admin /sales InvoiceView flow and
 * the cashier-facing POS return-lookup flow (ReturnLookup.tsx). Deliberately
 * has NO isAdminRole gate anywhere — any authenticated user (cashier or
 * admin) can submit a return through it; the acting user's identity is
 * captured via actorId in recordReturn's logOperation call regardless of
 * role, which is what satisfies the audit-trail requirement for the
 * cashier-facing entry point.
 */
export function SaleReturnPanel({ sale }: SaleReturnPanelProps) {
  const { user } = useAuth();
  const [items, setItems] = useState<SaleItem[] | null>(null);
  const [returnedQuantities, setReturnedQuantities] = useState<Map<string, number>>(new Map());
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    const supabase = createClient();
    void Promise.all([getSaleItems(supabase, sale.id), getReturnedQuantitiesForSale(supabase, sale.id)]).then(
      ([saleItems, returned]) => {
        if (cancelled) return;
        setItems(saleItems);
        setReturnedQuantities(returned);
        setIsLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [sale.id]);

  function handleLineReturned(saleItemId: string, quantityReturned: number) {
    setReturnedQuantities((prev) => {
      const next = new Map(prev);
      next.set(saleItemId, (next.get(saleItemId) ?? 0) + quantityReturned);
      return next;
    });
  }

  if (isLoading || items === null) {
    return <p className="p-4 text-center text-gray-400">جارٍ التحميل...</p>;
  }

  if (items.length === 0) {
    return <p className="p-4 text-center text-gray-400">لا توجد عناصر في هذه الفاتورة</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-medium text-gray-700">إرجاع من فاتورة {sale.invoice_number}</p>
      <div className="flex flex-col divide-y divide-gray-100">
        {items.map((item) => {
          const alreadyReturned = returnedQuantities.get(item.id) ?? 0;
          const remaining = item.quantity - alreadyReturned;
          return (
            <ReturnLineRow
              key={item.id}
              sale={sale}
              item={item}
              remaining={remaining}
              actorId={user?.id ?? null}
              onReturned={(quantityReturned) => handleLineReturned(item.id, quantityReturned)}
            />
          );
        })}
      </div>
    </div>
  );
}

function ReturnLineRow({
  sale,
  item,
  remaining,
  actorId,
  onReturned,
}: {
  sale: Sale;
  item: SaleItem;
  remaining: number;
  actorId: string | null;
  onReturned: (quantityReturned: number) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [quantity, setQuantity] = useState("");
  const [refundAmount, setRefundAmount] = useState("");
  const [refundEdited, setRefundEdited] = useState(false);
  const [reasonPreset, setReasonPreset] = useState<(typeof REASON_PRESETS)[number]>(REASON_PRESETS[0]);
  const [customReason, setCustomReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [done, setDone] = useState(false);

  const quantityNumber = Number(quantity);
  const defaultRefund = Number.isFinite(quantityNumber) && quantityNumber > 0 ? item.unit_price * quantityNumber : 0;

  useEffect(() => {
    if (!refundEdited) setRefundAmount(defaultRefund ? String(defaultRefund) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quantity]);

  const finalReason = useMemo(
    () => (reasonPreset === "أخرى" ? customReason.trim() || null : reasonPreset),
    [reasonPreset, customReason],
  );

  function openForm() {
    setIsOpen(true);
    setQuantity(remaining > 0 ? String(remaining) : "");
    setRefundEdited(false);
    setError(null);
  }

  async function handleSubmit() {
    const refundNumber = Number(refundAmount);

    if (!Number.isInteger(quantityNumber) || quantityNumber <= 0) {
      setError("الكمية يجب أن تكون عدداً صحيحاً أكبر من صفر");
      return;
    }
    if (quantityNumber > remaining) {
      setError(`الكمية أكبر من المتبقي القابل للإرجاع (المتبقي: ${remaining})`);
      return;
    }
    if (!Number.isFinite(refundNumber) || refundNumber < 0) {
      setError("قيمة الاسترجاع يجب أن تكون صفراً أو أكبر");
      return;
    }

    setError(null);
    setIsSaving(true);
    try {
      const supabase = createClient();
      await recordReturn(
        supabase,
        {
          saleId: sale.id,
          saleItemId: item.id,
          productId: item.product_id,
          productName: item.product_name,
          unitLabel: item.unit_label,
          unitConversionFactor: item.unit_conversion_factor,
          originalLineQuantity: item.quantity,
          quantity: quantityNumber,
          refundAmount: refundNumber,
          reason: finalReason,
        },
        actorId,
      );
      onReturned(quantityNumber);
      setIsOpen(false);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر تسجيل الإرجاع");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-col">
          <span className="font-medium text-gray-900">
            {item.product_name}
            {item.unit_label ? ` (${item.unit_label})` : ""}
          </span>
          <span className="text-xs text-gray-500">
            {item.quantity} × {formatCurrency(item.unit_price)}
          </span>
        </div>
        {remaining <= 0 ? (
          <span className="text-xs font-medium text-gray-400">{done ? "تم الإرجاع" : "تم إرجاعه بالكامل"}</span>
        ) : isOpen ? (
          <Button type="button" size="sm" variant="ghost" onClick={() => setIsOpen(false)}>
            إلغاء
          </Button>
        ) : (
          <Button type="button" size="sm" variant="secondary" onClick={openForm}>
            إرجاع
          </Button>
        )}
      </div>

      {isOpen ? (
        <div className="flex flex-col gap-2 rounded-lg bg-gray-50 p-3">
          <Input
            label={`الكمية (المتبقي القابل للإرجاع: ${remaining})`}
            type="number"
            min={1}
            max={remaining}
            step={1}
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
          <Input
            label="قيمة الاسترجاع"
            type="number"
            min={0}
            step="0.01"
            value={refundAmount}
            onChange={(event) => {
              setRefundEdited(true);
              setRefundAmount(event.target.value);
            }}
          />
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700">السبب</label>
            <select
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
            <Input label="وضّح السبب" type="text" value={customReason} onChange={(event) => setCustomReason(event.target.value)} />
          ) : null}

          {error ? <p className="text-sm text-red-600">{error}</p> : null}

          <Button type="button" onClick={handleSubmit} disabled={isSaving}>
            {isSaving ? "جارٍ الحفظ..." : "تأكيد الإرجاع"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
