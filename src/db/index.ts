import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schemaV1 from "./schema";
import * as schemaScreen from "./screen-schema";

const connectionString = process.env.DATABASE_URL!;

const client = postgres(connectionString, { prepare: false });

export const db = drizzle(client, { schema: { ...schemaV1, ...schemaScreen } });

export type Database = typeof db;
