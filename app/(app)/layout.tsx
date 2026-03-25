import { AuthProvider } from "@/src/auth/provider";
import { AppLayout } from "@/components/app-layout";
import { AccountStatusHandler } from "@/components/account-status-handler";

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthProvider>
      <AppLayout>
        {children}
        <AccountStatusHandler />
      </AppLayout>
    </AuthProvider>
  );
}
