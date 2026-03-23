export type AuthContext = {
  principalId: string;   // DB user.id (UUID)
  supabaseId: string;    // Supabase auth.uid()
  email: string;
  roles: string[];
  traceId: string;       // Per-request trace ID for structured logging
};
