import type { TransactionClient } from "@/src/lib/tenant";
import type { AuthContext } from "../auth-context";

export interface TransactionContext {
  db: TransactionClient;
}

export interface UnitOfWork {
  run<T>(ctx: AuthContext, fn: (tx: TransactionContext) => Promise<T>): Promise<T>;
}

export interface ReadOnlyContext {
  db: TransactionClient;
}

export interface ReadOnlyExecutor {
  run<T>(ctx: AuthContext, fn: (tx: ReadOnlyContext) => Promise<T>): Promise<T>;
}
