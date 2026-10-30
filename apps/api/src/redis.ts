import { createClient } from "redis";

export const redis = process.env.REDIS_URL ? createClient({ url: process.env.REDIS_URL }) : null;
if (redis) redis.on("error", error => console.error("Vanta Redis error:", error));
