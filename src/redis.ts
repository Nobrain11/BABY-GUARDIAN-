import Redis from "ioredis";
import { config } from "./config.js";

const redis = new Redis.default(config.redisUrl, {
  maxRetriesPerRequest: null
});

redis.on("connect", () => {
  console.log("⚡ Redis connected");
});

redis.on("error", (error: Error) => {
  console.error("Redis error:", error);
});

export { redis };

export async function closeRedis(): Promise<void> {
  await redis.quit();
}

export async function incrementRateLimit(
  key: string,
  windowSeconds: number
): Promise<number> {
  const count = await redis.incr(key);

  if (count === 1) {
    await redis.expire(key, windowSeconds);
  }

  return count;
}
