import { Pool } from "pg";

export const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 })
  : null;

export function requireDatabase() {
  if (!pool) throw new Error("Database is not configured. Set DATABASE_URL.");
  return pool;
}
