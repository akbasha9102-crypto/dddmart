"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getSaleItems } from "@/services/sales.service";
import type { Sale, SaleItem } from "@/types/pos";
import { ReceiptPrinter } from "@/components/features/pos/ReceiptPrinter";
import { SaleReturnPanel } from "@/components/features/sales/SaleReturnPanel";

interface InvoiceViewProps {
  sale: Sale;
  onClose: () => void;
}

/** Reuses the POS receipt layout to show a past invoice's line items, followed by the shared return panel (admin /sales flow — reachability unchanged, still admin-gated at the page level). */
export function InvoiceView({ sale, onClose }: InvoiceViewProps) {
  const [items, setItems] = useState<SaleItem[] | null>(null);

  useEffect(() => {
    const supabase = createClient();
    void getSaleItems(supabase, sale.id).then(setItems);
  }, [sale.id]);

  if (!items) {
    return <p className="p-4 text-center text-gray-400">جارٍ التحميل...</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <ReceiptPrinter receipt={{ sale, items, changeAmount: sale.change_amount }} onClose={onClose} />
      <SaleReturnPanel sale={sale} />
    </div>
  );
}
