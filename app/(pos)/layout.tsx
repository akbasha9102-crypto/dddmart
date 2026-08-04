import { AuthProvider } from "@/context/AuthContext";
import { POSProvider } from "@/context/POSContext";

export default function POSLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <POSProvider>{children}</POSProvider>
    </AuthProvider>
  );
}
