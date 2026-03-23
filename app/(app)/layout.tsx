import { AppLayout } from "@/components/app-layout";
import { AccountStatusHandler } from "@/components/account-status-handler";

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AppLayout>
      {children}
      <AccountStatusHandler />
    </AppLayout>
  );
}
