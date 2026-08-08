"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getDailySales } from "@/services/sales.service";
import { formatCurrency, formatTime } from "@/lib/utils";
import type { Sale } from "@/types/pos";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { SaleReturnPanel } from "@/components/features/sales/SaleReturnPanel";

/**
 * Cashier-reachable return entry point, opened from a "المرتجعات" button on
 * /pos (no role gating — cashiers reach /pos with no admin check today,
 * unlike /sales which is fully admin-gated). Lists TODAY's sales only
 * (matches the realistic "customer just bought this today" workflow) with a
 * client-side invoice-number filter, then hands off to the same
 * SaleReturnPanel used by the admin /sales flow. No isAdminRole check
 * anywhere in this component — that's the point of this entry point.
 */
export function ReturnLookup() {
  const [sales, setSales] = useState<Sale[] | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);

  useEffect(() => {
    const supabase = createClient();
    void getDailySales(supabase, new Date()).then(setSales);
  }, []);

  if (selectedSale) {
    return (
      <div className="flex flex-col gap-3">
        <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedSale(null)}>
          ← رجوع لقائمة الفواتير
        </Button>
        <SaleReturnPanel sale={selectedSale} />
      </div>
    );
  }

  if (sales === null) {
    return <p className="p-4 text-center text-gray-400">جارٍ التحميل...</p>;
  }

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredSales = normalizedQuery
    ? sales.filter((sale) => sale.invoice_number.toLowerCase().includes(normalizedQuery))
    : sales;

  return (
    <div className="flex flex-col gap-3">
      <Input
        type="text"
        placeholder="ابحث برقم الفاتورة..."
        value={searchQuery}
        onChange={(event) => setSearchQuery(event.target.value)}
        aria-label="بحث عن فاتورة"
      />

      {filteredSales.length === 0 ? (
        <p className="p-6 text-center text-gray-400">لا توجد فواتير اليوم</p>
      ) : (
        <div className="flex flex-col divide-y divide-gray-100">
          {filteredSales.map((sale) => (
            <button
              key={sale.id}
              type="button"
              onClick={() => setSelectedSale(sale)}
              className="flex items-center justify-between gap-3 py-3 text-right"
            >
              <div className="flex flex-col">
                <span className="font-mono text-sm text-gray-700">{sale.invoice_number}</span>
                <span className="text-xs text-gray-500">{formatTime(sale.created_at)}</span>
              </div>
              <span className="font-semibold text-gray-900">{formatCurrency(sale.total_amount)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
