import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is missing`);
  }

  return value;
}

export const config = {
  botToken: required("BOT_TOKEN"),

  databaseUrl: required("DATABASE_URL"),

  redisUrl:
    process.env.REDIS_URL ||
    "redis://localhost:6379",

  port:
    Number(process.env.PORT) || 3000,

  dashboardSecret:
    required("DASHBOARD_SECRET"),

  logChatId:
    process.env.LOG_CHAT_ID || "",

  adminIds:
    (process.env.ADMIN_IDS || "")
      .split(",")
      .map(x => x.trim())
      .filter(Boolean)
};
