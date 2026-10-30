import { Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import { Pool } from "pg";
import { obfuscateWithObscura, validateWithOfficialLuau } from "@vanta/engine";


const redisUrl = process.env.REDIS_URL;
const databaseUrl = process.env.DATABASE_URL;
if (!redisUrl || !databaseUrl) throw new Error("Worker requires REDIS_URL and DATABASE_URL.");
const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: true });
const pool = new Pool({ connectionString: databaseUrl, max: 4, connectionTimeoutMillis: 5000 });

type BuildPayload = { buildId: string; source: string; userId: string | null };

async function processBuild(job: Job<BuildPayload>) {
  const { buildId, source } = job.data;
  await pool.query("UPDATE builds SET status='running' WHERE id=$1 AND status='queued'", [buildId]);
  try {
    await validateWithOfficialLuau(source);
    const result = await obfuscateWithObscura(source);
    await validateWithOfficialLuau(result.code);
    await pool.query(
      `UPDATE builds SET status='completed',output_bytes=$2,output_text=$3,warnings=$4::jsonb,token_count=$5,completed_at=now(),error_message=NULL WHERE id=$1`,
      [buildId, result.stats.outputBytes, result.code, JSON.stringify(result.warnings), result.stats.tokens]
    );
    return { buildId, status: "completed" };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 2000) : "Build failed";
    await pool.query("UPDATE builds SET status='failed',error_message=$2,completed_at=now() WHERE id=$1", [buildId, message]);
    throw error;
  }
}

const worker = new Worker<BuildPayload>("vanta-builds", processBuild, {
  connection, concurrency: Number(process.env.WORKER_CONCURRENCY ?? 2),
  limiter: { max: 20, duration: 60_000 }
});
worker.on("completed", job => console.log(`Vanta build ${job.id} completed.`));
worker.on("failed", (job, error) => console.error(`Vanta build ${job?.id ?? "unknown"} failed:`, error.message));
console.log("Vanta isolated build worker started.");

async function shutdown() {
  await worker.close();
  await connection.quit();
  await pool.end();
}
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
