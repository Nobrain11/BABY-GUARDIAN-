import { Redis } from "ioredis";
import { config } from "./config.js";

export const redis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: null,
  lazyConnect: true
});

redis.on("connect", () => {
  console.log("⚡ Redis connected");
});

redis.on("ready", () => {
  console.log("🟢 Redis ready");
});

redis.on("error", (error: Error) => {
  console.error("❌ Redis error:", error.message);
});

export async function connectRedis(): Promise<void> {
  if (
    redis.status === "ready" ||
    redis.status === "connecting"
  ) {
    return;
  }

  await redis.connect();

  const response = await redis.ping();

  if (response !== "PONG") {
    throw new Error(
      "Redis PING failed"
    );
  }

  console.log(
    "🏓 Redis PING successful"
  );
}

export async function closeRedis(): Promise<void> {
  if (redis.status !== "end") {
    await redis.quit();
  }
}

export async function incrementRateLimit(
  key: string,
  windowSeconds: number
): Promise<number> {
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
