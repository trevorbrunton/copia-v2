import { db } from "@/src/db";

type TransactionClient = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type { TransactionClient };
