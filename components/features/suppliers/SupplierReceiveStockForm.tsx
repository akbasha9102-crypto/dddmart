"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { recordStockPurchase, listAllProductUnits } from "@/services/products.service";
import { useAuth } from "@/context/AuthContext";
import type { ProductUnit } from "@/types/product";
import type { SupplierProductWithDetails } from "@/types/supplier";
import { formatCurrency } from "@/lib/utils";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Toast } from "@/components/ui/Toast";

interface SupplierReceiveStockFormProps {
  supplierId: string;
  supplierName: string;
  products: SupplierProductWithDetails[];
  onChanged: () => void;
}

interface StagedReceiveItem {
  productId: string; // doubles as the staging key — a product can only be staged once
  productName: string;
  baseUnitLabel: string; // product.unit
  unitOptions: { value: string; label: string; factor: number }[];
  selectedUnitValue: string;
  quantity: string;
  costPerUnit: string;
}

/** Modal for receiving stock from a supplier across several products at once: pick a product, set quantity/unit/cost, stage it, repeat, then submit one shared invoice number + payment method that applies to every staged product via a sequential recordStockPurchase call per item. */
export function SupplierReceiveStockForm({ supplierId, supplierName, products, onChanged }: SupplierReceiveStockFormProps) {
  const { user, storeId } = useAuth();

  const [isOpen, setIsOpen] = useState(false);
  const [unitsByProductId, setUnitsByProductId] = useState<Map<string, ProductUnit[]>>(new Map());
  const [pickedProductId, setPickedProductId] = useState("");
  const [selectedUnitValue, setSelectedUnitValue] = useState("base");
  const [quantity, setQuantity] = useState("");
  const [costPerUnit, setCostPerUnit] = useState("");
  const [stagedItems, setStagedItems] = useState<StagedReceiveItem[]>([]);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "credit" | "">("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [itemErrors, setItemErrors] = useState<Map<string, string>>(new Map());

  const stagedProductIds = new Set(stagedItems.map((item) => item.productId));
  const pickedRow = products.find((row) => row.product_id === pickedProductId) ?? null;
  const pickedUnitOptions = pickedRow
    ? [
        { value: "base", label: pickedRow.product.unit, factor: 1 },
        ...(unitsByProductId.get(pickedRow.product_id) ?? []).map((unit) => ({
          value: unit.id,
          label: unit.unit_name,
          factor: unit.conversion_factor,
        })),
      ]
    : [];
  const pickedSelectedUnit = pickedUnitOptions.find((option) => option.value === selectedUnitValue);

  async function openModal() {
    setUnitsByProductId(new Map());
    setPickedProductId("");
    setSelectedUnitValue("base");
    setQuantity("");
    setCostPerUnit("");
    setStagedItems([]);
    setInvoiceNumber("");
    setPaymentMethod("");
    setIsSaving(false);
    setError(null);
    setSuccessMessage(null);
    setItemErrors(new Map());
    setIsOpen(true);

    if (products.length === 0) return;

    const supabase = createClient();
    const allUnits = await listAllProductUnits(supabase);
    setUnitsByProductId(new Map(products.map((p) => [p.product_id, allUnits.filter((u) => u.product_id === p.product_id)])));
  }

  function pickProduct(productId: string) {
    setPickedProductId(productId);
    setSelectedUnitValue("base");
    setQuantity("");
    const row = products.find((r) => r.product_id === productId);
    setCostPerUnit(row ? String(row.cost_price ?? row.product.cost_price) : "");
  }

  function stageItem() {
    if (!pickedRow) return;

    const quantityNumber = Number(quantity);
    const costNumber = Number(costPerUnit);
    if (!Number.isInteger(quantityNumber) || quantityNumber <= 0) {
      setError("الكمية يجب أن تكون عدداً صحيحاً أكبر من صفر");
      return;
    }
    if (!Number.isFinite(costNumber) || costNumber < 0) {
      setError("سعر الشراء يجب أن يكون صفراً أو أكبر");
      return;
    }

    setError(null);
    setStagedItems((items) => [
      ...items,
      {
        productId: pickedRow.product_id,
        productName: pickedRow.product.name,
        baseUnitLabel: pickedRow.product.unit,
        unitOptions: pickedUnitOptions,
        selectedUnitValue,
        quantity,
        costPerUnit,
      },
    ]);
    setPickedProductId("");
    setSelectedUnitValue("base");
    setQuantity("");
    setCostPerUnit("");
  }

  function removeStagedItem(productId: string) {
    setStagedItems((items) => items.filter((item) => item.productId !== productId));
  }

  async function handleReceiveAll() {
    if (stagedItems.length === 0) return;
    if (!paymentMethod) {
      setError("يجب تحديد طريقة الدفع");
      return;
    }
    if (!storeId) {
      setError("تعذر تحديد المتجر — الرجاء إعادة تسجيل الدخول");
      return;
    }

    setError(null);
    setIsSaving(true);
    const supabase = createClient();
    const newItemErrors = new Map<string, string>();
    const remaining: StagedReceiveItem[] = [];
    let successCount = 0;

    for (const item of stagedItems) {
      const unit = item.unitOptions.find((o) => o.value === item.selectedUnitValue);
      const factor = unit?.factor ?? 1;
      try {
        await recordStockPurchase(
          supabase,
          {
            productId: item.productId,
            productName: item.productName,
            purchasedQuantity: Number(item.quantity),
            unitName: item.selectedUnitValue === "base" ? null : (unit?.label ?? null),
            conversionFactor: factor,
            costPerPurchasedUnit: Number(item.costPerUnit),
            supplierId,
            supplierName,
            invoiceNumber: invoiceNumber.trim() || null,
            paymentMethod,
          },
          user?.id ?? null,
          storeId,
        );
        successCount++;
      } catch (err) {
        newItemErrors.set(item.productId, err instanceof Error ? err.message : "فشل الاستلام");
        remaining.push(item);
      }
    }

    setItemErrors(newItemErrors);
    setStagedItems(remaining);
    setIsSaving(false);

    if (successCount > 0) {
      setSuccessMessage(`تم استلام ${successCount} منتج`);
      onChanged();
    }
    if (remaining.length === 0) {
      setIsOpen(false);
    }
  }

  return (
    <>
      <Button variant="secondary" className="w-full" onClick={() => void openModal()}>
        استلام بضاعة
      </Button>

      <Modal open={isOpen} onClose={() => setIsOpen(false)} title="استلام بضاعة">
        {products.length === 0 ? (
          <div className="flex flex-col items-center gap-1 p-6 text-center">
            <p className="text-gray-400">لا توجد منتجات مرتبطة بهذا المورد بعد</p>
            <p className="text-sm text-gray-400">استخدم زر ربط منتج أولاً</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label htmlFor="receive-stock-product" className="text-sm font-medium text-gray-700">
                المنتج
              </label>
              <select
                id="receive-stock-product"
                value={pickedProductId}
                onChange={(event) => pickProduct(event.target.value)}
                className="h-11 rounded-lg border border-gray-300 px-3 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
              >
                <option value="">اختر منتجاً</option>
                {products
                  .filter((row) => !stagedProductIds.has(row.product_id))
                  .map((row) => (
                    <option key={row.product_id} value={row.product_id}>
                      {row.product.name}
                    </option>
                  ))}
              </select>
            </div>

            {pickedRow ? (
              <div className="flex flex-col gap-4 border-t border-gray-100 pt-4">
                <div className="flex flex-col gap-1">
                  <label htmlFor="receive-stock-unit" className="text-sm font-medium text-gray-700">
                    وحدة الشراء
                  </label>
                  <select
                    id="receive-stock-unit"
                    value={selectedUnitValue}
                    onChange={(event) => setSelectedUnitValue(event.target.value)}
                    className="h-11 rounded-lg border border-gray-300 px-3 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
                  >
                    {pickedUnitOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                        {option.factor > 1 ? ` (= ${option.factor} ${pickedRow.product.unit})` : ""}
                      </option>
                    ))}
                  </select>
                </div>

                <Input
                  label={`الكمية (${pickedSelectedUnit?.label ?? pickedRow.product.unit})`}
                  type="number"
                  min={1}
                  step={1}
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                />

                <Input
                  label={`سعر الشراء لكل ${pickedSelectedUnit?.label ?? pickedRow.product.unit}`}
                  type="number"
                  min={0}
                  step="0.01"
                  value={costPerUnit}
                  onChange={(event) => setCostPerUnit(event.target.value)}
                />

                <Button type="button" onClick={stageItem}>
                  إضافة إلى القائمة
                </Button>
              </div>
            ) : null}

            {stagedItems.length > 0 ? (
              <div className="flex flex-col gap-2 border-t border-gray-100 pt-4">
                <h4 className="text-sm font-semibold text-gray-700">المنتجات المضافة ({stagedItems.length})</h4>
                <Card className="p-0">
                  <div className="flex flex-col divide-y divide-gray-100">
                    {stagedItems.map((item) => {
                      const unit = item.unitOptions.find((o) => o.value === item.selectedUnitValue);
                      const unitLabel = unit?.label ?? item.baseUnitLabel;
                      const itemError = itemErrors.get(item.productId);
                      return (
                        <div key={item.productId} className="flex flex-col gap-1 p-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex flex-col gap-0.5">
                              <p className="truncate text-sm font-medium text-gray-900">{item.productName}</p>
                              <p className="text-xs text-gray-400">
                                {item.quantity} {unitLabel} × {formatCurrency(Number(item.costPerUnit) || 0)}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => removeStagedItem(item.productId)}
                              disabled={isSaving}
                              className="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                              aria-label="إزالة من القائمة"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                          {itemError ? <p className="text-xs text-red-600">{itemError}</p> : null}
                        </div>
                      );
                    })}
                  </div>
                </Card>
              </div>
            ) : null}

            <div className="flex flex-col gap-4 border-t border-gray-100 pt-4">
              <Input
                label="رقم الفاتورة (اختياري)"
                value={invoiceNumber}
                onChange={(event) => setInvoiceNumber(event.target.value)}
              />

              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium text-gray-700">طريقة الدفع</span>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={paymentMethod === "cash" ? "primary" : "secondary"}
                    className="flex-1"
                    onClick={() => setPaymentMethod("cash")}
                  >
                    نقداً
                  </Button>
                  <Button
                    type="button"
                    variant={paymentMethod === "credit" ? "primary" : "secondary"}
                    className="flex-1"
                    onClick={() => setPaymentMethod("credit")}
                  >
                    آجل
                  </Button>
                </div>
              </div>
            </div>

            {error ? <p className="text-sm text-red-600">{error}</p> : null}

            <Button
              type="button"
              size="lg"
              disabled={stagedItems.length === 0 || isSaving}
              onClick={() => void handleReceiveAll()}
            >
              {isSaving ? "جارٍ الحفظ..." : `استلام (${stagedItems.length})`}
            </Button>
          </div>
        )}
      </Modal>

      {successMessage ? <Toast message={successMessage} onDismiss={() => setSuccessMessage(null)} /> : null}
    </>
  );
}
