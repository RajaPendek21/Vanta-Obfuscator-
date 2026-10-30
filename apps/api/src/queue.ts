import { Queue } from "bullmq";
import IORedis from "ioredis";

const redisUrl = process.env.REDIS_URL;
export const queueConnection = redisUrl ? new IORedis(redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: true }) : null;
export const buildQueue = queueConnection ? new Queue("vanta-builds", { connection: queueConnection }) : null;
