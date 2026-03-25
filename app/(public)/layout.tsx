import { AuthProvider } from "@/src/auth/provider";

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthProvider>
      <div className="min-h-svh flex items-center justify-center bg-background">
        {children}
      </div>
    </AuthProvider>
  );
}
