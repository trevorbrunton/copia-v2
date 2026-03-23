# Composition Root & Unit of Work — Line-by-Line Explanation

This document explains the composition root (`makeDeps`) and the Unit of Work pattern (`DrizzleUoW`, `DrizzleReadOnly`). In the create project flow, these are the next pieces after auth resolution:

```typescript
const result = await handleCreateProject(makeDeps(), body, ctx);
//                                       ^^^^^^^^^^
//                                       composition root
```

And inside the handler:

```typescript
return deps.uow.run(ctx, async ({ db: tx }) => {
  return createProject(tx, ctx.principalId, input);
});
```

---

## File 1: `src/server/make-deps.ts` — The Composition Root

This file is the **single place** where all dependencies are assembled. Every route handler calls `makeDeps()` to get its dependencies instead of importing them directly.

### Lines 1–3: Imports

```typescript
import { DrizzleUoW, DrizzleReadOnly } from "./uow/drizzle-uow";
```
The concrete implementations of the Unit of Work interfaces. `DrizzleUoW` handles read-write transactions (for commands). `DrizzleReadOnly` handles read-only transactions (for queries).

```typescript
import type { UnitOfWork } from "./uow/types";
import type { ReadOnlyExecutor } from "./uow/types";
```
The **interfaces** that the handler layer depends on — not the concrete implementations. This is the Dependency Inversion Principle: handlers depend on abstractions (`UnitOfWork`, `ReadOnlyExecutor`), and the composition root decides which concrete class implements them. In tests, you could substitute fake implementations here.

### Lines 5–8: The Deps interface

```typescript
export interface Deps {
  uow: UnitOfWork;
  readOnly: ReadOnlyExecutor;
}
```
Defines the shape of the dependency object that handlers receive. Currently contains two members:

**`uow: UnitOfWork`** — Used by command handlers (writes). Opens a transaction, sets tenant identity via `request.jwt.claims`, executes the handler's callback, and commits or rolls back.

**`readOnly: ReadOnlyExecutor`** — Used by query handlers (reads). Same as `uow` but also sets `SET TRANSACTION READ ONLY`, which causes PostgreSQL to reject any INSERT/UPDATE/DELETE statements inside the transaction. This prevents accidental writes in query handlers.

In the reference architecture guide, `Deps` (called `AppDeps`) also includes repositories, policy objects, and an outbox writer. Mayfly's simpler model doesn't need those yet — services are called directly, authorization is implicit via `userId`, and there's no outbox.

### Lines 10–20: The singleton factory

```typescript
let _deps: Deps | null = null;
```
Module-level variable holding the cached singleton. Starts as `null`. Once created, the same `Deps` object is reused for every request.

```typescript
export function makeDeps(): Deps {
  if (!_deps) {
    _deps = {
      uow: new DrizzleUoW(),
      readOnly: new DrizzleReadOnly(),
    };
  }
  return _deps;
}
```
**Lazy singleton pattern.** The first call creates the `Deps` object. All subsequent calls return the same object.

**Why a singleton?** Both `DrizzleUoW` and `DrizzleReadOnly` are stateless — they don't hold any per-request data. They just wrap the shared database connection pool (`db` from `src/db/index.ts`). Creating new instances on every request would work identically but would create unnecessary garbage for the garbage collector.

**Why not just export a constant?** Using a function allows for lazy initialization and makes it easier to substitute fakes in tests. You could modify this function to accept overrides, or replace `_deps` in test setup.

**`new DrizzleUoW()`** — Note: no arguments. The UoW imports the database connection internally from `@/src/db`. In the reference guide, the database is passed in as `new DrizzleUnitOfWork(db)` — Mayfly simplifies this since there's only one database.

---

## File 2: `src/server/uow/types.ts` — The Interfaces

The abstract contracts that handlers program against.

### Lines 1–2: Imports

```typescript
import type { TransactionClient } from "@/src/lib/tenant";
```
The Drizzle transaction type. This is what you get when you call `db.transaction(async (tx) => ...)` — it's a database connection scoped to a single transaction. All queries run through it are part of the same atomic operation.

```typescript
import type { AuthContext } from "../auth-context";
```
The `{ principalId, supabaseId, email, roles }` type from auth resolution.

### Lines 4–6: TransactionContext

```typescript
export interface TransactionContext {
  db: TransactionClient;
}
```
What the handler's callback function receives inside a transaction. Currently only contains `db` — the transaction handle.

In the reference architecture, this would also include `outbox: OutboxWriter` and `idempotency: IdempotencyStore`. All three would share the same transaction, so writing to the outbox or checking idempotency would be atomic with the main database operation.

The handler destructures this as `{ db: tx }` for readability:
```typescript
deps.uow.run(ctx, async ({ db: tx }) => {
  // tx is the transaction handle
});
```

### Lines 8–10: UnitOfWork interface

```typescript
export interface UnitOfWork {
  run<T>(ctx: AuthContext, fn: (tx: TransactionContext) => Promise<T>): Promise<T>;
}
```
The contract for read-write transactions.

**`run<T>`** — Generic over the return type. Whatever the callback returns, `run` returns the same type.

**`ctx: AuthContext`** — The authenticated user context. The UoW uses `ctx.principalId` to set `request.jwt.claims` inside the transaction, so `auth.uid()` returns the correct user ID for RLS enforcement.

**`fn: (tx: TransactionContext) => Promise<T>`** — The callback that runs inside the transaction. It receives a `TransactionContext` containing the transaction handle. If this function throws, the transaction rolls back. If it returns normally, the transaction commits.

### Lines 12–18: ReadOnlyExecutor interface

```typescript
export interface ReadOnlyContext {
  db: TransactionClient;
}

export interface ReadOnlyExecutor {
  run<T>(ctx: AuthContext, fn: (tx: ReadOnlyContext) => Promise<T>): Promise<T>;
}
```
Identical shape to `UnitOfWork`, but semantically different. The implementation adds `SET TRANSACTION READ ONLY` to prevent writes. Having a separate type makes it impossible to accidentally pass a `ReadOnlyExecutor` where a `UnitOfWork` is expected (TypeScript checks this at compile time, though structurally they're compatible — the protection is more about intent).

---

## File 3: `src/server/uow/drizzle-uow.ts` — The Implementation

The concrete classes that actually open transactions and set tenant identity.

### Lines 1–3: Imports

```typescript
import { sql } from "drizzle-orm";
```
Drizzle's `sql` template tag for raw SQL. Used to execute `SET LOCAL` statements that can't be expressed as Drizzle queries.

```typescript
import { db } from "@/src/db";
```
The shared database connection pool. This is a Drizzle ORM instance backed by a `postgres-js` connection to Supabase PostgreSQL.

```typescript
import type { AuthContext } from "../auth-context";
```
The auth context type — needed to extract `principalId`.

```typescript
import type {
  UnitOfWork, TransactionContext,
  ReadOnlyExecutor, ReadOnlyContext,
} from "./types";
```
The interfaces this file implements.

### Lines 17–23: JWT claims builder

```typescript
function jwtClaimsSql(ctx: AuthContext): string {
  const claims = JSON.stringify({
    sub: ctx.principalId,
    role: "authenticated",
  });
  return `SET LOCAL request.jwt.claims = '${claims.replace(/'/g, "''")}'`;
}
```
Builds the SQL statement that sets tenant identity for the transaction.

**`sub: ctx.principalId`** — The JWT `sub` (subject) claim is set to the internal database UUID. Supabase's `auth.uid()` function reads from `request.jwt.claims->>'sub'`, so after this statement executes, `auth.uid()` returns `ctx.principalId`.

**`role: "authenticated"`** — Standard Supabase JWT claim. Some RLS policies check the role.

**`JSON.stringify(...)`** — PostgreSQL expects the claims as a JSON string.

**`claims.replace(/'/g, "''")`** — Escapes single quotes for SQL. A single quote `'` becomes `''` (two single quotes), which is PostgreSQL's escape syntax. This is necessary because we're building a raw SQL string. UUIDs and the word "authenticated" don't contain quotes, so this is a safety measure rather than something that triggers in practice.

**`SET LOCAL`** — The `LOCAL` keyword means this setting only lasts for the current transaction. When the transaction commits or rolls back, `request.jwt.claims` automatically resets. This prevents tenant identity from leaking between requests sharing the same database connection.

**Why raw SQL?** PostgreSQL's `SET LOCAL` doesn't support parameterised queries (`$1`). You can't write `SET LOCAL request.jwt.claims = $1` — it's a syntax error. So we must use `sql.raw()` with manual string building.

### Lines 25–38: DrizzleUoW (read-write)

```typescript
export class DrizzleUoW implements UnitOfWork {
  async run<T>(
    ctx: AuthContext,
    fn: (tx: TransactionContext) => Promise<T>
  ): Promise<T> {
    return db.transaction(async (tx) => {
```
**`db.transaction()`** — Opens a PostgreSQL transaction (`BEGIN`). Everything inside the callback runs in that transaction. If the callback returns normally, Drizzle calls `COMMIT`. If it throws, Drizzle calls `ROLLBACK`.

**`tx`** — The transaction handle. All queries run through `tx` instead of `db` are part of this transaction.

```typescript
      // Inject JWT claims so auth.uid() returns principalId for RLS enforcement
      await tx.execute(sql.raw(jwtClaimsSql(ctx)));
```
**Set tenant identity.** Executes:
```sql
SET LOCAL request.jwt.claims = '{"sub":"<principalId>","role":"authenticated"}'
```
After this, `auth.uid()` returns `ctx.principalId` for the rest of the transaction. RLS policies like `user_id = auth.uid()` now enforce tenant isolation.

```typescript
      await tx.execute(sql.raw(`SET LOCAL statement_timeout = '30000'`));
```
**Set query timeout.** 30,000 milliseconds = 30 seconds. If any single SQL statement in this transaction takes longer than 30 seconds, PostgreSQL will cancel it and the transaction will roll back. This prevents runaway queries from holding connections indefinitely.

`SET LOCAL` scopes this to the transaction — it doesn't affect other connections or subsequent transactions on the same connection.

```typescript
      return fn({ db: tx });
    });
  }
}
```
**Run the handler's callback** with the transaction handle wrapped in a `TransactionContext`. The return value of `fn` becomes the return value of `run`, which becomes the return value of the handler, which becomes the JSON response body.

### Lines 40–52: DrizzleReadOnly (read-only)

```typescript
export class DrizzleReadOnly implements ReadOnlyExecutor {
  async run<T>(
    ctx: AuthContext,
    fn: (tx: ReadOnlyContext) => Promise<T>
  ): Promise<T> {
    return db.transaction(async (tx) => {
      await tx.execute(sql.raw(jwtClaimsSql(ctx)));
      await tx.execute(sql.raw(`SET LOCAL statement_timeout = '30000'`));
      await tx.execute(sql.raw(`SET TRANSACTION READ ONLY`));
      return fn({ db: tx });
    });
  }
}
```
Identical to `DrizzleUoW` except for one additional line:

**`SET TRANSACTION READ ONLY`** — Tells PostgreSQL to reject any data-modifying statements (INSERT, UPDATE, DELETE) in this transaction. If a query handler accidentally calls a service function that writes, PostgreSQL will throw an error immediately rather than silently modifying data. This is a safety net that enforces the command/query separation at the database level.

Note: this uses `SET TRANSACTION` (not `SET LOCAL`). `SET TRANSACTION` applies to the current transaction specifically and is the correct syntax for changing the transaction's read-only status.

---

## How It All Connects in Create Project

```
route.ts:
  handleCreateProject(makeDeps(), body, ctx)
                      │
                      ▼
make-deps.ts:
  makeDeps() → { uow: DrizzleUoW, readOnly: DrizzleReadOnly }
                  │
                  ▼
create-project.ts:
  deps.uow.run(ctx, async ({ db: tx }) => {
    return createProject(tx, ctx.principalId, input);
  });
       │
       ▼
drizzle-uow.ts:
  db.transaction(async (tx) => {
    SET LOCAL request.jwt.claims = '{"sub":"<principalId>",...}'
    SET LOCAL statement_timeout = '30000'
    ───── handler callback runs here ─────
    createProject(tx, userId, input)  ← uses tx, not db
      └── INSERT INTO projects ... RETURNING *
    ───── if no error: COMMIT ─────
    ───── if error thrown: ROLLBACK ─────
  });
```

### What the UoW guarantees:

1. **Atomicity** — Everything in the callback either commits or rolls back together. If `createProject` succeeds but a subsequent operation in the same callback fails, the project insert is rolled back too.

2. **Tenant identity** — `auth.uid()` returns the correct `principalId` for the duration of the transaction. RLS policies can enforce tenant isolation.

3. **Timeout protection** — No single query can run longer than 30 seconds.

4. **Automatic cleanup** — `SET LOCAL` settings reset when the transaction ends. No tenant identity leaks between requests.

5. **Read-only enforcement** (for queries) — `DrizzleReadOnly` prevents accidental writes in query handlers at the PostgreSQL level.
