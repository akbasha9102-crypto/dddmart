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
    <div className="flex flex-col gap-2">
      {items.map((item) => (
        <div key={item.barcode} className="flex flex-col gap-2 rounded-xl border border-gray-100 bg-gray-50/60 p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-[15px] font-semibold text-gray-900">
                {item.name}
                {item.unitName ? (
                  <span className="mr-1 text-xs font-normal text-gray-500">({item.unitName})</span>
                ) : null}
              </span>
              <span className="text-sm text-gray-500">{formatCurrency(item.unitPrice)} / وحدة</span>
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => updateQuantity(item.barcode, item.quantity - 1)}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-white text-lg font-bold text-gray-700 shadow-sm hover:bg-gray-100"
                aria-label="إنقاص الكمية"
              >
                −
              </button>
              <span className="w-10 text-center text-base font-semibold">{item.quantity}</span>
              <button
                type="button"
                onClick={() => updateQuantity(item.barcode, item.quantity + 1)}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-white text-lg font-bold text-gray-700 shadow-sm hover:bg-gray-100"
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
                className="-m-2 px-2 py-2 text-sm font-medium text-red-600"
                aria-label="حذف المنتج"
              >
                حذف
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
