import Redis from "ioredis";
import { config } from "./config.js";

export const redis =
  new Redis(config.redisUrl, {
    maxRetriesPerRequest: null
  });

redis.on("connect", () => {
  console.log("⚡ Redis connected");
});

redis.on("error", error => {
  console.error(
    "Redis error:",
    error
  );
});

export async function closeRedis() {
  await redis.quit();
}

export async function incrementRateLimit(
  key: string,
  windowSeconds: number
) {
  const count =
    await redis.incr(key);

  if (count === 1) {
    await redis.expire(
      key,
      windowSeconds
    );
  }

  return count;
}
