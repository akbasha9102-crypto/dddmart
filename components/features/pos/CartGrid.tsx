"use client";

import { usePOSContext } from "@/context/POSContext";
import { formatCurrency } from "@/lib/utils";

export function CartGrid() {
  const { items, updateQuantity, removeItem } = usePOSContext();

  if (items.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-gray-400">
        السلة فارغة — امسح باركود منتج للبدء
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="flex flex-col gap-2">
        {items.map((item) => (
          <div key={item.barcode} className="rounded-lg border border-gray-100 p-3">
            <div className="flex items-start justify-between gap-2">
              <span className="min-w-0 flex-1 truncate font-medium text-gray-900">
                {item.name}
                {item.unitName ? (
                  <span className="mr-1 text-xs font-normal text-gray-500">({item.unitName})</span>
                ) : null}
              </span>
              <span className="shrink-0 text-sm text-gray-600">{formatCurrency(item.unitPrice)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => updateQuantity(item.barcode, item.quantity - 1)}
                  className="flex h-11 w-11 items-center justify-center rounded-md bg-gray-100 text-lg font-bold hover:bg-gray-200"
                  aria-label="إنقاص الكمية"
                >
                  −
                </button>
                <span className="w-8 text-center font-semibold">{item.quantity}</span>
                <button
                  type="button"
                  onClick={() => updateQuantity(item.barcode, item.quantity + 1)}
                  className="flex h-11 w-11 items-center justify-center rounded-md bg-gray-100 text-lg font-bold hover:bg-gray-200"
                  aria-label="زيادة الكمية"
                >
                  +
                </button>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-semibold text-gray-900">
                  {formatCurrency(item.unitPrice * item.quantity)}
                </span>
                <button
                  type="button"
                  onClick={() => removeItem(item.barcode)}
                  className="text-sm text-red-600 hover:underline"
                  aria-label="حذف المنتج"
                >
                  حذف
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
