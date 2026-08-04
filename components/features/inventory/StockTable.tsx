import type { Product } from "@/types/product";
import { isLowStock } from "@/types/product";
import { formatCurrency } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface StockTableProps {
  products: Product[];
  onEdit: (product: Product) => void;
}

export function StockTable({ products, onEdit }: StockTableProps) {
  if (products.length === 0) {
    return <p className="p-6 text-center text-gray-400">لا توجد منتجات بعد — أضف أول منتج</p>;
  }

  return (
    <table className="w-full text-right text-sm">
      <thead className="bg-gray-100 text-gray-500">
        <tr>
          <th className="p-3 font-medium">المنتج</th>
          <th className="p-3 font-medium">الباركود</th>
          <th className="p-3 font-medium">سعر البيع</th>
          <th className="p-3 font-medium">الكمية</th>
          <th className="p-3" />
        </tr>
      </thead>
      <tbody>
        {products.map((product) => (
          <tr key={product.id} className="border-b border-gray-100">
            <td className="p-3 font-medium text-gray-900">{product.name}</td>
            <td className="p-3 font-mono text-gray-500">{product.barcode}</td>
            <td className="p-3">{formatCurrency(product.sale_price)}</td>
            <td className={cn("p-3 font-semibold", isLowStock(product) && "text-red-600")}>
              {product.quantity}
              {isLowStock(product) ? " ⚠" : ""}
            </td>
            <td className="p-3">
              <button type="button" onClick={() => onEdit(product)} className="text-brand-700 hover:underline">
                تعديل
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
