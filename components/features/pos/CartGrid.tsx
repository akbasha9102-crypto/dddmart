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
      <table className="w-full text-right">
        <thead className="sticky top-0 bg-gray-100 text-sm text-gray-500">
          <tr>
            <th className="p-2 font-medium">المنتج</th>
            <th className="p-2 font-medium">السعر</th>
            <th className="p-2 font-medium">الكمية</th>
            <th className="p-2 font-medium">الإجمالي</th>
            <th className="p-2" />
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.barcode} className="border-b border-gray-100">
              <td className="p-2 font-medium text-gray-900">{item.name}</td>
              <td className="p-2 text-gray-600">{formatCurrency(item.unitPrice)}</td>
              <td className="p-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => updateQuantity(item.barcode, item.quantity - 1)}
                    className="h-8 w-8 rounded-md bg-gray-100 text-lg font-bold hover:bg-gray-200"
                    aria-label="إنقاص الكمية"
                  >
                    −
                  </button>
                  <span className="w-8 text-center font-semibold">{item.quantity}</span>
                  <button
                    type="button"
                    onClick={() => updateQuantity(item.barcode, item.quantity + 1)}
                    className="h-8 w-8 rounded-md bg-gray-100 text-lg font-bold hover:bg-gray-200"
                    aria-label="زيادة الكمية"
                  >
                    +
                  </button>
                </div>
              </td>
              <td className="p-2 font-semibold text-gray-900">
                {formatCurrency(item.unitPrice * item.quantity)}
              </td>
              <td className="p-2">
                <button
                  type="button"
                  onClick={() => removeItem(item.barcode)}
                  className="text-sm text-red-600 hover:underline"
                  aria-label="حذف المنتج"
                >
                  حذف
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
