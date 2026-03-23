export interface AuthUser {
  userId: string;
  email: string;
  name?: string;
}

export type AuthState =
  | { status: "loading" }
  | { status: "authenticated"; user: AuthUser }
  | { status: "unauthenticated" };
