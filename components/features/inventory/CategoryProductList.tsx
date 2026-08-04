import type { Category, ProductWithCategory } from "@/types/product";
import { isLowStock } from "@/types/product";
import { cn } from "@/lib/utils";

interface CategoryProductListProps {
  products: ProductWithCategory[];
  categories: Category[];
}

const OTHER_CATEGORY_LABEL = "أخرى";

/** Mobile-first grouped product list — one collapsible section per category. */
export function CategoryProductList({ products, categories }: CategoryProductListProps) {
  if (products.length === 0) {
    return <p className="p-6 text-center text-gray-400">لا توجد منتجات بعد — أضف أول منتج</p>;
  }

  const sortedCategories = [...categories].sort((a, b) => a.sort_order - b.sort_order);
  const grouped = sortedCategories.map((category) => ({
    category,
    products: products.filter((product) => product.category_id === category.id),
  }));

  const uncategorized = products.filter((product) => product.category_id === null);

  return (
    <div className="flex flex-col gap-3">
      {grouped
        .filter((group) => group.products.length > 0)
        .map((group) => (
          <details key={group.category.id} className="rounded-xl border border-gray-200 bg-white" open>
            <summary className="flex cursor-pointer items-center justify-between p-4 font-semibold text-gray-900">
              <span>{group.category.name}</span>
              <span className="text-sm font-normal text-gray-400">{group.products.length}</span>
            </summary>
            <div className="flex flex-col gap-2 border-t border-gray-100 p-3">
              {group.products.map((product) => (
                <ProductRow key={product.id} product={product} />
              ))}
            </div>
          </details>
        ))}

      {uncategorized.length > 0 ? (
        <details className="rounded-xl border border-gray-200 bg-white" open>
          <summary className="flex cursor-pointer items-center justify-between p-4 font-semibold text-gray-900">
            <span>{OTHER_CATEGORY_LABEL}</span>
            <span className="text-sm font-normal text-gray-400">{uncategorized.length}</span>
          </summary>
          <div className="flex flex-col gap-2 border-t border-gray-100 p-3">
            {uncategorized.map((product) => (
              <ProductRow key={product.id} product={product} />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function ProductRow({ product }: { product: ProductWithCategory }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2">
      <span className="font-medium text-gray-900">{product.name}</span>
      <span className={cn("font-semibold", isLowStock(product) && "text-red-600")}>
        {product.quantity}
        {isLowStock(product) ? " ⚠" : ""}
      </span>
    </div>
  );
}
