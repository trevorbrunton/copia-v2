import { sql } from "drizzle-orm";
import { db } from "@/src/db";
import { logger } from "@/src/lib/logger";
import type { AuthContext } from "../auth-context";
import type {
  UnitOfWork,
  TransactionContext,
  ReadOnlyExecutor,
  ReadOnlyContext,
} from "./types";

/**
 * Build the SET LOCAL statement for request.jwt.claims.
 * auth.uid() reads from request.jwt.claims->>'sub', so we set sub = principalId
 * (the internal DB UUID). This means auth.uid() matches user_id FKs directly —
 * no subqueries needed in RLS policies.
 */
function jwtClaimsSql(ctx: AuthContext): string {
  const claims = JSON.stringify({
    sub: ctx.principalId,
    role: "authenticated",
  });
  return `SET LOCAL request.jwt.claims = '${claims.replace(/'/g, "''")}'`;
}

export class DrizzleUoW implements UnitOfWork {
  async run<T>(
    ctx: AuthContext,
    fn: (tx: TransactionContext) => Promise<T>
  ): Promise<T> {
    logger.debug({ traceId: ctx.traceId }, "uow:start");
    try {
      const result = await db.transaction(async (tx) => {
        // Inject JWT claims so auth.uid() returns principalId for RLS enforcement
        await tx.execute(sql.raw(jwtClaimsSql(ctx)));
        await tx.execute(sql.raw(`SET LOCAL statement_timeout = '30000'`));

        return fn({ db: tx });
      });
      logger.debug({ traceId: ctx.traceId }, "uow:commit");
      return result;
    } catch (err) {
      logger.error(
        { traceId: ctx.traceId, err: String(err) },
        "uow:rollback"
      );
      throw err;
    }
  }
}

export class DrizzleReadOnly implements ReadOnlyExecutor {
  async run<T>(
    ctx: AuthContext,
    fn: (tx: ReadOnlyContext) => Promise<T>
  ): Promise<T> {
    logger.debug({ traceId: ctx.traceId }, "readonly:start");
    try {
      const result = await db.transaction(async (tx) => {
        await tx.execute(sql.raw(jwtClaimsSql(ctx)));
        await tx.execute(sql.raw(`SET LOCAL statement_timeout = '30000'`));
        await tx.execute(sql.raw(`SET TRANSACTION READ ONLY`));
        return fn({ db: tx });
      });
      logger.debug({ traceId: ctx.traceId }, "readonly:complete");
      return result;
    } catch (err) {
      logger.error(
        { traceId: ctx.traceId, err: String(err) },
        "readonly:error"
      );
      throw err;
    }
  }
}
