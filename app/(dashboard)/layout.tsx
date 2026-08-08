import { AuthProvider } from "@/context/AuthContext";
import { OfflineProvider } from "@/context/OfflineContext";
import { POSProvider } from "@/context/POSContext";
import { Navbar } from "@/components/shared/Navbar";
import { Sidebar } from "@/components/shared/Sidebar";
import { BottomNav } from "@/components/shared/BottomNav";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <OfflineProvider>
        <POSProvider>
          <div className="flex min-h-screen flex-col">
            <Navbar />
            <div className="flex flex-1">
              <Sidebar />
              <main className="min-w-0 max-w-full flex-1 overflow-x-hidden p-3 pb-20 lg:p-6 lg:pb-6">{children}</main>
            </div>
            <BottomNav />
          </div>
        </POSProvider>
      </OfflineProvider>
    </AuthProvider>
  );
}
