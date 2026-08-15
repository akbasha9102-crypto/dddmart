"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { recordStockPurchase } from "@/services/products.service";
import { listSuppliers } from "@/services/suppliers.service";
import { useAuth } from "@/context/AuthContext";
import { toBaseUnitCost, toBaseUnits } from "@/lib/units";
import { formatCurrency } from "@/lib/utils";
import type { Product, ProductUnit } from "@/types/product";
import type { SupplierWithBalance } from "@/types/supplier";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

interface ReceiveStockFormProps {
  product: Product;
  units: ProductUnit[];
  onSaved: (updatedProduct: Product) => void;
  onCancel: () => void;
}

/** Lets an admin record a wholesale purchase (e.g. a كرتونة) and automatically break it down into base-unit stock, updating cost_price via weighted average. Admins additionally see optional supplier/invoice/payment-method fields that post to the supplier's ledger; a cashier sees only quantity/cost, unchanged from before. */
export function ReceiveStockForm({ product, units, onSaved, onCancel }: ReceiveStockFormProps) {
  const { user, storeId, role } = useAuth();
  const isAdmin = role === "admin";

  const unitOptions = useMemo(
    () => [
      { value: "base", label: product.unit, factor: 1 },
      ...units.map((unit) => ({ value: unit.id, label: unit.unit_name, factor: unit.conversion_factor })),
    ],
    [product.unit, units],
  );

  const [selectedUnitValue, setSelectedUnitValue] = useState("base");
  const [purchasedQuantity, setPurchasedQuantity] = useState("");
  const [costPerUnit, setCostPerUnit] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [suppliers, setSuppliers] = useState<SupplierWithBalance[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "credit" | "">("");

  useEffect(() => {
    if (!isAdmin) return;
    const supabase = createClient();
    listSuppliers(supabase)
      .then(setSuppliers)
      .catch(() => setSuppliers([]));
  }, [isAdmin]);

  function handleSupplierChange(value: string) {
    setSupplierId(value);
    if (!value) setPaymentMethod("");
  }

  const baseUnitOption = { value: "base", label: product.unit, factor: 1 };
  const selectedUnit = unitOptions.find((option) => option.value === selectedUnitValue) ?? baseUnitOption;

  const quantityNumber = Number(purchasedQuantity);
  const costNumber = Number(costPerUnit);
  const isPreviewValid =
    purchasedQuantity !== "" && costPerUnit !== "" && Number.isFinite(quantityNumber) && quantityNumber > 0 && Number.isFinite(costNumber) && costNumber >= 0;

  const addedBaseUnits = isPreviewValid ? toBaseUnits(quantityNumber, selectedUnit.factor) : 0;
  const estimatedNewCost = isPreviewValid
    ? (product.quantity * product.cost_price + addedBaseUnits * toBaseUnitCost(costNumber, selectedUnit.factor)) /
      (product.quantity + addedBaseUnits)
    : 0;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!Number.isInteger(quantityNumber) || quantityNumber <= 0) {
      setError("الكمية يجب أن تكون عدداً صحيحاً أكبر من صفر");
      return;
    }
    if (!Number.isFinite(costNumber) || costNumber < 0) {
      setError("سعر الشراء يجب أن يكون صفراً أو أكبر");
      return;
    }
    if (isAdmin && supplierId && !paymentMethod) {
      setError("يجب تحديد طريقة الدفع عند اختيار مورد");
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
      const selectedSupplier = suppliers.find((supplier) => supplier.id === supplierId);
      const updated = await recordStockPurchase(
        supabase,
        {
          productId: product.id,
          productName: product.name,
          purchasedQuantity: quantityNumber,
          unitName: selectedUnit.value === "base" ? null : selectedUnit.label,
          conversionFactor: selectedUnit.factor,
          costPerPurchasedUnit: costNumber,
          supplierId: isAdmin && supplierId ? supplierId : null,
          supplierName: isAdmin && supplierId ? (selectedSupplier?.name ?? null) : null,
          invoiceNumber: isAdmin && invoiceNumber.trim() ? invoiceNumber.trim() : null,
          paymentMethod: isAdmin && supplierId ? (paymentMethod || null) : null,
        },
        user?.id ?? null,
        storeId,
      );
      onSaved(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر استلام المخزون");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="receive-unit" className="text-sm font-medium text-gray-700">
          وحدة الشراء
        </label>
        <select
          id="receive-unit"
          value={selectedUnitValue}
          onChange={(event) => setSelectedUnitValue(event.target.value)}
          className="h-11 rounded-lg border border-gray-300 px-3 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
        >
          {unitOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
              {option.factor > 1 ? ` (= ${option.factor} ${product.unit})` : ""}
            </option>
          ))}
        </select>
      </div>

      <Input
        label={`الكمية المشتراة (${selectedUnit.label})`}
        type="number"
        min={1}
        step={1}
        value={purchasedQuantity}
        onChange={(event) => setPurchasedQuantity(event.target.value)}
        required
      />

      <Input
        label={`سعر الشراء لكل ${selectedUnit.label}`}
        type="number"
        min={0}
        step="0.01"
        value={costPerUnit}
        onChange={(event) => setCostPerUnit(event.target.value)}
        required
      />

      {isAdmin ? (
        <>
          <div className="flex flex-col gap-1">
            <label htmlFor="receive-supplier" className="text-sm font-medium text-gray-700">
              المورد (اختياري)
            </label>
            <select
              id="receive-supplier"
              value={supplierId}
              onChange={(event) => handleSupplierChange(event.target.value)}
              className="h-11 rounded-lg border border-gray-300 px-3 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
            >
              <option value="">بدون مورد</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
          </div>

          <Input
            label="رقم الفاتورة (اختياري)"
            value={invoiceNumber}
            onChange={(event) => setInvoiceNumber(event.target.value)}
          />

          {supplierId ? (
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
          ) : null}
        </>
      ) : null}

      {isPreviewValid ? (
        <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-600">
          سيُضاف {addedBaseUnits} {product.unit}، السعر الجديد التقديري تقريباً {formatCurrency(estimatedNewCost)}
        </p>
      ) : null}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          إلغاء
        </Button>
        <Button type="submit" disabled={isSaving}>
          {isSaving ? "جارٍ الحفظ..." : "استلام"}
        </Button>
      </div>
    </form>
  );
}
