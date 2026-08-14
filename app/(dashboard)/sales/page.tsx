"use client";

import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useDailyReport } from "@/hooks/useDailyReport";
import { useSalesAnalytics } from "@/hooks/useSalesAnalytics";
import { DailyReport } from "@/components/features/sales/DailyReport";
import { SalesTrendChart } from "@/components/features/sales/SalesTrendChart";
import { RankingList } from "@/components/features/sales/RankingList";
import { CashierRankingList } from "@/components/features/sales/CashierRankingList";
import { RangeDatePicker } from "@/components/features/sales/RangeDatePicker";
import type { CustomRange, PresetDays } from "@/components/features/sales/RangeDatePicker";
import { Tabs } from "@/components/ui/Tabs";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { BackToSettingsLink } from "@/components/shared/BackToSettingsLink";
import { SalesExportModal } from "@/components/features/sales/SalesExportModal";

type PageTab = "today" | "trend" | "ranking";
type RankingSubTab = "categories" | "products" | "cashiers";

const PAGE_TABS: { value: PageTab; label: string }[] = [
  { value: "today", label: "اليوم" },
  { value: "trend", label: "الاتجاه" },
  { value: "ranking", label: "الترتيب" },
];

const RANKING_SUB_TABS: { value: RankingSubTab; label: string }[] = [
  { value: "categories", label: "الأقسام" },
  { value: "products", label: "المنتجات" },
  { value: "cashiers", label: "الكاشير" },
];

function todayCustomRange(): CustomRange {
  const today = new Date().toISOString().slice(0, 10);
  return { startDate: today, endDate: today };
}

export default function SalesPage() {
  const { role } = useAuth();
  const isAdmin = role === "admin";

  const [activeTab, setActiveTab] = useState<PageTab>("today");
  const [rankingSubTab, setRankingSubTab] = useState<RankingSubTab>("categories");
  const [selectedCategory, setSelectedCategory] = useState<{ id: string | null; name: string } | null>(null);
  const [customRange, setCustomRange] = useState<CustomRange>(todayCustomRange());
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);

  const dailyReport = useDailyReport(new Date(), isAdmin);
  const analytics = useSalesAnalytics();

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 p-10 text-center">
        <p className="text-lg font-semibold text-gray-900">هذي الصفحة للمالك فقط</p>
        <p className="text-sm text-gray-500">ما عندك صلاحية الوصول لتقارير المبيعات والأرباح.</p>
      </div>
    );
  }

  function handleTabChange(tab: PageTab) {
    setActiveTab(tab);
    if (tab === "trend" || tab === "ranking") {
      analytics.ensureLoaded();
    }
  }

  function handlePresetChange(days: PresetDays) {
    setCustomRange(todayCustomRange());
    analytics.setRange({ kind: "preset", days });
  }

  function handleCustomRangeChange(range: CustomRange) {
    setCustomRange(range);
    if (!range.startDate || !range.endDate) return;
    analytics.setRange({ kind: "custom", startDate: new Date(range.startDate), endDate: new Date(range.endDate) });
  }

  const currentPresetDays = analytics.range.kind === "preset" ? analytics.range.days : null;

  const drilldownProducts = selectedCategory
    ? analytics.productRanking.filter((product) => product.categoryId === selectedCategory.id)
    : [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <BackToSettingsLink />
        <div className="mt-1 flex items-center justify-between gap-2">
          <h1 className="text-xl font-bold text-gray-900">تحليلات المبيعات</h1>
          <Button type="button" variant="secondary" size="sm" onClick={() => setIsExportModalOpen(true)}>
            تصدير Excel
          </Button>
        </div>
        <Tabs options={PAGE_TABS} value={activeTab} onChange={handleTabChange} className="mt-4" />
      </div>

      {activeTab === "today" ? (
        <div>
          {dailyReport.isLoading ? (
            <p className="p-6 text-center text-gray-400">جارٍ التحميل...</p>
          ) : dailyReport.error ? (
            <p className="p-6 text-center text-red-600">{dailyReport.error}</p>
          ) : dailyReport.data ? (
            <DailyReport report={dailyReport.data} />
          ) : null}
        </div>
      ) : null}

      {activeTab === "trend" ? (
        <div className="flex flex-col gap-4">
          <RangeDatePicker
            preset={currentPresetDays}
            customRange={customRange}
            onPresetChange={handlePresetChange}
            onCustomRangeChange={handleCustomRangeChange}
          />
          {analytics.isLoading ? (
            <p className="p-6 text-center text-gray-400">جارٍ التحميل...</p>
          ) : analytics.error ? (
            <p className="p-6 text-center text-red-600">{analytics.error}</p>
          ) : (
            <SalesTrendChart data={analytics.trend} />
          )}
        </div>
      ) : null}

      {activeTab === "ranking" ? (
        <div className="flex flex-col gap-4">
          <RangeDatePicker
            preset={currentPresetDays}
            customRange={customRange}
            onPresetChange={handlePresetChange}
            onCustomRangeChange={handleCustomRangeChange}
          />
          <Tabs options={RANKING_SUB_TABS} value={rankingSubTab} onChange={setRankingSubTab} />

          {analytics.isLoading ? (
            <p className="p-6 text-center text-gray-400">جارٍ التحميل...</p>
          ) : analytics.error ? (
            <p className="p-6 text-center text-red-600">{analytics.error}</p>
          ) : rankingSubTab === "categories" ? (
            <RankingList
              title="ترتيب الأقسام"
              items={analytics.categoryRanking}
              onCategoryClick={(id, name) => setSelectedCategory({ id, name })}
            />
          ) : rankingSubTab === "products" ? (
            <RankingList title="ترتيب المنتجات" items={analytics.productRanking} />
          ) : (
            <CashierRankingList items={analytics.cashierRanking} />
          )}
        </div>
      ) : null}

      <Modal
        open={selectedCategory !== null}
        onClose={() => setSelectedCategory(null)}
        title={selectedCategory ? `منتجات قسم: ${selectedCategory.name}` : undefined}
      >
        <RankingList title="" items={drilldownProducts} />
      </Modal>

      <SalesExportModal open={isExportModalOpen} onClose={() => setIsExportModalOpen(false)} />
    </div>
  );
}
