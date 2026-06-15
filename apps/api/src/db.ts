import pg from "pg";
import { isDemoMode } from "./config.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function databaseAvailable(): Promise<boolean> {
  if (isDemoMode) return false;
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
