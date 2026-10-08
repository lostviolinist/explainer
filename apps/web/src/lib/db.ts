import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const g = globalThis as unknown as { __sql?: ReturnType<typeof postgres> };
const sql = g.__sql ?? postgres(process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/explainer", { max: 10 });
if (process.env.NODE_ENV !== "production") g.__sql = sql;

export const db = drizzle(sql, { schema });
export { schema };
